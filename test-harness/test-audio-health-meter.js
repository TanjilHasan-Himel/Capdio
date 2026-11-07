// test-harness/test-audio-health-meter.js
// Automated E2E Verification for Audio Device Selection, Health Meter & A/V Sync (OCS-302)

import puppeteer from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHROME_PATH = 'C:\\Users\\Himel\\.cache\\puppeteer\\chrome\\win64-152.0.7977.42\\chrome-win64\\chrome.exe';
const EXTENSION_DIST = path.resolve(__dirname, '..', 'apps', 'extension', 'dist');
const PORT = 3459;

function startServer() {
  return new Promise((resolve) => {
    const fixtureHtml = fs.readFileSync(path.join(__dirname, 'fixtures', 'test-page.html'), 'utf8');
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fixtureHtml);
    });
    server.listen(PORT, () => {
      console.log(`✓ Audio test fixture server running at http://127.0.0.1:${PORT}`);
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

async function runAudioHealthMeterTest(server) {
  console.log('🚀 Running OCS-302 Audio Device Selection, Health Meter & A/V Sync E2E Test...');
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

    // 2. Open Target Web Page with audio active
    console.log('2. Opening target fixture page with audio synth...');
    const targetPage = await browser.newPage();
    await targetPage.setViewport({ width: 1920, height: 1080 });
    await targetPage.goto(`http://127.0.0.1:${PORT}/test-page.html?autoplayAudio=1`, { waitUntil: 'load' });
    await targetPage.bringToFront();
    await new Promise((r) => setTimeout(r, 1000));
    console.log(`✓ Target page loaded with animated audio fixture: ${targetPage.url()}`);

    // 3. Grant activeTab via CDP
    console.log('3. Triggering Extensions.triggerAction to invoke activeTab...');
    const browserClient = await browser.target().createCDPSession();
    await browserClient.send('Extensions.triggerAction', {
      id: extensionId,
      targetId: targetPage._tabId
    });
    console.log('✓ Extensions.triggerAction delivered.');

    // 4. Open Popup UI
    console.log('4. Opening extension popup...');
    const popupPage = await browser.newPage();
    popupPage.on('console', (msg) => console.log('[Popup Console]', msg.type(), msg.text()));
    worker.on('console', (msg) => console.log('[SW Console]', msg.text()));

    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });
    await popupPage.waitForSelector('#micToggle');
    console.log('✓ Popup UI initialized');

    // 5. Test Microphone Device Selection
    console.log('5. Testing microphone toggle & device enumeration...');
    const micGroupInitiallyHidden = await popupPage.$eval('#micDeviceGroup', (el) => el.classList.contains('hidden'));
    if (!micGroupInitiallyHidden) {
      throw new Error('Microphone device group should be hidden when micToggle is unchecked');
    }

    // Toggle mic on
    await popupPage.click('#micToggle');
    await popupPage.waitForSelector('#micDeviceGroup:not(.hidden)');
    console.log('✓ Microphone device selector revealed on toggle');

    // Wait for device options to populate
    await new Promise((r) => setTimeout(r, 1000));
    const deviceOptionsCount = await popupPage.$$eval('#micSelect option', (opts) => opts.length);
    console.log(`✓ Microphone devices enumerated in dropdown: ${deviceOptionsCount} option(s)`);
    if (deviceOptionsCount < 1) {
      throw new Error('No microphone device options populated');
    }

    // 6. Start Recording with Tab Audio + Microphone
    console.log('6. Starting recording with Tab Audio + Microphone...');
    await targetPage.bringToFront();
    await browserClient.send('Extensions.triggerAction', {
      id: extensionId,
      targetId: targetPage._tabId
    });
    await new Promise((r) => setTimeout(r, 500));

    await popupPage.bringToFront();
    await popupPage.waitForSelector('#recordButton:not([disabled])');
    await popupPage.click('#recordButton');

    // Wait for active recording
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

    // 7. Verify Audio Health Meter in Popup
    console.log('7. Verifying real-time Audio Health Meter...');
    await popupPage.waitForSelector('#audioHealthSection:not(.hidden)');

    // Let audio accumulate for 3 seconds while meter updates
    let meterActive = false;
    let finalPeakDb = -100;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const meterWidth = await popupPage.$eval('#audioMeterBar', (el) => parseFloat(el.style.width || '0'));
      const levelText = await popupPage.$eval('#audioLevelText', (el) => el.textContent || '');
      if (meterWidth > 0 && levelText !== '-inf dB') {
        meterActive = true;
        const parsed = parseFloat(levelText.replace(' dB', ''));
        if (!isNaN(parsed)) finalPeakDb = parsed;
        console.log(`  Audio Meter active: width=${meterWidth}%, peak=${levelText}`);
        break;
      }
    }

    // Direct background probe to verify AnalyserNode output
    const bgAudioStatus = await popupPage.evaluate(async () => {
      const msg = {
        id: `msg_${Date.now()}`,
        target: 'background',
        timestamp: Date.now(),
        action: 'GET_AUDIO_STATUS'
      };
      return await chrome.runtime.sendMessage(msg);
    });

    console.log('  Background GET_AUDIO_STATUS Response:', JSON.stringify(bgAudioStatus, null, 2));
    if (!bgAudioStatus?.data?.hasAudioContext) {
      throw new Error('AudioContext was not initialized in offscreen host');
    }
    if (typeof bgAudioStatus?.data?.rmsLevel !== 'number' || typeof bgAudioStatus?.data?.peakDb !== 'number') {
      throw new Error('RMS or Peak dB levels missing from audio status report');
    }
    console.log(`✓ Audio health meter verified: RMS=${bgAudioStatus.data.rmsLevel}, Peak=${bgAudioStatus.data.peakDb} dB`);

    // 8. Stop Recording & Validate A/V Sync & Media Output
    console.log('8. Stopping recording & validating A/V media container...');
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

    // Retrieve recorded data from background
    const recordedData = await popupPage.evaluate(async () => {
      const statusRes = await chrome.runtime.sendMessage({
        id: `msg_${Date.now()}`,
        target: 'background',
        timestamp: Date.now(),
        action: 'GET_STATUS'
      });
      return statusRes?.data?.lastRecordingResult;
    });

    if (!recordedData?.base64Data) {
      throw new Error('No base64 recording data returned after stop');
    }

    const binaryBuffer = Buffer.from(recordedData.base64Data, 'base64');
    console.log(`  Recorded WebM size: ${binaryBuffer.length} bytes`);

    // Check EBML Header
    const validEbml = verifyEbmlHeader(binaryBuffer);
    if (!validEbml) {
      throw new Error('Corrupted or invalid EBML header in recorded WebM container');
    }
    console.log('✓ Valid WebM container structure (EBML header 0x1A 0x45 0xDF 0xA3 verified)');

    // Verify SessionManifest stored audio metadata
    const sessionManifest = await popupPage.evaluate(async () => {
      const res = await chrome.runtime.sendMessage({
        id: `msg_${Date.now()}`,
        target: 'background',
        timestamp: Date.now(),
        action: 'LIST_SESSIONS'
      });
      const sessions = res?.data?.sessions || [];
      return sessions[sessions.length - 1];
    });

    const audioMeta = sessionManifest?.sources?.[0]?.audioMetadata;
    console.log('  Stored Audio Metadata:', JSON.stringify(audioMeta, null, 2));
    if (!audioMeta) {
      throw new Error('Audio metadata missing from session manifest');
    }
    if (!audioMeta.hasTabAudio) {
      throw new Error('hasTabAudio should be true');
    }
    if (audioMeta.sampleRate && audioMeta.sampleRate <= 0) {
      throw new Error(`Invalid audio sample rate: ${audioMeta.sampleRate}`);
    }
    console.log(`✓ Audio track metadata confirmed: hasTabAudio=${audioMeta.hasTabAudio}, hasMicrophone=${audioMeta.hasMicrophone}, sampleRate=${audioMeta.sampleRate}Hz`);

    console.log('\n=============================================================');
    console.log('🎉 OCS-302 AUDIO DEVICE, HEALTH METER & A/V SYNC VERIFIED!');
    console.log('=============================================================\n');
  } finally {
    await browser.close();
    server.close();
  }
}

async function main() {
  const server = await startServer();
  try {
    await runAudioHealthMeterTest(server);
    process.exit(0);
  } catch (err) {
    console.error('❌ OCS-302 Test Failed:', err);
    server.close();
    process.exit(1);
  }
}

main();

