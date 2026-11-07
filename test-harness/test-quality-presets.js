// test-harness/test-quality-presets.js
// Automated E2E Verification for Quality Presets and Honest Measured Quality Reporting (OCS-301)

import puppeteer from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHROME_PATH = 'C:\\Users\\Himel\\.cache\\puppeteer\\chrome\\win64-152.0.7977.42\\chrome-win64\\chrome.exe';
const EXTENSION_DIST = path.resolve(__dirname, '..', 'apps', 'extension', 'dist');
const PORT = 3458;

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

async function runQualityPresetsTest(server) {
  console.log('🚀 Running OCS-301 Quality Presets & Measured Quality E2E Test...');
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
      workerTarget = targets.find(
        (t) => t.type() === 'service_worker' && t.url().includes('chrome-extension://')
      );
      if (workerTarget) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!workerTarget) throw new Error('Capdio Service Worker not found');
    const extensionUrl = workerTarget.url();
    const extensionId = new URL(extensionUrl).hostname;
    console.log(`✓ Service Worker located. Extension ID: ${extensionId}`);

    const extensionOrigin = `chrome-extension://${extensionId}`;
    await browser.defaultBrowserContext().overridePermissions(extensionOrigin, ['microphone']);

    const worker = await workerTarget.worker();

    // 2. Open Target Web Page to be captured
    console.log('2. Opening target fixture page...');
    const targetPage = await browser.newPage();
    await targetPage.setViewport({ width: 1920, height: 1080 });
    await targetPage.goto(`http://127.0.0.1:${PORT}/test-page.html?autoplayAudio=1`, { waitUntil: 'load' });
    await targetPage.bringToFront();
    await new Promise((r) => setTimeout(r, 1000));
    console.log(`✓ Target web page loaded: ${targetPage.url()}`);

    // 3. Grant activeTab via CDP
    console.log('3. Triggering Extensions.triggerAction to invoke activeTab...');
    const browserClient = await browser.target().createCDPSession();
    await browserClient.send('Extensions.triggerAction', {
      id: extensionId,
      targetId: targetPage._tabId
    });
    console.log('✓ Extensions.triggerAction delivered.');

    // 4. Open Popup
    console.log('4. Opening extension popup...');
    const popupPage = await browser.newPage();
    popupPage.on('console', (msg) => console.log('[Popup Console]', msg.type(), msg.text()));
    worker.on('console', (msg) => console.log('[SW Console]', msg.text()));

    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });
    await popupPage.waitForSelector('#qualityPreset');
    console.log('✓ Popup UI initialized');

    // 5. Test Preset UI & Hint Syncing
    console.log('5. Testing Preset UI and dynamic hint updates...');
    const initialPreset = await popupPage.$eval('#qualityPreset', (el) => el.value);
    if (initialPreset !== 'balanced') {
      throw new Error(`Expected default preset 'balanced', got '${initialPreset}'`);
    }

    const initialHint = await popupPage.$eval('#presetHint', (el) => el.textContent);
    console.log(`  Initial Hint: "${initialHint}"`);
    if (!initialHint.includes('1080p') || !initialHint.includes('30 FPS')) {
      throw new Error(`Initial hint text unexpected: "${initialHint}"`);
    }

    // Switch to Ultra (4K)
    console.log('  Switching preset to Ultra 4K...');
    await popupPage.select('#qualityPreset', 'ultra');
    const ultraFps = await popupPage.$eval('#fpsSelect', (el) => el.value);
    const ultraHint = await popupPage.$eval('#presetHint', (el) => el.textContent);
    console.log(`  Ultra Hint: "${ultraHint}", FPS: ${ultraFps}`);
    if (ultraFps !== '60' || !ultraHint.includes('2160p') || !ultraHint.includes('60 FPS')) {
      throw new Error(`Ultra preset hint sync failed: fps=${ultraFps}, hint="${ultraHint}"`);
    }

    // Change FPS select to 24 FPS
    console.log('  Changing FPS to 24 FPS...');
    await popupPage.select('#fpsSelect', '24');
    const customFpsHint = await popupPage.$eval('#presetHint', (el) => el.textContent);
    console.log(`  Custom FPS Hint: "${customFpsHint}"`);
    if (!customFpsHint.includes('24 FPS')) {
      throw new Error(`FPS select hint sync failed: "${customFpsHint}"`);
    }

    // Switch back to Balanced for recording test
    await popupPage.select('#qualityPreset', 'balanced');

    // 6. Trigger Single-Tab Recording
    console.log('6. Starting tab recording with Balanced preset...');
    // Ensure activeTab is active on targetPage
    await targetPage.bringToFront();
    await browserClient.send('Extensions.triggerAction', {
      id: extensionId,
      targetId: targetPage._tabId
    });
    await new Promise((r) => setTimeout(r, 500));

    await popupPage.bringToFront();
    await popupPage.waitForSelector('#recordButton:not([disabled])');
    await popupPage.click('#recordButton');

    // 7. Verify Active Recording & Live Quality Badge
    console.log('7. Verifying active recording and live quality badge...');
    let recordingStatus = '';
    for (let i = 0; i < 40; i++) {
      recordingStatus = await popupPage.$eval('#statusText', (el) => el.textContent?.trim());
      if (recordingStatus === 'RECORDING') break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (recordingStatus !== 'RECORDING') {
      throw new Error(`Expected popup status 'RECORDING', got '${recordingStatus}'`);
    }
    console.log('✓ Recording is active in popup UI');

    // Wait 3.5 seconds to accumulate frames and verify live quality badge
    await new Promise((r) => setTimeout(r, 3500));
    const liveQuality = await popupPage.$eval('#liveQualityBadge', (el) => el.textContent);
    console.log(`  Live Quality Badge: "${liveQuality}"`);
    if (!liveQuality || liveQuality === '-' || liveQuality === 'Measuring...') {
      throw new Error(`Live quality badge did not update: "${liveQuality}"`);
    }
    console.log('✓ Live quality badge verified');

    // 8. Stop Recording and Verify Honest Ready Display
    console.log('8. Stopping recording...');
    await popupPage.click('#stopButton');
    let readyStatus = '';
    for (let i = 0; i < 40; i++) {
      readyStatus = await popupPage.$eval('#statusText', (el) => el.textContent?.trim());
      if (readyStatus === 'READY') break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (readyStatus !== 'READY') {
      throw new Error(`Expected popup status 'READY', got '${readyStatus}'`);
    }
    console.log('✓ Finalization complete, ready section displayed');

    const readyInfoText = await popupPage.$eval('#readyInfo', (el) => el.textContent);
    console.log(`  Ready Info:\n"${readyInfoText}"`);
    if (!readyInfoText.includes('Actual:') && !readyInfoText.includes('Quality:')) {
      throw new Error(`Ready info missing quality report: "${readyInfoText}"`);
    }
    console.log('✓ Ready info provides honest quality metrics');

    // 9. Verify Session Manifest via Background Message Bus
    console.log('9. Verifying SessionManifest source info via LIST_SESSIONS...');
    const manifestCheck = await popupPage.evaluate(async () => {
      const msg = {
        id: `msg_${Date.now()}`,
        target: 'background',
        timestamp: Date.now(),
        action: 'LIST_SESSIONS'
      };
      const res = await chrome.runtime.sendMessage(msg);
      const sessions = res?.data?.sessions || [];
      if (!sessions || sessions.length === 0) return null;
      const latest = sessions[sessions.length - 1];
      return {
        sessionId: latest.sessionId,
        profile: latest.profile,
        source: latest.sources?.[0]
      };
    });

    console.log('  Stored Manifest Data:', JSON.stringify(manifestCheck, null, 2));
    if (!manifestCheck) throw new Error('No session saved in registry');
    if (manifestCheck.profile.presetName !== 'balanced') {
      throw new Error(`Expected presetName 'balanced', got '${manifestCheck.profile.presetName}'`);
    }
    if (manifestCheck.source.requestedWidth !== 1920 || manifestCheck.source.requestedHeight !== 1080) {
      throw new Error(`Requested dimensions not saved: ${manifestCheck.source.requestedWidth}x${manifestCheck.source.requestedHeight}`);
    }
    if (!manifestCheck.source.actualWidth || !manifestCheck.source.actualHeight) {
      throw new Error('Actual measured dimensions not recorded in source info');
    }
    console.log(`✓ Stored source: Requested=${manifestCheck.source.requestedWidth}×${manifestCheck.source.requestedHeight}@${manifestCheck.source.requestedFps}, Actual=${manifestCheck.source.actualWidth}×${manifestCheck.source.actualHeight}@${manifestCheck.source.actualFps}`);

    // 10. Verify Local Library Card Quality Reporting
    console.log('10. Verifying Local Library rendering of quality presets...');
    const libraryPage = await browser.newPage();
    await libraryPage.goto(`chrome-extension://${extensionId}/library.html`, { waitUntil: 'load' });
    await libraryPage.waitForSelector('.recording-card');

    const cardDetails = await libraryPage.evaluate(() => {
      const card = document.querySelector('.recording-card');
      const vals = card ? Array.from(card.querySelectorAll('.metric-value')).map(v => v.textContent?.trim()) : [];
      const badge = card?.querySelector('.preset-badge')?.textContent?.trim() || null;
      return { quality: vals[2] || '', badge };
    });
    console.log(`  Library Card Quality: "${cardDetails.quality}", Preset Badge: "${cardDetails.badge}"`);
    if (!cardDetails.quality) {
      throw new Error('Quality metric not found in recording card');
    }

    // Click Preview in Library and wait for media load
    await libraryPage.click('.btn-preview');
    await libraryPage.waitForFunction(() => {
      const panel = document.getElementById('previewPanel');
      const details = document.getElementById('previewDetails')?.textContent || '';
      return panel && !panel.classList.contains('hidden') && !details.includes('Loading');
    }, { timeout: 10000 });

    const previewDetails = await libraryPage.$eval('#previewDetails', (el) => el.textContent);
    console.log(`  Library Preview Details: "${previewDetails}"`);
    if (!previewDetails.includes('Measured:') && !previewDetails.includes('Quality:')) {
      throw new Error(`Preview details missing measured quality: "${previewDetails}"`);
    }
    console.log('✓ Local Library renders preset badge, measured quality, and preview report');

    console.log('\n=============================================================');
    console.log('🎉 OCS-301 QUALITY PRESETS E2E VERIFICATION PASSED!');
    console.log('=============================================================\n');
  } finally {
    await browser.close();
    server.close();
  }
}

async function main() {
  const server = await startServer();
  try {
    await runQualityPresetsTest(server);
    process.exit(0);
  } catch (err) {
    console.error('❌ OCS-301 Test Failed:', err);
    server.close();
    process.exit(1);
  }
}

main();
