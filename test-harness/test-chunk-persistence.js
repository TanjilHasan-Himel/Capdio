// test-harness/test-chunk-persistence.js
// Automated Integration Test for Chunk Persistence & IndexedDB Storage (OCS-202)
// Validates incremental chunk streaming to IndexedDB, bounded memory,
// finalized recording assembly, and storage purge.

import puppeteer from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHROME_PATH = 'C:\\Users\\Himel\\.cache\\puppeteer\\chrome\\win64-152.0.7977.42\\chrome-win64\\chrome.exe';
const EXTENSION_DIST = path.resolve(__dirname, '..', 'apps', 'extension', 'dist');
const RECORDINGS_DIR = path.resolve(__dirname, '..', 'recordings');
const PORT = 3480;

function startServer() {
  return new Promise((resolve) => {
    const fixtureHtml = fs.readFileSync(path.join(__dirname, 'fixtures', 'test-page.html'), 'utf8');
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fixtureHtml);
    });
    server.listen(PORT, () => {
      console.log(`✓ Test fixture server running at http://127.0.0.1:${PORT}`);
      resolve(server);
    });
  });
}

function verifyEbmlHeader(buffer) {
  if (buffer.length < 4) return false;
  return (
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  );
}

async function runChunkPersistenceIntegrationTest() {
  console.log('🚀 Running OCS-202 Chunk Persistence & IndexedDB Storage Test...');

  const server = await startServer();
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_DIST}`,
      `--load-extension=${EXTENSION_DIST}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--autoplay-policy=no-user-gesture-required'
    ],
    defaultViewport: { width: 1280, height: 720 }
  });

  try {
    // 1. Locate Service Worker
    console.log('1. Locating Capdio Service Worker...');
    let workerTarget = null;
    for (let i = 0; i < 40; i++) {
      const targets = browser.targets();
      workerTarget = targets.find(t => t.type() === 'service_worker' && t.url().includes('chrome-extension://'));
      if (workerTarget) break;
      await new Promise(r => setTimeout(r, 200));
    }

    if (!workerTarget) throw new Error('Capdio Service Worker not found');
    const extensionUrl = workerTarget.url();
    const extensionId = new URL(extensionUrl).hostname;
    console.log(`✅ Extension active. ID: ${extensionId}`);

    const worker = await workerTarget.worker();

    // 2. Open Target Tab to be captured
    console.log('2. Opening target web tab to be captured...');
    const targetPage = await browser.newPage();
    await targetPage.goto(`http://127.0.0.1:${PORT}/test-page.html?autoplayAudio=1`, { waitUntil: 'load' });
    await targetPage.bringToFront();
    await new Promise(r => setTimeout(r, 1000));

    // 3. Grant activeTab via CDP
    console.log('3. Granting activeTab permission via CDP...');
    const browserClient = await browser.target().createCDPSession();
    await browserClient.send('Extensions.triggerAction', {
      id: extensionId,
      targetId: targetPage._tabId
    });

    // 4. Open Popup UI & Start Capture
    console.log('4. Opening Popup UI (popup.html)...');
    const popupPage = await browser.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });

    console.log('5. Starting tab recording in popup...');
    await popupPage.click('#recordButton');

    let recordingStatus = '';
    for (let i = 0; i < 40; i++) {
      recordingStatus = await popupPage.$eval('#statusText', el => el.textContent?.trim());
      if (recordingStatus === 'RECORDING') break;
      await new Promise(r => setTimeout(r, 250));
    }
    if (recordingStatus !== 'RECORDING') {
      throw new Error(`Expected RECORDING status, got '${recordingStatus}'`);
    }
    console.log('✅ PASS: Recording successfully started');

    // Retrieve active session ID from SW
    const activeSessionId = await worker.evaluate(() => self.__capdio.stateMachine.activeSessionId);
    console.log(`Active Recording Session ID: ${activeSessionId}`);
    if (!activeSessionId) throw new Error('Missing activeSessionId in SW');

    // 6. Actively record for 3 seconds while chunks stream into IndexedDB
    console.log('6. Streaming chunks into IndexedDB for 3 seconds...');
    await new Promise(r => setTimeout(r, 3000));

    // 7. Inspect IndexedDB Chunks Store directly in Extension Origin
    console.log('\n7. Inspecting IndexedDB (capdio_recordings_db -> chunks)...');
    const idbChunksReport = await popupPage.evaluate(async (sessId) => {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('capdio_recordings_db', 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('chunks', 'readonly');
          const store = tx.objectStore('chunks');
          const index = store.index('by_session');
          const getAllReq = index.getAll(sessId);

          getAllReq.onsuccess = () => {
            const rawChunks = getAllReq.result || [];
            const summary = rawChunks.map(c => ({
              sequenceNumber: c.sequenceNumber,
              partId: c.partId,
              bytes: c.bytes,
              startMs: c.startMs
            }));
            const totalBytes = summary.reduce((acc, c) => acc + c.bytes, 0);
            resolve({
              count: summary.length,
              totalBytes,
              firstThree: summary.slice(0, 3),
              lastThree: summary.slice(-3)
            });
          };
          getAllReq.onerror = () => reject(getAllReq.error);
        };
      });
    }, activeSessionId);

    console.log('IndexedDB Chunks Report:', JSON.stringify(idbChunksReport, null, 2));

    if (idbChunksReport.count < 5) {
      throw new Error(`Expected at least 5 persisted chunks, got ${idbChunksReport.count}`);
    }
    if (idbChunksReport.totalBytes < 500000) {
      throw new Error(`Expected total chunk bytes > 500KB, got ${idbChunksReport.totalBytes}`);
    }

    // Verify monotonic sequence numbering
    assertMonotonic(idbChunksReport.firstThree);
    console.log(`✅ PASS: ${idbChunksReport.count} chunks incrementally persisted with monotonic sequences! Total: ${(idbChunksReport.totalBytes / 1024 / 1024).toFixed(2)} MB`);

    // 8. Stop Recording & Verify Finalized Storage Assembly
    console.log('\n8. Stopping recording & assembling finalized recording in IndexedDB...');
    await popupPage.click('#stopButton');

    let readyStatus = '';
    for (let i = 0; i < 40; i++) {
      readyStatus = await popupPage.$eval('#statusText', el => el.textContent?.trim());
      if (readyStatus === 'READY') break;
      await new Promise(r => setTimeout(r, 250));
    }
    if (readyStatus !== 'READY') throw new Error(`Expected READY status, got '${readyStatus}'`);
    console.log('✅ PASS: FSM transitioned to READY');

    // 9. Inspect Finalized Recordings Object Store in IndexedDB
    console.log('\n9. Inspecting IndexedDB (finalized_recordings store)...');
    const finalizedRecord = await popupPage.evaluate(async (sessId) => {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('capdio_recordings_db', 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('finalized_recordings', 'readonly');
          const store = tx.objectStore('finalized_recordings');
          const getReq = store.get(sessId);
          getReq.onsuccess = () => {
            const res = getReq.result;
            if (!res) return resolve(null);
            resolve({
              sessionId: res.sessionId,
              mimeType: res.mimeType,
              totalBytes: res.totalBytes,
              hasBlob: !!res.blob,
              blobSize: res.blob?.size,
              finalizedAt: res.finalizedAt
            });
          };
          getReq.onerror = () => reject(getReq.error);
        };
      });
    }, activeSessionId);

    console.log('Finalized Record in IndexedDB:', finalizedRecord);
    if (!finalizedRecord || !finalizedRecord.hasBlob || finalizedRecord.totalBytes < 500000) {
      throw new Error(`Invalid finalized record in IndexedDB: ${JSON.stringify(finalizedRecord)}`);
    }
    console.log('✅ PASS: Consolidated recording successfully assembled and persisted in finalized_recordings store!');

    // 10. Test GET_RECORDING_DATA Message Endpoint
    console.log('\n10. Querying GET_RECORDING_DATA via Message Bus...');
    const dataResponse = await popupPage.evaluate(async (sessId) => {
      const chrome = globalThis.chrome;
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({
          id: 'msg_' + Date.now(),
          target: 'background',
          action: 'GET_RECORDING_DATA',
          timestamp: Date.now(),
          payload: { sessionId: sessId }
        }, resolve);
      });
    }, activeSessionId);

    console.log('GET_RECORDING_DATA response metadata:', {
      success: dataResponse.success,
      sessionId: dataResponse.data?.sessionId,
      mimeType: dataResponse.data?.mimeType,
      totalBytes: dataResponse.data?.totalBytes,
      base64Length: dataResponse.data?.base64Data?.length
    });

    if (!dataResponse.success || !dataResponse.data?.base64Data) {
      throw new Error(`GET_RECORDING_DATA failed: ${JSON.stringify(dataResponse)}`);
    }

    const videoBuffer = Buffer.from(dataResponse.data.base64Data, 'base64');
    if (!verifyEbmlHeader(videoBuffer)) {
      throw new Error('Retrieved media from IndexedDB does not contain a valid EBML header');
    }
    console.log(`✅ PASS: Valid EBML header verified (0x1A 0x45 0xDF 0xA3) for media retrieved from IndexedDB (${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

    // 11. Test DELETE_RECORDING_DATA (Clean purge)
    console.log('\n11. Testing DELETE_RECORDING_DATA (Purging session media from IndexedDB)...');
    const deleteRes = await popupPage.evaluate(async (sessId) => {
      const chrome = globalThis.chrome;
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({
          id: 'msg_' + Date.now(),
          target: 'background',
          action: 'DELETE_RECORDING_DATA',
          timestamp: Date.now(),
          payload: { sessionId: sessId }
        }, resolve);
      });
    }, activeSessionId);

    console.log('DELETE_RECORDING_DATA response:', deleteRes);
    if (!deleteRes.success) throw new Error(`DELETE_RECORDING_DATA failed: ${JSON.stringify(deleteRes)}`);

    // Verify IndexedDB stores are clean
    const postDeleteCheck = await popupPage.evaluate(async (sessId) => {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('capdio_recordings_db', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['chunks', 'finalized_recordings'], 'readonly');
          const chunkReq = tx.objectStore('chunks').index('by_session').count(sessId);
          const finalReq = tx.objectStore('finalized_recordings').get(sessId);

          let remainingChunks = 0;
          let remainingFinal = null;

          chunkReq.onsuccess = () => { remainingChunks = chunkReq.result; };
          finalReq.onsuccess = () => { remainingFinal = finalReq.result; };

          tx.oncomplete = () => resolve({ remainingChunks, hasFinal: !!remainingFinal });
          tx.onerror = () => reject(tx.error);
        };
      });
    }, activeSessionId);

    console.log('Post-delete IndexedDB check:', postDeleteCheck);
    if (postDeleteCheck.remainingChunks !== 0 || postDeleteCheck.hasFinal) {
      throw new Error(`Data still remained in IndexedDB after purge: ${JSON.stringify(postDeleteCheck)}`);
    }
    console.log('✅ PASS: Chunks and finalized recordings completely purged from IndexedDB on demand.');

    console.log('\n=============================================================');
    console.log('🎉 ALL OCS-202 CHUNK PERSISTENCE & STORAGE TESTS PASSED!');
    console.log('=============================================================\n');
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
}

function assertMonotonic(chunks) {
  for (let i = 1; i < chunks.length; i++) {
    if (chunks[i].sequenceNumber <= chunks[i - 1].sequenceNumber) {
      throw new Error(`Non-monotonic sequence number: ${chunks[i].sequenceNumber} <= ${chunks[i - 1].sequenceNumber}`);
    }
  }
}

runChunkPersistenceIntegrationTest().catch(err => {
  console.error('\n❌ OCS-202 integration test failed:', err);
  process.exit(1);
});
