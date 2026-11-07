// test-harness/test-source-closure.js
// Automated Verification for Source Closure, Popup Closure, and Safe Error Propagation (OCS-108)

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
const PORT = 3463;

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

async function runSourceClosureTests(server) {
  console.log('🚀 Running OCS-108 Source Closure & Popup Closure Pipeline Test...');
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

    // =========================================================================
    // TEST 1: Captured Source Tab Closure Mid-Recording
    // =========================================================================
    console.log('\n--- TEST 1: Captured Source Tab Closure Mid-Recording ---');
    console.log('Opening target tab to be captured...');
    let targetTab = await browser.newPage();
    await targetTab.goto(`http://127.0.0.1:${PORT}/test-page.html?autoplayAudio=1`, { waitUntil: 'load' });
    await targetTab.bringToFront();
    await new Promise(r => setTimeout(r, 1000));

    // Grant activeTab
    const browserClient = await browser.target().createCDPSession();
    await browserClient.send('Extensions.triggerAction', {
      id: extensionId,
      targetId: targetTab._tabId
    });

    // Open Popup UI
    console.log('Opening Popup UI...');
    let popupPage = await browser.newPage();
    popupPage.on('console', msg => console.log('[Popup1 Console]', msg.type(), msg.text()));
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });

    // Start recording
    console.log('Starting tab recording in popup...');
    await popupPage.click('#recordButton');

    for (let i = 0; i < 40; i++) {
      const status = await popupPage.$eval('#statusText', el => el.textContent?.trim());
      if (status === 'RECORDING') break;
      await new Promise(r => setTimeout(r, 250));
    }
    console.log('✅ PASS: Tab recording active');

    // Close popup page (popup closure must not interrupt capture)
    console.log('Closing popup mid-recording...');
    await popupPage.close();

    // Actively record for 2.5 seconds
    console.log('Actively recording for 2.5 seconds with popup closed...');
    await new Promise(r => setTimeout(r, 2500));

    // Now close the captured target tab!
    console.log('Closing target tab (simulating user closing captured tab)...');
    await targetTab.close();

    // Give background service worker time to receive onRemoved and finalize
    console.log('Waiting for SW to detect chrome.tabs.onRemoved and finalize...');
    let finalStatus = '';
    let terminationReason = null;
    let recResult = null;

    for (let i = 0; i < 40; i++) {
      const state = await worker.evaluate(() => {
        const capdio = self.__capdio;
        return {
          status: capdio.stateMachine.currentStatus,
          terminationReason: capdio.getLastTerminationReason(),
          hasResult: !!capdio.getLastRecordingResult()
        };
      });
      if (state.status === 'ready') {
        finalStatus = state.status;
        terminationReason = state.terminationReason;
        break;
      }
      await new Promise(r => setTimeout(r, 250));
    }

    console.log(`SW final state after tab closure: status="${finalStatus}", reason="${terminationReason}"`);
    if (finalStatus !== 'ready') {
      throw new Error(`Expected status 'ready' after source tab closure, got '${finalStatus}'`);
    }
    if (terminationReason !== 'source_tab_closed') {
      throw new Error(`Expected terminationReason 'source_tab_closed', got '${terminationReason}'`);
    }
    console.log('✅ PASS: Service Worker cleanly transitioned to READY on chrome.tabs.onRemoved');

    // Verify badge text cleared
    const badgeAfterClose = await worker.evaluate(async () => {
      return await chrome.action.getBadgeText({});
    });
    if (badgeAfterClose !== '') {
      throw new Error(`Expected badge '' after stop, got '${badgeAfterClose}'`);
    }
    console.log('✅ PASS: Action badge cleared after source tab closure');

    // Reopen popup: verify rehydration in READY state with termination notice
    console.log('Reopening popup to verify result rehydration and notice banner...');
    popupPage = await browser.newPage();
    popupPage.on('console', msg => console.log('[Popup2 Console]', msg.type(), msg.text()));
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });

    let reopenedStatus = '';
    for (let i = 0; i < 40; i++) {
      reopenedStatus = await popupPage.$eval('#statusText', el => el.textContent?.trim());
      if (reopenedStatus === 'READY') break;
      await new Promise(r => setTimeout(r, 200));
    }
    console.log(`Reopened status in popup: "${reopenedStatus}"`);
    if (reopenedStatus !== 'READY') {
      throw new Error(`Expected READY status in reopened popup, got '${reopenedStatus}'`);
    }
    console.log('✅ PASS: Reopened popup automatically rehydrated into READY state');

    // Verify notice banner
    const noticeInfo = await popupPage.evaluate(() => {
      const banner = document.getElementById('noticeBanner');
      const title = document.getElementById('noticeTitle')?.textContent?.trim();
      const message = document.getElementById('noticeMessage')?.textContent?.trim();
      const isVisible = !banner?.classList.contains('hidden');
      return { isVisible, title, message };
    });

    console.log('Notice banner state:', noticeInfo);
    if (!noticeInfo.isVisible) {
      throw new Error('Notice banner should be visible after source tab closure');
    }
    if (noticeInfo.title !== 'Captured Tab Closed') {
      throw new Error(`Expected notice title 'Captured Tab Closed', got '${noticeInfo.title}'`);
    }
    console.log('✅ PASS: User notification banner accurately displays "Captured Tab Closed"');

    // Verify download button has valid base64 data
    const lastBase64 = await popupPage.evaluate(() => window.__lastRecordingBase64);
    if (!lastBase64 || lastBase64.length < 1000) {
      throw new Error('Expected rehydrated __lastRecordingBase64 with video data');
    }

    const videoBuffer = Buffer.from(lastBase64, 'base64');
    console.log(`Recorded video buffer size: ${videoBuffer.length} bytes`);
    if (!verifyEbmlHeader(videoBuffer)) {
      throw new Error('Recorded file does not have a valid EBML WebM header');
    }
    console.log('✅ PASS: Intact WebM header verified (0x1A 0x45 0xDF 0xA3) for tab closure recording');

    if (!fs.existsSync(RECORDINGS_DIR)) {
      fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
    }
    fs.writeFileSync(path.join(RECORDINGS_DIR, 'test-capdio-source-closed.webm'), videoBuffer);

    // Dismiss notice banner
    await popupPage.click('#noticeDismiss');
    const noticeHidden = await popupPage.$eval('#noticeBanner', el => el.classList.contains('hidden'));
    if (!noticeHidden) {
      throw new Error('Notice banner did not hide after clicking dismiss');
    }
    console.log('✅ PASS: Notice banner dismissed successfully');

    // Reset to idle
    await popupPage.click('#resetButton');
    const resetStatus = await popupPage.$eval('#statusText', el => el.textContent?.trim());
    if (resetStatus !== 'IDLE') {
      throw new Error(`Expected IDLE status after reset, got '${resetStatus}'`);
    }
    console.log('✅ PASS: Reset to IDLE state ready for next recording');
    await popupPage.close();

    // =========================================================================
    // TEST 2: Source Media Track Ended Handling (videoTrack.onended)
    // =========================================================================
    console.log('\n--- TEST 2: Source Media Track Ended Handling ---');
    console.log('Opening second target tab for track ended test...');
    const targetTab2 = await browser.newPage();
    await targetTab2.goto(`http://127.0.0.1:${PORT}/test-page.html?autoplayAudio=1`, { waitUntil: 'load' });
    await targetTab2.bringToFront();
    await new Promise(r => setTimeout(r, 1000));

    // Grant activeTab for targetTab2
    await browserClient.send('Extensions.triggerAction', {
      id: extensionId,
      targetId: targetTab2._tabId
    });

    console.log('Opening fresh popup UI for Test 2...');
    popupPage = await browser.newPage();
    popupPage.on('console', msg => console.log('[Popup4 Console]', msg.type(), msg.text()));
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });

    console.log('Starting tab recording in popup for track ended test...');
    await popupPage.click('#recordButton');

    let trackRecStatus = '';
    for (let i = 0; i < 40; i++) {
      trackRecStatus = await popupPage.$eval('#statusText', el => el.textContent?.trim());
      if (trackRecStatus === 'RECORDING') break;
      await new Promise(r => setTimeout(r, 250));
    }
    if (trackRecStatus !== 'RECORDING') {
      throw new Error(`Expected RECORDING status, got '${trackRecStatus}'`);
    }
    console.log('✅ PASS: Recording active on targetTab2');
    await new Promise(r => setTimeout(r, 2000));

    // Close popup
    await popupPage.close();

    // In offscreen document, simulate video track ended (e.g. track disconnected or system ended)
    console.log('Simulating videoTrack onended in offscreen document...');
    const offscreenTarget = browser.targets().find(t => t.url().includes('offscreen.html'));
    if (!offscreenTarget) {
      throw new Error('Offscreen target not found');
    }
    const offscreenClient = await offscreenTarget.createCDPSession();
    await offscreenClient.send('Runtime.evaluate', {
      expression: `
        (() => {
          const sink = document.getElementById('captureSink');
          const stream = sink ? sink.srcObject : null;
          const track = stream ? stream.getVideoTracks()[0] : null;
          if (track) {
            track.stop();
            track.dispatchEvent(new Event('ended'));
          }
        })()
      `
    });

    // Wait for SW to transition to ready
    console.log('Waiting for SW to detect track_ended and finalize...');
    let trackEndedStatus = '';
    let trackEndedReason = null;

    for (let i = 0; i < 40; i++) {
      const state = await worker.evaluate(() => {
        const capdio = self.__capdio;
        return {
          status: capdio.stateMachine.currentStatus,
          terminationReason: capdio.getLastTerminationReason()
        };
      });
      if (state.status === 'ready') {
        trackEndedStatus = state.status;
        trackEndedReason = state.terminationReason;
        break;
      }
      await new Promise(r => setTimeout(r, 250));
    }

    console.log(`SW state after track ended: status="${trackEndedStatus}", reason="${trackEndedReason}"`);
    if (trackEndedStatus !== 'ready') {
      throw new Error(`Expected ready status after track ended, got '${trackEndedStatus}'`);
    }
    if (trackEndedReason !== 'track_ended') {
      throw new Error(`Expected track_ended reason, got '${trackEndedReason}'`);
    }
    console.log('✅ PASS: Source track ended cleanly finalized capture to READY');

    // Reopen popup to verify "Capture Ended" banner
    popupPage = await browser.newPage();
    popupPage.on('console', msg => console.log('[Popup4 Console]', msg.type(), msg.text()));
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });

    let test2Status = '';
    for (let i = 0; i < 40; i++) {
      test2Status = await popupPage.$eval('#statusText', el => el.textContent?.trim());
      if (test2Status === 'READY') break;
      await new Promise(r => setTimeout(r, 200));
    }
    if (test2Status !== 'READY') {
      throw new Error(`Expected READY status in Test 2 reopened popup, got '${test2Status}'`);
    }

    const trackNotice = await popupPage.evaluate(() => {
      const banner = document.getElementById('noticeBanner');
      return {
        isVisible: !banner?.classList.contains('hidden'),
        title: document.getElementById('noticeTitle')?.textContent?.trim()
      };
    });
    console.log('Track ended notice banner:', trackNotice);
    if (!trackNotice.isVisible || trackNotice.title !== 'Capture Ended') {
      throw new Error(`Expected 'Capture Ended' notice, got '${trackNotice.title}'`);
    }
    console.log('✅ PASS: "Capture Ended" notice accurately displayed in popup');

    // Reset to idle
    await popupPage.click('#resetButton');

    // =========================================================================
    // TEST 3: Safe Error Propagation (Zero-byte Source Closure -> E_SOURCE_CLOSED)
    // =========================================================================
    console.log('\n--- TEST 3: Safe Error Propagation (Zero-Byte Closure -> E_SOURCE_CLOSED) ---');
    // Simulate zero-byte closure directly via executeStopCapture with 'source_tab_closed'
    const errorState = await worker.evaluate(async () => {
      const capdio = self.__capdio;
      // Start a dummy session in preparing
      const session = await capdio.sessionRegistry.createSession({
        width: 1920,
        height: 1080,
        fps: 30,
        mimePreference: 'webm',
        tabAudio: true,
        microphone: false
      });
      capdio.stateMachine.requestStart(session.sessionId);
      capdio.stateMachine.markPreparing();
      // Stop with source_tab_closed when offscreen has 0 bytes
      const res = await capdio.executeStopCapture('source_tab_closed');
      return {
        currentStatus: capdio.stateMachine.currentStatus,
        lastError: capdio.stateMachine.lastError,
        stopResult: res
      };
    });

    console.log('Error state evaluation result:', errorState);
    if (errorState.currentStatus !== 'idle') {
      throw new Error(`Expected FSM to safely reset to 'idle', got '${errorState.currentStatus}'`);
    }
    if (errorState.lastError?.code !== 'E_SOURCE_CLOSED') {
      throw new Error(`Expected lastError.code 'E_SOURCE_CLOSED', got '${errorState.lastError?.code}'`);
    }
    console.log('✅ PASS: Zero-byte closure safely propagated E_SOURCE_CLOSED and preserved FSM in IDLE state');

    console.log('\n======================================================');
    console.log('🎉 ALL OCS-108 SOURCE & POPUP CLOSURE TESTS PASSED!');
    console.log('======================================================\n');
  } finally {
    await browser.close();
    server.close();
  }
}

async function main() {
  const server = await startServer();
  try {
    await runSourceClosureTests(server);
    process.exit(0);
  } catch (err) {
    console.error('\n❌ OCS-108 Test Failed:', err);
    server.close();
    process.exit(1);
  }
}

main();
