// test-harness/test-recording-controls.js
// Automated Verification for Start/Pause/Resume/Stop Controls & Persistent Recording Indicator (OCS-107)

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
const PORT = 3462;

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

async function runRecordingControlsTest(server) {
  console.log('🚀 Running OCS-107 Controls & Persistent Indicator Test...');
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

    const worker = await workerTarget.worker();
    worker.on('console', msg => console.log('[SW Console]', msg.text()));

    // Verify initial badge text is empty
    const initialBadge = await worker.evaluate(async () => {
      const chrome = globalThis.chrome;
      return await chrome.action.getBadgeText({});
    });
    console.log(`Initial badge text: "${initialBadge}"`);
    if (initialBadge !== '') {
      throw new Error(`Expected initial badge text '', got '${initialBadge}'`);
    }
    console.log('✅ PASS: Initial badge text is clean');

    // 2. Open Target Web Page to be captured
    console.log('2. Opening target tab (test-page.html)...');
    const targetPage = await browser.newPage();
    await targetPage.goto(`http://127.0.0.1:${PORT}/test-page.html?autoplayAudio=1`, { waitUntil: 'load' });
    await targetPage.bringToFront();
    await new Promise(r => setTimeout(r, 1000));

    // 3. Grant activeTab via CDP
    console.log('3. Triggering Extensions.triggerAction to invoke activeTab...');
    const browserClient = await browser.target().createCDPSession();
    await browserClient.send('Extensions.triggerAction', {
      id: extensionId,
      targetId: targetPage._tabId
    });

    // 4. Open Extension Popup UI
    console.log('4. Opening Popup UI (popup.html)...');
    let popupPage = await browser.newPage();
    popupPage.on('console', msg => console.log('[Popup1 Console]', msg.type(), msg.text()));
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });

    // =========================================================================
    // STEP 1: Start Recording & Verify Indicator
    // =========================================================================
    console.log('\n--- STEP 1: Start Recording & Action Badge Verification ---');
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
    console.log('✅ PASS: Recording active in popup');

    // Verify badge text is 'REC'
    const recBadge = await worker.evaluate(async () => {
      const chrome = globalThis.chrome;
      return await chrome.action.getBadgeText({});
    });
    console.log(`Active badge text: "${recBadge}"`);
    if (recBadge !== 'REC') {
      throw new Error(`Expected badge 'REC', got '${recBadge}'`);
    }
    console.log('✅ PASS: Action badge is "REC"');

    // Let record for 3 seconds
    console.log('Recording actively for 3 seconds...');
    await new Promise(r => setTimeout(r, 3000));

    // =========================================================================
    // STEP 2: Close Popup & Verify Persistence
    // =========================================================================
    console.log('\n--- STEP 2: Close Popup & Verify Background Persistence ---');
    console.log('Closing popup page (simulating user clicking away)...');
    await popupPage.close();

    // Wait 2.5 seconds while popup is completely closed
    console.log('Waiting 2.5 seconds while popup is closed...');
    await new Promise(r => setTimeout(r, 2500));

    // Check service worker status: must still be recording!
    const swStatus = await worker.evaluate(() => {
      const capdio = self.__capdio;
      return {
        status: capdio.stateMachine.currentStatus,
        elapsedSeconds: capdio.getElapsedRecordingSeconds()
      };
    });

    console.log('SW Status while popup closed:', swStatus);
    if (swStatus.status !== 'recording') {
      throw new Error(`Expected status 'recording' while popup closed, got '${swStatus.status}'`);
    }
    if ((swStatus.elapsedSeconds ?? 0) < 4) {
      throw new Error(`Expected elapsed seconds >= 4, got ${swStatus.elapsedSeconds}`);
    }
    console.log(`✅ PASS: Background recording persisted uninterrupted! Elapsed: ${swStatus.elapsedSeconds}s`);

    // =========================================================================
    // STEP 3: Reopen Popup & State Rehydration
    // =========================================================================
    console.log('\n--- STEP 3: Reopen Popup & Rehydrate State ---');
    popupPage = await browser.newPage();
    popupPage.on('console', msg => console.log('[Popup2 Console]', msg.type(), msg.text()));
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });

    // Verify popup rehydrated to RECORDING immediately
    const rehydratedStatus = await popupPage.$eval('#statusText', el => el.textContent?.trim());
    const rehydratedTimer = await popupPage.$eval('#recordingTimer', el => el.textContent?.trim());
    const pauseBtnText = await popupPage.$eval('#pauseResumeButton', el => el.textContent?.trim());

    console.log(`Rehydrated Status: "${rehydratedStatus}", Timer: "${rehydratedTimer}", Button: "${pauseBtnText}"`);
    if (rehydratedStatus !== 'RECORDING') {
      throw new Error(`Expected rehydrated status 'RECORDING', got '${rehydratedStatus}'`);
    }
    if (rehydratedTimer === '00:00') {
      throw new Error(`Expected preserved timer > 00:00, got '${rehydratedTimer}'`);
    }
    if (pauseBtnText !== 'Pause') {
      throw new Error(`Expected button text 'Pause', got '${pauseBtnText}'`);
    }
    console.log('✅ PASS: Popup perfectly rehydrated active recording state and timer!');

    // =========================================================================
    // STEP 4: Pause Flow & Badge Sync
    // =========================================================================
    console.log('\n--- STEP 4: Pause Flow & Action Badge Verification ---');
    console.log('Clicking #pauseResumeButton ("Pause")...');
    await popupPage.click('#pauseResumeButton');

    // Wait for PAUSED state
    for (let i = 0; i < 40; i++) {
      recordingStatus = await popupPage.$eval('#statusText', el => el.textContent?.trim());
      if (recordingStatus === 'PAUSED') break;
      await new Promise(r => setTimeout(r, 200));
    }
    if (recordingStatus !== 'PAUSED') {
      throw new Error(`Expected PAUSED status, got '${recordingStatus}'`);
    }

    const pausedBtnText = await popupPage.$eval('#pauseResumeButton', el => el.textContent?.trim());
    console.log(`Paused button text: "${pausedBtnText}"`);
    if (pausedBtnText !== 'Resume') {
      throw new Error(`Expected button text 'Resume', got '${pausedBtnText}'`);
    }

    // Verify action badge is 'PAUS'
    const pausBadge = await worker.evaluate(async () => {
      const chrome = globalThis.chrome;
      return await chrome.action.getBadgeText({});
    });
    console.log(`Paused badge text: "${pausBadge}"`);
    if (pausBadge !== 'PAUS') {
      throw new Error(`Expected badge 'PAUS', got '${pausBadge}'`);
    }
    console.log('✅ PASS: Action badge is "PAUS"');

    // =========================================================================
    // STEP 5: Reopen Popup While Paused
    // =========================================================================
    console.log('\n--- STEP 5: Reopen Popup While Paused ---');
    await popupPage.close();
    await new Promise(r => setTimeout(r, 1000));

    popupPage = await browser.newPage();
    popupPage.on('console', msg => console.log('[Popup3 Console]', msg.type(), msg.text()));
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });

    const pausedRehydratedStatus = await popupPage.$eval('#statusText', el => el.textContent?.trim());
    const pausedRehydratedBtn = await popupPage.$eval('#pauseResumeButton', el => el.textContent?.trim());
    console.log(`Reopened while paused: Status="${pausedRehydratedStatus}", Button="${pausedRehydratedBtn}"`);
    if (pausedRehydratedStatus !== 'PAUSED' || pausedRehydratedBtn !== 'Resume') {
      throw new Error('Failed to restore paused state on popup reopen');
    }
    console.log('✅ PASS: Paused state preserved across popup closure');

    // =========================================================================
    // STEP 6: Resume Flow
    // =========================================================================
    console.log('\n--- STEP 6: Resume Flow ---');
    console.log('Clicking #pauseResumeButton ("Resume")...');
    await popupPage.click('#pauseResumeButton');

    for (let i = 0; i < 40; i++) {
      recordingStatus = await popupPage.$eval('#statusText', el => el.textContent?.trim());
      if (recordingStatus === 'RECORDING') break;
      await new Promise(r => setTimeout(r, 200));
    }
    if (recordingStatus !== 'RECORDING') {
      throw new Error(`Expected RECORDING status, got '${recordingStatus}'`);
    }

    const resumedBadge = await worker.evaluate(async () => {
      const chrome = globalThis.chrome;
      return await chrome.action.getBadgeText({});
    });
    console.log(`Resumed badge text: "${resumedBadge}"`);
    if (resumedBadge !== 'REC') {
      throw new Error(`Expected badge 'REC', got '${resumedBadge}'`);
    }
    console.log('✅ PASS: Resumed successfully, action badge returned to "REC"');

    // Record for 2 more seconds
    await new Promise(r => setTimeout(r, 2000));

    // =========================================================================
    // STEP 7: Stop Flow & Badge Cleanup
    // =========================================================================
    console.log('\n--- STEP 7: Stop Flow & Finalization ---');
    console.log('Clicking #stopButton ("Stop")...');
    await popupPage.click('#stopButton');

    for (let i = 0; i < 40; i++) {
      recordingStatus = await popupPage.$eval('#statusText', el => el.textContent?.trim());
      if (recordingStatus === 'READY') break;
      await new Promise(r => setTimeout(r, 250));
    }
    if (recordingStatus !== 'READY') {
      throw new Error(`Expected READY status, got '${recordingStatus}'`);
    }

    const readyBadge = await worker.evaluate(async () => {
      const chrome = globalThis.chrome;
      return await chrome.action.getBadgeText({});
    });
    console.log(`Final badge text: "${readyBadge}"`);
    if (readyBadge !== '') {
      throw new Error(`Expected empty badge text after stop, got '${readyBadge}'`);
    }
    console.log('✅ PASS: Badge cleared upon stop');

    const base64Data = await popupPage.evaluate(() => window.__lastRecordingBase64);
    const videoBuffer = Buffer.from(base64Data, 'base64');
    console.log(`Final recorded video buffer size: ${videoBuffer.length} bytes`);
    if (!verifyEbmlHeader(videoBuffer)) {
      throw new Error('Final WebM missing valid EBML container header');
    }
    console.log('✅ PASS: Final WebM container header verified (0x1A 0x45 0xDF 0xA3)');

    console.log('\n======================================================');
    console.log('🎉 ALL OCS-107 CONTROLS & PERSISTENCE TESTS PASSED!');
    console.log('======================================================');
  } finally {
    await browser.close();
    server.close();
  }
}

async function main() {
  const server = await startServer();
  try {
    await runRecordingControlsTest(server);
    process.exit(0);
  } catch (err) {
    console.error('❌ OCS-107 Test Failed:', err);
    server.close();
    process.exit(1);
  }
}

main();
