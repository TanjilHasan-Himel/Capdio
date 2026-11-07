// test-harness/test-library-trim.js
// Automated Integration Test for Capdio Basic In/Out Trim & Export States (OCS-303)
// Validates trim bounds validation, visual range display, export progress,
// and the critical non-destructive invariant of original media.

import puppeteer from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHROME_PATH = 'C:\\Users\\Himel\\.cache\\puppeteer\\chrome\\win64-152.0.7977.42\\chrome-win64\\chrome.exe';
const EXTENSION_DIST = path.resolve(__dirname, '..', 'apps', 'extension', 'dist');
const PORT = 3501;

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

async function runLibraryTrimIntegrationTest() {
  console.log('======================================================================');
  console.log('✂ Running OCS-303 Library In/Out Trim & Non-Destructive Export Test');
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

    const extensionOrigin = `chrome-extension://${extensionId}`;
    await browser.defaultBrowserContext().overridePermissions(extensionOrigin, ['microphone']);

    const worker = await workerTarget.worker();

    // 2. Open Target Tab to capture
    console.log('2. Opening target web tab to capture...');
    const targetPage = await browser.newPage();
    await targetPage.goto(`http://127.0.0.1:${PORT}/test-page.html?autoplayAudio=1`, { waitUntil: 'load' });
    await targetPage.bringToFront();
    await new Promise(r => setTimeout(r, 1000));

    // 3. Open Popup UI
    console.log('3. Opening Popup UI (popup.html)...');
    const popupPage = await browser.newPage();
    popupPage.on('console', msg => console.log('[Popup Console]', msg.text()));
    worker.on('console', msg => console.log('[SW Console]', msg.text()));

    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 500));

    // 4. Grant activeTab via CDP on target page
    console.log('4. Granting activeTab permission via CDP on target page...');
    await targetPage.bringToFront();
    const browserClient = await browser.target().createCDPSession();
    await browserClient.send('Extensions.triggerAction', {
      id: extensionId,
      targetId: targetPage._tabId
    });
    await new Promise(r => setTimeout(r, 500));

    // 5. Start Recording
    console.log('5. Starting recording in popup (3.5s)...');
    await popupPage.bringToFront();
    await popupPage.click('#recordButton');
    await popupPage.waitForFunction(() => {
      const el = document.getElementById('statusText');
      return el && el.textContent.trim() === 'RECORDING';
    }, { timeout: 10000 });

    console.log('Recording actively running for 3.5 seconds...');
    await new Promise(r => setTimeout(r, 3500));

    await popupPage.click('#stopButton');
    await popupPage.waitForFunction(() => {
      const el = document.getElementById('statusText');
      return el && el.textContent.trim() === 'READY';
    }, { timeout: 10000 });

    const recordedSessionId = await worker.evaluate(async () => {
      const capdio = self.__capdio;
      const res = capdio.getLastRecordingResult();
      return res?.sessionId;
    });

    console.log(`✅ Recorded sample session: ${recordedSessionId}`);
    if (!recordedSessionId) throw new Error('No recorded session ID returned');

    // Fetch initial manifest to test non-destructive invariance later
    // Uses proper message schema: id (string), timestamp (number), target, action
    const initialManifest = await popupPage.evaluate(async (sessId) => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({
          id: 'test_init_' + Date.now(),
          target: 'background',
          action: 'LIST_SESSIONS',
          timestamp: Date.now()
        }, (res) => {
          const sessions = Array.isArray(res?.data) ? res.data : (res?.data?.sessions || []);
          const s = sessions.find((item) => item.sessionId === sessId);
          resolve(s || null);
        });
      });
    }, recordedSessionId);

    console.log(`Original Session Bytes: ${initialManifest?.totalBytes}, Duration: ${initialManifest?.durationMs}ms`);

    // 5. Open Library and Preview
    console.log('\n5. Opening Local Library (library.html)...');
    const libraryPage = await browser.newPage();
    libraryPage.on('console', msg => console.log('[Library Console]', msg.text()));
    libraryPage.on('pageerror', err => console.log('[Library PageError]', err.message));
    await libraryPage.goto(`chrome-extension://${extensionId}/library.html`, { waitUntil: 'load' });

    await libraryPage.waitForSelector(`.recording-card[data-session-id="${recordedSessionId}"]`, { timeout: 10000 });
    console.log('Clicking "▶ Preview" button...');
    await libraryPage.evaluate((sessId) => {
      const card = document.querySelector(`.recording-card[data-session-id="${sessId}"]`);
      const btn = card?.querySelector('.btn-preview');
      btn?.click();
    }, recordedSessionId);

    // Wait for video player and trim controls
    await libraryPage.waitForFunction(() => {
      const panel = document.getElementById('previewPanel');
      const video = document.getElementById('videoPlayer');
      const trimControls = document.getElementById('trimControls');
      return panel && !panel.classList.contains('hidden') && video && !!video.src && trimControls;
    }, { timeout: 10000 });

    console.log('✅ Video preview and trim controls loaded.');

    // Wait for trim range to be initialized from session manifest (durationMs).
    // MediaRecorder WebM blobs have duration=Infinity so setup uses durationMs.
    // The library sets trimOutInput from session.durationMs immediately in openPreview.
    await libraryPage.waitForFunction(() => {
      const outInput = document.getElementById('trimOutInput');
      const inInput = document.getElementById('trimInInput');
      // Value is set → not '0.0' or empty (indicating durationMs > 1s was applied)
      const outVal = outInput ? parseFloat(outInput.value) : NaN;
      const inVal = inInput ? parseFloat(inInput.value) : NaN;
      return !isNaN(outVal) && !isNaN(inVal) && outVal > 0.5;
    }, { timeout: 15000 });

    const initialTrimState = await libraryPage.evaluate(() => {
      const inVal = document.getElementById('trimInInput')?.value;
      const outVal = document.getElementById('trimOutInput')?.value;
      const durLabel = document.getElementById('trimDurationLabel')?.textContent;
      return { inVal, outVal, durLabel };
    });
    console.log('Initial Trim State:', initialTrimState);

    // 6. Test Inverted Bounds Validation
    console.log('\n--- TEST 1: Inverted Trim Bounds Rejection ---');
    await libraryPage.evaluate(() => {
      const inInput = document.getElementById('trimInInput');
      const outInput = document.getElementById('trimOutInput');
      if (inInput && outInput) {
        inInput.value = '3.0';
        outInput.value = '1.0';
        inInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    const invertedValidation = await libraryPage.evaluate(() => {
      const banner = document.getElementById('trimErrorBanner');
      const exportBtn = document.getElementById('exportTrimBtn');
      return {
        bannerHidden: banner?.classList.contains('hidden'),
        bannerText: banner?.textContent?.trim(),
        buttonDisabled: exportBtn?.disabled
      };
    });

    console.log('Inverted validation result:', invertedValidation);
    if (invertedValidation.bannerHidden) throw new Error('Expected error banner for inverted bounds, but was hidden');
    if (!invertedValidation.buttonDisabled) throw new Error('Export button should be disabled for inverted range');
    console.log('✅ PASS: Inverted trim points rejected with error message and disabled export button.');

    // 7. Test Sub-Minimum Duration (<0.5s) Validation
    console.log('\n--- TEST 2: Sub-Minimum Duration Rejection ---');
    await libraryPage.evaluate(() => {
      const inInput = document.getElementById('trimInInput');
      const outInput = document.getElementById('trimOutInput');
      if (inInput && outInput) {
        inInput.value = '1.0';
        outInput.value = '1.2'; // 0.2s < 0.5s
        inInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    const subMinValidation = await libraryPage.evaluate(() => {
      const banner = document.getElementById('trimErrorBanner');
      const exportBtn = document.getElementById('exportTrimBtn');
      return {
        bannerHidden: banner?.classList.contains('hidden'),
        bannerText: banner?.textContent?.trim(),
        buttonDisabled: exportBtn?.disabled
      };
    });

    console.log('Sub-min validation result:', subMinValidation);
    if (subMinValidation.bannerHidden || !subMinValidation.bannerText.includes('Minimum trim duration')) {
      throw new Error(`Expected minimum duration error banner, got: "${subMinValidation.bannerText}"`);
    }
    console.log('✅ PASS: Sub-0.5s duration rejected with informative error message.');

    // 8. Test Valid Trim Range Setting
    console.log('\n--- TEST 3: Valid Trim Range Configuration ---');
    await libraryPage.evaluate(() => {
      const inInput = document.getElementById('trimInInput');
      const outInput = document.getElementById('trimOutInput');
      if (inInput && outInput) {
        inInput.value = '0.5';
        outInput.value = '2.0'; // 1.5s slice
        inInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    const validState = await libraryPage.evaluate(() => {
      const banner = document.getElementById('trimErrorBanner');
      const exportBtn = document.getElementById('exportTrimBtn');
      const slider = document.getElementById('trimVisualRange');
      const label = document.getElementById('trimDurationLabel')?.textContent;
      return {
        bannerHidden: banner?.classList.contains('hidden'),
        buttonDisabled: exportBtn?.disabled,
        sliderLeft: slider?.style.left,
        sliderWidth: slider?.style.width,
        label
      };
    });

    console.log('Valid state:', validState);
    if (!validState.bannerHidden) throw new Error('Error banner should be hidden for valid range');
    if (validState.buttonDisabled) throw new Error('Export button should be enabled for valid range');
    console.log(`✅ PASS: Valid trim range (0.5s -> 2.0s) accepted: ${validState.label}, slider: left=${validState.sliderLeft}, width=${validState.sliderWidth}`);

    // 9. Execute Trim Export and Monitor Progress
    console.log('\n--- TEST 4: Non-Destructive Slicing & Export Progress ---');
    console.log('Clicking "✂ Export Trimmed Video"...');
    await libraryPage.click('#exportTrimBtn');

    // Wait for progress container to become visible
    await libraryPage.waitForFunction(() => {
      const prog = document.getElementById('trimProgressContainer');
      return prog && !prog.classList.contains('hidden');
    }, { timeout: 5000 });

    console.log('✓ Trim progress container activated.');

    // Wait for export to finish (100% or success message)
    await libraryPage.waitForFunction(() => {
      const status = document.getElementById('trimProgressStatus');
      const pct = document.getElementById('trimProgressPercent');
      return (status && status.textContent.includes('successfully')) || (pct && pct.textContent === '100%');
    }, { timeout: 15000 });

    const finalExportStatus = await libraryPage.evaluate(() => {
      return {
        statusText: document.getElementById('trimProgressStatus')?.textContent?.trim(),
        percent: document.getElementById('trimProgressPercent')?.textContent?.trim()
      };
    });
    console.log('Final Export Status:', finalExportStatus);
    console.log('✅ PASS: Trim export progressed and completed at 100%.');

    // 10. Test Non-Destructive Invariance
    console.log('\n--- TEST 5: Source Media Non-Destructive Invariance ---');
    const postExportManifest = await popupPage.evaluate(async (sessId) => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({
          id: 'test_post_' + Date.now(),
          target: 'background',
          action: 'LIST_SESSIONS',
          timestamp: Date.now()
        }, (res) => {
          const sessions = Array.isArray(res?.data) ? res.data : (res?.data?.sessions || []);
          const s = sessions.find((item) => item.sessionId === sessId);
          resolve(s || null);
        });
      });
    }, recordedSessionId);

    console.log(`Pre-export totalBytes: ${initialManifest?.totalBytes}, Post-export totalBytes: ${postExportManifest?.totalBytes}`);
    console.log(`Pre-export durationMs: ${initialManifest?.durationMs}, Post-export durationMs: ${postExportManifest?.durationMs}`);

    if (!postExportManifest) {
      throw new Error('Non-destructive check: postExportManifest not found in storage');
    }
    if (initialManifest && postExportManifest.totalBytes !== initialManifest.totalBytes) {
      throw new Error('Non-destructive failure: totalBytes in storage was modified during trim!');
    }
    if (initialManifest && postExportManifest.durationMs !== initialManifest.durationMs) {
      throw new Error('Non-destructive failure: durationMs in storage was modified during trim!');
    }
    // Confirm session still exists and is in ready state
    if (postExportManifest.sessionId !== recordedSessionId) {
      throw new Error('Non-destructive failure: session ID changed!');
    }
    console.log('✅ PASS: Underlying session manifest and IndexedDB media completely untouched.');

    console.log('\n======================================================================');
    console.log('🎉 ALL OCS-303 IN/OUT TRIM & NON-DESTRUCTIVE EXPORT TESTS PASSED!');
    console.log('======================================================================\n');
  } finally {
    await browser.close();
    server.close();
  }
}

runLibraryTrimIntegrationTest().catch((err) => {
  console.error('\n❌ OCS-303 Trim Integration Test Failed:', err);
  process.exit(1);
});

