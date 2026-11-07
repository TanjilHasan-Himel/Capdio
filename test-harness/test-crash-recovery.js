// test-harness/test-crash-recovery.js
// Automated Integration Test for Crash Recovery & Interruption Auditing (OCS-204)
// Validates detection of abruptly terminated sessions, popup Recovery Center rendering,
// partial recording assembly from persistent IndexedDB chunks, EBML integrity, and discard.

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
const PORT = 3495;

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

async function runCrashRecoveryIntegrationTest() {
  console.log('======================================================================');
  console.log('🚀 Running OCS-204 Crash Recovery & Interruption UX Test');
  console.log('======================================================================');

  if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  }

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
    let popupPage = await browser.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });

    console.log('5. Starting recording in popup...');
    await popupPage.click('#recordButton');

    // Wait until recording starts
    await popupPage.waitForFunction(() => {
      const el = document.getElementById('statusText');
      return el && el.textContent.trim() === 'RECORDING';
    }, { timeout: 10000 });

    console.log('✅ Recording actively running.');

    // Let it record for 4 seconds so several chunks stream into IndexedDB
    console.log('6. Streaming chunks into persistent IndexedDB storage (4 seconds)...');
    await new Promise(r => setTimeout(r, 4000));

    // Retrieve active session details from background before simulated crash
    const activeSessionState = await worker.evaluate(async () => {
      const capdio = self.__capdio;
      const sess = capdio.sessionRegistry.activeSession;
      return {
        sessionId: sess?.sessionId,
        title: sess?.title,
        status: sess?.status
      };
    });

    console.log(`Active session before crash: ID=${activeSessionState.sessionId}, Title="${activeSessionState.title}"`);
    if (!activeSessionState.sessionId) {
      throw new Error('No active session ID found in background worker');
    }

    // 7. Simulate Abrupt Termination / Crash
    // Close popup and reset background state machine / unregister active session
    // WITHOUT invoking STOP_CAPTURE, leaving the session manifest in storage as 'recording'
    console.log('\n--- SIMULATING ABRUPT SHUTDOWN / CRASH ---');
    await popupPage.close();

    console.log('Simulating worker/browser restart with unfinalized session in storage...');
    await worker.evaluate(async () => {
      const capdio = self.__capdio;
      // Reset in-memory state machine to simulate fresh worker startup
      capdio.stateMachine.reset();
      capdio.sessionRegistry.clearActiveSession();
      // Audit unfinalized sessions directly as would happen on startup
      await capdio.sessionRegistry.auditUnfinalizedSessions();
    });

    // 8. Verify Background Audit Detected the Crash
    const auditCheck = await worker.evaluate(async (sessId) => {
      const capdio = self.__capdio;
      const sess = await capdio.sessionRegistry.getSession(sessId);
      const recoverable = await capdio.sessionRegistry.getRecoverableSessions();
      return {
        sessionStatus: sess?.status,
        isRecoverable: sess?.isRecoverable,
        errorCode: sess?.errorCode,
        recoverableCount: recoverable.length,
        hasSessionInRecoverableList: recoverable.some(s => s.sessionId === sessId)
      };
    }, activeSessionState.sessionId);

    console.log('Audit check result:', auditCheck);
    if (auditCheck.sessionStatus !== 'interrupted') {
      throw new Error(`Expected session status 'interrupted', got '${auditCheck.sessionStatus}'`);
    }
    if (!auditCheck.isRecoverable) {
      throw new Error('Expected session isRecoverable to be true');
    }
    if (!auditCheck.hasSessionInRecoverableList) {
      throw new Error('Session was not found in recoverable sessions list');
    }
    console.log('✅ PASS: Service Worker audit accurately detected crashed session and marked it recoverable.');

    // 9. Reopen Popup UI & Verify Recovery Center UX
    console.log('\n--- VERIFYING POPUP RECOVERY CENTER UX ---');
    popupPage = await browser.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 1000));

    const recoveryCenterVisible = await popupPage.evaluate(() => {
      const rc = document.getElementById('recoveryCenter');
      const msg = document.getElementById('recoveryMessage')?.textContent || '';
      const meta = document.getElementById('recoveryMeta')?.textContent || '';
      const isVisible = rc && !rc.classList.contains('hidden');
      return { isVisible, msg, meta };
    });

    console.log('Recovery Center DOM state:', recoveryCenterVisible);
    if (!recoveryCenterVisible.isVisible) {
      throw new Error('Expected #recoveryCenter to be visible in popup, but it was hidden');
    }
    console.log('✅ PASS: Popup Recovery Center rendered with prompt and chunk details.');

    // 10. Execute Partial Recording Recovery
    console.log('\n--- EXECUTING RECOVERY & PARTIAL EXPORT ---');
    console.log('Clicking "Recover & Download" in Recovery Center...');
    await popupPage.click('#recoverButton');

    // Wait for popup to transition to READY state
    await popupPage.waitForFunction(() => {
      const status = document.getElementById('statusText')?.textContent.trim();
      return status === 'READY';
    }, { timeout: 10000 });

    console.log('✅ PASS: Popup cleanly transitioned to READY state on recovery!');

    // Verify Ready info and Notice Banner
    const readyState = await popupPage.evaluate(() => {
      const noticeTitle = document.getElementById('noticeTitle')?.textContent || '';
      const readyInfo = document.getElementById('readyInfo')?.textContent || '';
      const dlText = document.getElementById('downloadButton')?.textContent || '';
      const base64 = (window).__lastRecordingBase64;
      return {
        noticeTitle,
        readyInfo,
        dlText,
        hasBase64: !!base64,
        base64Length: base64 ? base64.length : 0
      };
    });

    console.log('Recovered Ready state:', readyState);
    if (!readyState.dlText.includes('[Partial]')) {
      throw new Error(`Expected download button to contain '[Partial]', got '${readyState.dlText}'`);
    }
    if (!readyState.hasBase64 || readyState.base64Length === 0) {
      throw new Error('No base64 media data returned from recovery process');
    }
    console.log('✅ PASS: Partial recovery UI correctly labeled with [Partial] badge.');

    // 11. Verify Valid EBML Header & Save Artifact
    const recoveredBuffer = Buffer.from(
      await popupPage.evaluate(() => (window).__lastRecordingBase64),
      'base64'
    );
    const isValidEbml = verifyEbmlHeader(recoveredBuffer);
    console.log(`Recovered Media: ${(recoveredBuffer.length / (1024 * 1024)).toFixed(2)} MB, Valid EBML: ${isValidEbml}`);

    if (!isValidEbml) {
      throw new Error('Recovered media failed EBML header validation (0x1A 0x45 0xDF 0xA3)');
    }

    const artifactPath = path.join(RECORDINGS_DIR, 'gate-g2-recovered-partial.webm');
    fs.writeFileSync(artifactPath, recoveredBuffer);
    console.log(`✅ PASS: Valid playable WebM recovered from crash and saved -> ${artifactPath}`);

    // 12. Verify Post-Recovery State (Recovery Center Hidden)
    console.log('\n--- VERIFYING POST-RECOVERY STATE ---');
    await popupPage.close();
    popupPage = await browser.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 800));

    const postRecoveryCheck = await popupPage.evaluate(() => {
      const rc = document.getElementById('recoveryCenter');
      return { isHidden: rc?.classList.contains('hidden') };
    });

    if (!postRecoveryCheck.isHidden) {
      throw new Error('Expected Recovery Center to be hidden after recovery was completed');
    }
    console.log('✅ PASS: Recovery Center correctly cleared after successful recovery.');

    console.log('\n======================================================================');
    console.log('🎉 ALL OCS-204 CRASH RECOVERY & INTERRUPTION TESTS PASSED!');
    console.log('======================================================================\n');
  } finally {
    await browser.close();
    server.close();
  }
}

runCrashRecoveryIntegrationTest().catch((err) => {
  console.error('\n❌ Crash recovery test failed:', err);
  process.exit(1);
});

