// test-harness/test-codec-fallback.js
// Automated Verification for Codec Detection, Quality Presets & Format Fallback (OCS-105)

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
const PORT = 3460;

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

function verifyMp4Header(buffer) {
  if (buffer.length < 8) return false;
  // MP4 files start with 4-byte box size followed by 'ftyp' (0x66 0x74 0x79 0x70)
  return (
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  );
}

async function runCodecFallbackTest(server) {
  console.log('🚀 Running OCS-105 Codec Feature Detection & Settings Fallback Test...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_DIST}`,
      `--load-extension=${EXTENSION_DIST}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      '--auto-select-desktop-capture-source=Entire screen'
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

    // Open Extension Popup UI
    console.log('2. Opening Popup UI (popup.html)...');
    const popupPage = await browser.newPage();
    popupPage.on('console', msg => console.log('[Popup Console]', msg.type(), msg.text()));

    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });

    // Verify initial popup state
    const initialStatus = await popupPage.$eval('#statusText', el => el.textContent?.trim());
    console.log(`Popup initial status: "${initialStatus}"`);
    if (initialStatus !== 'IDLE') {
      throw new Error(`Expected initial status 'IDLE', got '${initialStatus}'`);
    }

    // =========================================================================
    // TEST 1: Service Worker / Offscreen Host Capability Probing
    // =========================================================================
    console.log('\n--- TEST 1: PROBE_CAPABILITIES Message Bus Endpoint ---');
    const capabilities = await popupPage.evaluate(async () => {
      const chrome = globalThis.chrome;
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            id: 'test_probe_' + Date.now(),
            target: 'background',
            action: 'PROBE_CAPABILITIES',
            timestamp: Date.now()
          },
          (res) => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            resolve(res);
          }
        );
      });
    });

    console.log('Capability Probe Result:', JSON.stringify(capabilities, null, 2));

    if (!capabilities.success || !capabilities.data?.report) {
      throw new Error('PROBE_CAPABILITIES did not return expected report data');
    }

    const report = capabilities.data.report;
    if (!report.canRecordWebM || !report.bestWebM) {
      throw new Error(`Expected WebM recording capability, got bestWebM = ${report.bestWebM}`);
    }

    console.log(`✅ PASS: Best WebM codec: ${report.bestWebM}`);
    console.log(`✅ PASS: Can record MP4: ${report.canRecordMp4} (bestMp4: ${report.bestMp4 || 'none'})`);

    // =========================================================================
    // TEST 2: Balanced 1080p Preset Capture Flow
    // =========================================================================
    console.log('\n--- TEST 2: Balanced Preset Recording & Verification ---');

    // Verify preset dropdown exists and select 'balanced'
    await popupPage.waitForSelector('#qualityPreset');
    await popupPage.select('#qualityPreset', 'balanced');
    await popupPage.select('#captureTarget', 'screen');
    await popupPage.select('#formatPreference', 'webm');

    console.log('Starting recording with preset "balanced" (1080p/30 @ 5 Mbps)...');
    await popupPage.click('#recordButton');

    // Wait for popup to enter RECORDING status
    let recordingStatus = '';
    for (let i = 0; i < 40; i++) {
      recordingStatus = await popupPage.$eval('#statusText', el => el.textContent?.trim());
      if (recordingStatus === 'RECORDING') break;
      await new Promise(r => setTimeout(r, 250));
    }
    if (recordingStatus !== 'RECORDING') {
      throw new Error(`Expected popup status 'RECORDING', got '${recordingStatus}'`);
    }
    console.log('✅ PASS: Recording started in Balanced preset mode');

    // Record for 3 seconds
    await new Promise(r => setTimeout(r, 3000));

    // Stop recording
    console.log('Stopping recording...');
    await popupPage.click('#stopButton');

    // Wait for READY state
    for (let i = 0; i < 40; i++) {
      recordingStatus = await popupPage.$eval('#statusText', el => el.textContent?.trim());
      if (recordingStatus === 'READY') break;
      await new Promise(r => setTimeout(r, 250));
    }
    if (recordingStatus !== 'READY') {
      throw new Error(`Expected popup status 'READY', got '${recordingStatus}'`);
    }

    // Verify download button text reflects WebM
    const downloadBtnText = await popupPage.$eval('#downloadButton', el => el.textContent?.trim());
    console.log(`Download button text: "${downloadBtnText}"`);
    if (!downloadBtnText?.includes('WebM')) {
      throw new Error(`Expected download button to contain 'WebM', got '${downloadBtnText}'`);
    }

    // Extract base64 recording and verify EBML header
    const base64Data = await popupPage.evaluate(() => window.__lastRecordingBase64);
    if (!base64Data || base64Data.length < 500) {
      throw new Error(`Invalid base64 payload size: ${base64Data?.length}`);
    }

    const videoBuffer = Buffer.from(base64Data, 'base64');
    console.log(`Recorded video buffer size: ${videoBuffer.length} bytes`);
    if (!verifyEbmlHeader(videoBuffer)) {
      throw new Error('Recorded WebM missing valid EBML container header');
    }
    console.log('✅ PASS: WebM container header verified (0x1A 0x45 0xDF 0xA3)');

    // Verify session manifest in storage has balanced preset configuration
    const latestSessions = await popupPage.evaluate(async () => {
      const indexData = await chrome.storage.local.get('capdio_sessions_index');
      const sessionIds = indexData?.capdio_sessions_index || [];
      const keys = sessionIds.map(id => `capdio_session_${id}`);
      const sessionsMap = await chrome.storage.local.get(keys);
      return sessionIds.map(id => sessionsMap[`capdio_session_${id}`]).filter(Boolean);
    });

    const manifest = latestSessions[latestSessions.length - 1];
    if (!manifest) {
      throw new Error('No saved session manifest found in storage');
    }
    console.log('Saved Session Profile:', JSON.stringify(manifest.profile, null, 2));

    if (manifest.profile.videoBitrate !== 5_000_000) {
      throw new Error(`Expected videoBitrate 5,000,000, got ${manifest.profile.videoBitrate}`);
    }
    if (manifest.profile.width !== 1920 || manifest.profile.height !== 1080) {
      throw new Error(`Expected 1920x1080 resolution, got ${manifest.profile.width}x${manifest.profile.height}`);
    }
    console.log('✅ PASS: Session manifest profile verified with Balanced preset configuration');

    // =========================================================================
    // TEST 3: Preference Fallback Negotiation
    // =========================================================================
    console.log('\n--- TEST 3: Format Preference & Fallback Flow ---');
    // Reset to idle
    await popupPage.click('#resetButton');
    await new Promise(r => setTimeout(r, 400));

    const resetStatus = await popupPage.$eval('#statusText', el => el.textContent?.trim());
    if (resetStatus !== 'IDLE') {
      throw new Error(`Expected IDLE status after reset, got '${resetStatus}'`);
    }

    // Select MP4 preference
    await popupPage.select('#captureTarget', 'screen');
    await popupPage.select('#formatPreference', 'mp4');

    console.log('Starting recording with format preference "mp4"...');
    await popupPage.click('#recordButton');

    // Wait for RECORDING status
    for (let i = 0; i < 40; i++) {
      recordingStatus = await popupPage.$eval('#statusText', el => el.textContent?.trim());
      if (recordingStatus === 'RECORDING') break;
      await new Promise(r => setTimeout(r, 250));
    }
    if (recordingStatus !== 'RECORDING') {
      throw new Error(`Expected popup status 'RECORDING', got '${recordingStatus}'`);
    }

    // Record for 2 seconds
    await new Promise(r => setTimeout(r, 2000));

    // Stop recording
    await popupPage.click('#stopButton');

    // Wait for READY state
    for (let i = 0; i < 40; i++) {
      recordingStatus = await popupPage.$eval('#statusText', el => el.textContent?.trim());
      if (recordingStatus === 'READY') break;
      await new Promise(r => setTimeout(r, 250));
    }
    if (recordingStatus !== 'READY') {
      throw new Error(`Expected popup status 'READY', got '${recordingStatus}'`);
    }

    const test3Result = await popupPage.evaluate(() => window.__lastResult);
    const negotiatedMime = test3Result.recordingResult?.negotiatedMimeType || test3Result.recordingResult?.mimeType;
    const isFallback = test3Result.recordingResult?.isFallback;
    console.log(`Negotiated format: ${negotiatedMime}, isFallback: ${isFallback}`);

    const base64Data3 = await popupPage.evaluate(() => window.__lastRecordingBase64);
    const videoBuffer3 = Buffer.from(base64Data3, 'base64');
    console.log(`Test 3 recorded buffer size: ${videoBuffer3.length} bytes`);

    if (negotiatedMime.includes('mp4')) {
      if (!verifyMp4Header(videoBuffer3)) {
        throw new Error('Recorded MP4 container missing valid ftyp box header');
      }
      console.log('✅ PASS: Native MP4 container header verified (ftyp)');
    } else {
      // Graceful fallback to WebM
      if (!verifyEbmlHeader(videoBuffer3)) {
        throw new Error('Fallback WebM container missing valid EBML header');
      }
      console.log('✅ PASS: Graceful fallback to WebM container verified (EBML)');
    }

    const readyInfoText = await popupPage.$eval('#readyInfo', el => el.textContent?.trim());
    console.log(`Ready info text: "${readyInfoText}"`);

    console.log('\n======================================================');
    console.log('🎉 ALL OCS-105 CODEC DETECTION & FALLBACK TESTS PASSED!');
    console.log('======================================================');
  } finally {
    await browser.close();
    server.close();
  }
}

async function main() {
  const server = await startServer();
  try {
    await runCodecFallbackTest(server);
    process.exit(0);
  } catch (err) {
    console.error('❌ OCS-105 Test Failed:', err);
    server.close();
    process.exit(1);
  }
}

main();
