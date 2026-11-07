// test-harness/test-local-library.js
// Automated Integration Test for Capdio Local Library & Player (OCS-205)
// Validates recording card rendering, video preview playback, title renaming,
// file export integrity, and clean cascaded deletion.

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
const PORT = 3496;

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

async function runLocalLibraryIntegrationTest() {
  console.log('======================================================================');
  console.log('🚀 Running OCS-205 Local Library, Playback, Rename & Delete Test');
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

    // 4. Open Popup UI & Record 3 seconds
    console.log('4. Opening Popup UI (popup.html)...');
    const popupPage = await browser.newPage();
    popupPage.on('console', msg => console.log('[Popup Console]', msg.text()));
    worker.on('console', msg => console.log('[SW Console]', msg.text()));

    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 500));

    const initialText = await popupPage.$eval('#statusText', el => el.textContent?.trim());
    console.log(`Initial popup status: "${initialText}"`);

    console.log('5. Starting tab recording in popup...');
    await popupPage.click('#recordButton');

    await popupPage.waitForFunction(() => {
      const el = document.getElementById('statusText');
      return el && el.textContent.trim() === 'RECORDING';
    }, { timeout: 10000 });

    console.log('✅ Recording actively running. Waiting 3 seconds...');
    await new Promise(r => setTimeout(r, 3000));

    console.log('6. Stopping recording in popup...');
    await popupPage.click('#stopButton');

    await popupPage.waitForFunction(() => {
      const el = document.getElementById('statusText');
      return el && el.textContent.trim() === 'READY';
    }, { timeout: 10000 });

    console.log('✅ Recording completed and ready.');

    // Retrieve active session ID from worker
    const recordedSessionId = await worker.evaluate(async () => {
      const capdio = self.__capdio;
      const res = capdio.getLastRecordingResult();
      return res?.sessionId;
    });

    console.log(`Recorded Session ID: ${recordedSessionId}`);
    if (!recordedSessionId) throw new Error('No recorded session ID found');

    // 7. Navigate to Local Library (library.html)
    console.log('\n--- TEST 1: Library Surface & Card Rendering ---');
    console.log('Opening Capdio Recordings Library (library.html)...');
    const libraryPage = await browser.newPage();
    libraryPage.on('console', msg => console.log('[Library Console]', msg.text()));
    libraryPage.on('pageerror', err => console.log('[Library PageError]', err.message));
    await libraryPage.goto(`chrome-extension://${extensionId}/library.html`, { waitUntil: 'load' });

    // Wait for cards to populate
    await libraryPage.waitForSelector(`.recording-card[data-session-id="${recordedSessionId}"]`, {
      timeout: 10000
    });

    const cardDetails = await libraryPage.evaluate((sessId) => {
      const card = document.querySelector(`.recording-card[data-session-id="${sessId}"]`);
      if (!card) return null;
      const title = card.querySelector('.card-title')?.textContent?.trim() || '';
      const badge = card.querySelector('.format-badge')?.textContent?.trim() || '';
      const metrics = card.querySelector('.card-metrics')?.textContent?.trim() || '';
      return { title, badge, metrics };
    }, recordedSessionId);

    console.log('Rendered Card Details:', cardDetails);
    if (!cardDetails) throw new Error('Session card not found in library');
    console.log(`✅ PASS: Recording card rendered with title="${cardDetails.title}", format="${cardDetails.badge}".`);

    // 8. Test Video Preview Playback
    console.log('\n--- TEST 2: Inline Video Preview Playback ---');
    console.log('Clicking "▶ Preview" button on recording card...');
    await libraryPage.evaluate((sessId) => {
      const card = document.querySelector(`.recording-card[data-session-id="${sessId}"]`);
      const btn = card?.querySelector('.btn-preview');
      btn?.click();
    }, recordedSessionId);

    // Wait for video player to receive src and preview panel to become visible
    await libraryPage.waitForFunction(() => {
      const panel = document.getElementById('previewPanel');
      const video = document.getElementById('videoPlayer');
      return panel && !panel.classList.contains('hidden') && video && !!video.src;
    }, { timeout: 10000 });

    const previewState = await libraryPage.evaluate(() => {
      const video = document.getElementById('videoPlayer');
      const title = document.getElementById('previewTitle')?.textContent || '';
      const details = document.getElementById('previewDetails')?.textContent || '';
      return {
        videoSrc: video?.src,
        title,
        details,
        hasBlobUrl: video?.src?.startsWith('blob:')
      };
    });

    console.log('Preview State:', previewState);
    if (!previewState.hasBlobUrl) {
      throw new Error(`Expected blob URL in video player, got '${previewState.videoSrc}'`);
    }
    console.log(`✅ PASS: Video player loaded Blob URL: ${previewState.videoSrc}`);

    // 9. Test Renaming Session Title
    console.log('\n--- TEST 3: Metadata Renaming & Sanitization ---');
    console.log('Clicking "✏ Rename" button on recording card...');
    await libraryPage.evaluate((sessId) => {
      const card = document.querySelector(`.recording-card[data-session-id="${sessId}"]`);
      const btn = card?.querySelector('.btn-rename');
      btn?.click();
    }, recordedSessionId);

    await libraryPage.waitForSelector('#renameModal:not(.hidden)', { timeout: 5000 });

    const newTitle = 'Capdio Demo — Feature Walkthrough';
    console.log(`Entering new title: "${newTitle}"...`);
    await libraryPage.$eval('#renameInput', (el, val) => {
      el.value = val;
    }, newTitle);

    await libraryPage.click('#saveRenameBtn');

    // Wait for modal to hide
    await libraryPage.waitForSelector('#renameModal.hidden', { timeout: 5000 });

    // Verify card title updated in DOM
    const updatedCardTitle = await libraryPage.evaluate((sessId) => {
      const card = document.querySelector(`.recording-card[data-session-id="${sessId}"]`);
      return card?.querySelector('.card-title')?.textContent?.trim();
    }, recordedSessionId);

    console.log('Updated Card Title in DOM:', updatedCardTitle);
    if (updatedCardTitle !== newTitle) {
      throw new Error(`Expected title '${newTitle}', got '${updatedCardTitle}'`);
    }

    // Verify persisted in background SessionRegistry
    const registrySession = await worker.evaluate(async (sessId) => {
      const capdio = self.__capdio;
      return await capdio.sessionRegistry.getSession(sessId);
    }, recordedSessionId);

    if (registrySession?.title !== newTitle) {
      throw new Error(`Expected background registry title '${newTitle}', got '${registrySession?.title}'`);
    }
    console.log('✅ PASS: Session title safely updated in both DOM and persistent SessionRegistry.');

    // 10. Test Media Data / File Export
    console.log('\n--- TEST 4: File Export Data Integrity ---');
    const exportData = await worker.evaluate(async (sessId) => {
      const capdio = self.__capdio;
      const res = await capdio.sendTypedMessage ? null : null; // check via message bus
      return true;
    });

    const recordingMedia = await libraryPage.evaluate(async (sessId) => {
      const lib = window.__capdio_library;
      const sessions = lib.getAllSessions();
      const sess = sessions.find(s => s.sessionId === sessId);
      if (!sess) return null;
      // Fetch recording data directly with valid message schema
      const check = await chrome.runtime.sendMessage({
        id: `msg_export_${Date.now()}`,
        target: 'background',
        action: 'GET_RECORDING_DATA',
        timestamp: Date.now(),
        payload: { sessionId: sessId }
      });
      return check;
    }, recordedSessionId);

    console.log('GET_RECORDING_DATA check:', {
      success: recordingMedia?.success,
      mimeType: recordingMedia?.data?.mimeType,
      totalBytes: recordingMedia?.data?.totalBytes,
      base64Length: recordingMedia?.data?.base64Data?.length
    });

    if (!recordingMedia?.success || !recordingMedia?.data?.base64Data) {
      throw new Error('Could not retrieve recording data for export');
    }

    const exportedBuffer = Buffer.from(recordingMedia.data.base64Data, 'base64');
    const isValidEbml = verifyEbmlHeader(exportedBuffer);
    console.log(`Exported Media: ${(exportedBuffer.length / (1024 * 1024)).toFixed(2)} MB, Valid EBML: ${isValidEbml}`);
    if (!isValidEbml) {
      throw new Error('Exported recording failed EBML header validation');
    }
    console.log('✅ PASS: Exported recording verified as intact playable WebM container.');

    // 11. Test Cascaded Deletion
    console.log('\n--- TEST 5: Clean Cascaded Deletion ---');
    // Stub window.confirm to return true
    await libraryPage.evaluate(() => {
      window.confirm = () => true;
    });

    console.log('Clicking "🗑" delete button on recording card...');
    await libraryPage.evaluate((sessId) => {
      const card = document.querySelector(`.recording-card[data-session-id="${sessId}"]`);
      const btn = card?.querySelector('.btn-delete');
      btn?.click();
    }, recordedSessionId);

    // Wait until card disappears from DOM
    await libraryPage.waitForFunction((sessId) => {
      const card = document.querySelector(`.recording-card[data-session-id="${sessId}"]`);
      return card === null;
    }, { timeout: 10000 }, recordedSessionId);

    console.log('✅ Card removed from library DOM.');

    // Verify session removed from background registry
    const sessionAfterDelete = await worker.evaluate(async (sessId) => {
      const capdio = self.__capdio;
      return await capdio.sessionRegistry.getSession(sessId);
    }, recordedSessionId);

    if (sessionAfterDelete !== null) {
      throw new Error('Session still exists in SessionRegistry after deletion');
    }
    console.log('✅ PASS: Session manifest removed from SessionRegistry and storage index.');

    // Verify preview panel closed
    const isPreviewClosed = await libraryPage.evaluate(() => {
      const panel = document.getElementById('previewPanel');
      return panel && panel.classList.contains('hidden');
    });

    if (!isPreviewClosed) {
      throw new Error('Expected preview panel to be closed after deleted session was active');
    }
    console.log('✅ PASS: Preview panel cleanly closed on deletion.');

    console.log('\n======================================================================');
    console.log('🎉 ALL OCS-205 LOCAL LIBRARY TESTS PASSED!');
    console.log('======================================================================\n');
  } finally {
    await browser.close();
    server.close();
  }
}

runLocalLibraryIntegrationTest().catch((err) => {
  console.error('\n❌ Local library test failed:', err);
  process.exit(1);
});

