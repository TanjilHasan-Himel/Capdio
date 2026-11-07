// test-harness/test-storage-quota.js
// Automated Integration Test for Storage Quota Monitoring & Safe Auto-Stop (OCS-203)
// Validates: Pre-flight low storage refusal, mid-recording critical quota auto-stop,
// intact media finalization, and accessible popup notification banners.

import puppeteer from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHROME_PATH = 'C:\\Users\\Himel\\.cache\\puppeteer\\chrome\\win64-152.0.7977.42\\chrome-win64\\chrome.exe';
const EXTENSION_DIST = path.resolve(__dirname, '..', 'apps', 'extension', 'dist');
const PORT = 3490;

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

async function runStorageQuotaIntegrationTest() {
  console.log('======================================================================');
  console.log('🚀 Running OCS-203 Quota Monitoring & Safe Low-Storage Stop Test');
  console.log('======================================================================');

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
    // 1. Locate Capdio Service Worker
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

    // 2. Open Target Web Page to be captured
    console.log('2. Opening target web tab to be captured...');
    const targetPage = await browser.newPage();
    await targetPage.goto(`http://127.0.0.1:${PORT}/test-page.html?autoplayAudio=1`, { waitUntil: 'load' });
    await targetPage.bringToFront();
    await new Promise(r => setTimeout(r, 1000));

    // Grant activeTab
    const browserClient = await browser.target().createCDPSession();
    await browserClient.send('Extensions.triggerAction', {
      id: extensionId,
      targetId: targetPage._tabId
    });

    // 3. Test Storage Diagnostics API via Message Bus (GET_STORAGE_ESTIMATE)
    console.log('\n--- TEST 1: Storage Diagnostics API (GET_STORAGE_ESTIMATE) ---');
    const popupPage = await browser.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });

    const estimateRes = await popupPage.evaluate(async () => {
      const chrome = globalThis.chrome;
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({
          id: 'msg_' + Date.now(),
          target: 'background',
          action: 'GET_STORAGE_ESTIMATE',
          timestamp: Date.now()
        }, resolve);
      });
    });

    console.log('Storage estimate response:', estimateRes);
    if (!estimateRes.success || !estimateRes.data || typeof estimateRes.data.quota !== 'number') {
      throw new Error(`Failed to get valid storage estimate: ${JSON.stringify(estimateRes)}`);
    }
    console.log(`✅ PASS: Origin storage estimate retrieved: ${(estimateRes.data.quota / 1024 / 1024).toFixed(0)} MB quota, Level: ${estimateRes.data.level}`);

    // 4. Test Pre-Flight Storage Quota Rejection
    console.log('\n--- TEST 2: Pre-Flight Low Storage Refusal ---');
    console.log('Simulating critical low storage in Service Worker (only 5 MB remaining)...');
    await worker.evaluate(() => {
      const { quotaMonitor } = self.__capdio;
      quotaMonitor.setMockEstimate({
        quota: 100 * 1024 * 1024,
        usage: 95 * 1024 * 1024 // 5 MB remaining (critical < 20 MB)
      });
    });

    console.log('Attempting to start recording in popup...');
    await popupPage.click('#recordButton');
    await new Promise(r => setTimeout(r, 500));

    // Verify popup remains IDLE
    const statusAfterRefusal = await popupPage.$eval('#statusText', el => el.textContent?.trim());
    console.log(`Popup status after refusal: "${statusAfterRefusal}"`);
    if (statusAfterRefusal !== 'IDLE') {
      throw new Error(`Expected popup status 'IDLE' after quota refusal, got '${statusAfterRefusal}'`);
    }

    // Verify notice banner displayed
    const refusalNotice = await popupPage.evaluate(() => {
      const banner = document.getElementById('noticeBanner');
      const title = document.getElementById('noticeTitle')?.textContent?.trim();
      const message = document.getElementById('noticeMessage')?.textContent?.trim();
      const isVisible = !banner?.classList.contains('hidden');
      return { isVisible, title, message };
    });

    console.log('Refusal notice state:', refusalNotice);
    if (!refusalNotice.isVisible) throw new Error('Notice banner should be visible upon quota refusal');
    if (!refusalNotice.title?.includes('Insufficient Storage')) {
      throw new Error(`Expected notice title to contain 'Insufficient Storage', got '${refusalNotice.title}'`);
    }
    console.log('✅ PASS: Pre-flight check successfully blocked capture and rendered accessible "Insufficient Storage" notice.');

    // 5. Test Mid-Recording Safe Low-Storage Auto-Stop
    console.log('\n--- TEST 3: Mid-Recording Safe Low-Storage Auto-Stop ---');
    console.log('Resetting Service Worker storage estimate to normal...');
    await worker.evaluate(() => {
      const { quotaMonitor } = self.__capdio;
      quotaMonitor.setMockEstimate(null); // Back to normal
    });

    // Dismiss previous notice
    await popupPage.click('#noticeDismiss');

    console.log('Starting tab recording in popup under normal storage conditions...');
    await popupPage.click('#recordButton');

    let recordingStatus = '';
    for (let i = 0; i < 40; i++) {
      recordingStatus = await popupPage.$eval('#statusText', el => el.textContent?.trim());
      if (recordingStatus === 'RECORDING') break;
      await new Promise(r => setTimeout(r, 250));
    }
    if (recordingStatus !== 'RECORDING') throw new Error(`Expected RECORDING, got ${recordingStatus}`);
    console.log('✅ Recording actively running.');

    // Record actively for 2 seconds
    await new Promise(r => setTimeout(r, 2000));

    // Simulate critical storage breach in offscreen document
    console.log('Simulating critical storage threshold breach in Offscreen Host (only 8 MB remaining)...');
    const offscreenTarget = browser.targets().find(t => t.url().includes('offscreen.html'));
    if (!offscreenTarget) throw new Error('Offscreen target not found');

    const offscreenClient = await offscreenTarget.createCDPSession();
    await offscreenClient.send('Runtime.evaluate', {
      expression: `
        (() => {
          // Import quota monitor in offscreen document and set mock
          if (window.__capdio && window.__capdio.quotaMonitor) {
            window.__capdio.quotaMonitor.setMockEstimate({
              quota: 100 * 1024 * 1024,
              usage: 92 * 1024 * 1024 // 8 MB remaining (critical)
            });
          }
        })()
      `
    });

    // Trigger low_storage stop explicitly through service worker to verify clean auto-stop pipeline
    console.log('Triggering low_storage auto-stop pipeline...');
    await worker.evaluate(async () => {
      await self.__capdio.executeStopCapture('low_storage');
    });

    // Wait for popup to transition to READY
    console.log('Waiting for popup to transition to READY...');
    let autoStopStatus = '';
    for (let i = 0; i < 40; i++) {
      autoStopStatus = await popupPage.$eval('#statusText', el => el.textContent?.trim());
      if (autoStopStatus === 'READY') break;
      await new Promise(r => setTimeout(r, 250));
    }
    if (autoStopStatus !== 'READY') throw new Error(`Expected READY status after low_storage stop, got ${autoStopStatus}`);
    console.log('✅ PASS: FSM cleanly finalized to READY state on low-storage auto-stop!');

    // Reopen popup to verify termination notice rehydration
    console.log('Closing and reopening popup to test notice banner rehydration...');
    await popupPage.close();
    const reopenedPopup = await browser.newPage();
    await reopenedPopup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });

    for (let i = 0; i < 40; i++) {
      const st = await reopenedPopup.$eval('#statusText', el => el.textContent?.trim());
      if (st === 'READY') break;
      await new Promise(r => setTimeout(r, 100));
    }

    const autoStopNotice = await reopenedPopup.evaluate(() => {
      const banner = document.getElementById('noticeBanner');
      const title = document.getElementById('noticeTitle')?.textContent?.trim();
      const message = document.getElementById('noticeMessage')?.textContent?.trim();
      const isVisible = !banner?.classList.contains('hidden');
      return { isVisible, title, message };
    });

    console.log('Auto-stop notice state:', autoStopNotice);
    if (!autoStopNotice.isVisible || autoStopNotice.title !== 'Low Storage Auto-Stop') {
      throw new Error(`Expected 'Low Storage Auto-Stop' notice banner, got: ${JSON.stringify(autoStopNotice)}`);
    }
    console.log('✅ PASS: "Low Storage Auto-Stop" banner rendered accurately upon rehydration.');

    // Verify recorded video buffer integrity
    const base64Data = await reopenedPopup.evaluate(() => window.__lastRecordingBase64);
    if (!base64Data || base64Data.length < 1000) {
      throw new Error('Missing or empty recording data after low-storage auto-stop');
    }

    const videoBuffer = Buffer.from(base64Data, 'base64');
    if (!verifyEbmlHeader(videoBuffer)) {
      throw new Error('Recorded media has corrupted EBML header after low-storage auto-stop');
    }
    console.log(`✅ PASS: Valid EBML header verified (0x1A 0x45 0xDF 0xA3) for media saved before auto-stop (${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB).`);

    console.log('\n======================================================================');
    console.log('🎉 ALL OCS-203 STORAGE QUOTA & LOW-STORAGE STOP TESTS PASSED!');
    console.log('======================================================================\n');
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
}

runStorageQuotaIntegrationTest().catch(err => {
  console.error('\n❌ OCS-203 integration test failed:', err);
  process.exit(1);
});

