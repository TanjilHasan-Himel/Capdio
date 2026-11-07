// test-harness/test-apps-tab-capture.js
// Automated Verification for Production Tab Capture Pipeline (OCS-103)

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
const PORT = 3456;

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

async function runTabCaptureTest(server) {
  console.log('🚀 Running OCS-103 Single-Tab Capture Pipeline Test...');
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

    if (!workerTarget) {
      throw new Error('Capdio Service Worker not found');
    }

    const extensionUrl = workerTarget.url();
    const extensionId = new URL(extensionUrl).hostname;
    console.log(`✅ Extension active. ID: ${extensionId}`);

    const extensionOrigin = `chrome-extension://${extensionId}`;
    await browser.defaultBrowserContext().overridePermissions(extensionOrigin, ['microphone']);

    const worker = await workerTarget.worker();

    // 2. Open Target Web Page to be captured
    console.log('2. Opening target tab (test-page.html with animated canvas & audio)...');
    const targetPage = await browser.newPage();
    await targetPage.goto(`http://127.0.0.1:${PORT}/test-page.html?autoplayAudio=1`, { waitUntil: 'load' });
    await targetPage.bringToFront();
    await new Promise(r => setTimeout(r, 1000));
    console.log(`✅ Target web tab loaded: ${targetPage.url()}`);

    // 3. Invoke user action via CDP to grant activeTab permission on targetPage
    console.log('3. Triggering Extensions.triggerAction to invoke activeTab...');
    const browserClient = await browser.target().createCDPSession();
    await browserClient.send('Extensions.triggerAction', {
      id: extensionId,
      targetId: targetPage._tabId
    });
    console.log('✓ Extensions.triggerAction delivered.');

    // 4. Open Extension Popup UI
    console.log('4. Opening Popup UI (popup.html)...');
    const popupPage = await browser.newPage();
    popupPage.on('console', msg => console.log('[Popup Console]', msg.type(), msg.text()));
    worker.on('console', msg => console.log('[SW Console]', msg.text()));

    browser.on('targetcreated', async (t) => {
      if (t.type() === 'page' || t.type() === 'other') {
        try {
          const p = await t.page();
          if (p) {
            p.on('console', msg => console.log(`[Target ${t.url()} Console]`, msg.text()));
          }
        } catch (e) {}
      }
    });

    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });

    // Verify initial popup state
    const initialStatus = await popupPage.$eval('#statusText', el => el.textContent?.trim());
    console.log(`Popup initial status: "${initialStatus}"`);

    // 5. Click Start Recording button
    console.log('5. Clicking #recordButton ("Start Recording") in popup...');
    await popupPage.click('#recordButton');

    // Wait for popup to transition to RECORDING
    console.log('Waiting for popup to transition to RECORDING...');
    let recordingStatus = '';
    for (let i = 0; i < 40; i++) {
      recordingStatus = await popupPage.$eval('#statusText', el => el.textContent?.trim());
      if (recordingStatus === 'RECORDING') break;
      await new Promise(r => setTimeout(r, 250));
    }

    if (recordingStatus !== 'RECORDING') {
      throw new Error(`Expected popup status 'RECORDING', got '${recordingStatus}'`);
    }
    console.log('✅ PASS: Popup transitioned to RECORDING state!');

    // 6. Actively record for 3.5 seconds
    console.log('6. Actively recording for 3.5 seconds...');
    await new Promise(r => setTimeout(r, 3500));

    // Verify timer in popup
    const timerText = await popupPage.$eval('#recordingTimer', el => el.textContent?.trim());
    console.log(`Active recording timer: "${timerText}"`);

    // 7. Click Stop Recording button
    console.log('7. Clicking #stopButton ("Stop") in popup...');
    await popupPage.click('#stopButton');

    // Wait for popup to transition to READY
    console.log('Waiting for popup to transition to READY...');
    let readyStatus = '';
    for (let i = 0; i < 40; i++) {
      readyStatus = await popupPage.$eval('#statusText', el => el.textContent?.trim());
      if (readyStatus === 'READY') break;
      await new Promise(r => setTimeout(r, 250));
    }

    if (readyStatus !== 'READY') {
      throw new Error(`Expected popup status 'READY', got '${readyStatus}'`);
    }
    console.log('✅ PASS: Popup transitioned to READY state!');

    // 8. Extract recording base64 data
    const lastResult = await popupPage.evaluate(() => window.__lastResult);
    console.log('lastResult received in popup:', JSON.stringify(lastResult, null, 2));

    const lastBase64 = await popupPage.evaluate(() => window.__lastRecordingBase64);
    console.log('lastBase64 length:', lastBase64?.length, 'sample:', lastBase64 ? lastBase64.substring(0, 40) : 'null');
    if (!lastBase64) {
      throw new Error('No recording base64 data found in popup state');
    }

    const videoBuffer = Buffer.from(lastBase64, 'base64');
    console.log(`Recorded video buffer size: ${videoBuffer.length} bytes`);
    console.log(`First 16 bytes:`, videoBuffer.subarray(0, 16));
    if (videoBuffer.length < 50000) {
      throw new Error(`Recording is suspiciously small: ${videoBuffer.length} bytes`);
    }

    // 9. Verify EBML Magic Header
    const isEbmlValid = verifyEbmlHeader(videoBuffer);
    console.log(`EBML Header Valid: ${isEbmlValid} (${videoBuffer.slice(0, 4).toString('hex')})`);

    if (!isEbmlValid) {
      throw new Error('Invalid WebM EBML header in recorded output');
    }
    console.log('✅ PASS: Magic EBML header 0x1A 0x45 0xDF 0xA3 verified.');

    // Save output file
    if (!fs.existsSync(RECORDINGS_DIR)) {
      fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
    }
    const outputPath = path.join(RECORDINGS_DIR, 'test-capdio-tab-1080p.webm');
    fs.writeFileSync(outputPath, videoBuffer);
    console.log(`✅ PASS: Saved verified playable recording to: ${outputPath} (${videoBuffer.length} bytes)`);

    // 10. Verify Session Registry Manifest Record via chrome.storage.local
    const latestSessions = await popupPage.evaluate(async () => {
      const indexData = await chrome.storage.local.get('capdio_sessions_index');
      const sessionIds = indexData?.capdio_sessions_index || [];
      const keys = sessionIds.map(id => `capdio_session_${id}`);
      const sessionsMap = await chrome.storage.local.get(keys);
      return sessionIds.map(id => sessionsMap[`capdio_session_${id}`]).filter(Boolean);
    });

    console.log(`Session registry count: ${latestSessions?.length}`);
    const latestSession = latestSessions?.[0];
    console.log('Latest Session Manifest:', {
      sessionId: latestSession?.sessionId,
      status: latestSession?.status,
      sourcesCount: latestSession?.sources?.length,
      segmentsCount: latestSession?.segments?.length
    });

    if (latestSession?.status !== 'ready') {
      throw new Error(`Expected latest session status 'ready', got '${latestSession?.status}'`);
    }
    if (!latestSession?.sources || latestSession.sources.length === 0) {
      throw new Error('Session manifest has no registered sources');
    }
    if (!latestSession?.segments || latestSession.segments.length === 0) {
      throw new Error('Session manifest has no recorded segments');
    }
    console.log('✅ PASS: Session Registry manifest verified with READY state and recorded segments.');

    console.log('\n=============================================================');
    console.log('🎉 OCS-103 SINGLE-TAB CAPTURE VERIFICATION PASSED!');
    console.log('=============================================================\n');

    return { success: true, outputPath, totalBytes: videoBuffer.length };
  } finally {
    await browser.close();
    server.close();
  }
}

async function main() {
  try {
    const server = await startServer();
    await runTabCaptureTest(server);
    process.exit(0);
  } catch (err) {
    console.error('❌ OCS-103 TEST FAILED:', err);
    process.exit(1);
  }
}

main();
