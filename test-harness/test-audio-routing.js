// test-harness/test-audio-routing.js
// Automated Verification for Tab Audio Playback-Monitor Routing & Optional Microphone (OCS-106)

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
const PORT = 3461;

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

async function runAudioRoutingTest(server) {
  console.log('🚀 Running OCS-106 Tab Audio Playback-Monitor & Microphone Routing Test...');
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
    worker.on('console', msg => console.log('[SW Console]', msg.text()));

    // 2. Open Target Web Page to be captured
    console.log('2. Opening target tab with synthetic audio tone...');
    const targetPage = await browser.newPage();
    await targetPage.goto(`http://127.0.0.1:${PORT}/test-page.html?autoplayAudio=1`, { waitUntil: 'load' });
    await targetPage.bringToFront();
    await new Promise(r => setTimeout(r, 1000));

    // 3. Invoke user action via CDP to grant activeTab permission on targetPage
    console.log('3. Triggering Extensions.triggerAction to invoke activeTab...');
    const browserClient = await browser.target().createCDPSession();
    await browserClient.send('Extensions.triggerAction', {
      id: extensionId,
      targetId: targetPage._tabId
    });

    // 4. Open Extension Popup UI
    console.log('4. Opening Popup UI (popup.html)...');
    const popupPage = await browser.newPage();
    popupPage.on('console', msg => console.log('[Popup Console]', msg.type(), msg.text()));

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

    // =========================================================================
    // TEST 1: Tab Audio Playback-Monitor Routing & Volume Control
    // =========================================================================
    console.log('\n--- TEST 1: Tab Audio Playback-Monitor Route & Dynamic Gain ---');
    // Ensure tabAudio is checked and mic is unchecked
    await popupPage.evaluate(() => {
      const tabAudio = document.getElementById('tabAudioToggle');
      const mic = document.getElementById('micToggle');
      if (tabAudio) tabAudio.checked = true;
      if (mic) mic.checked = false;
    });

    console.log('Starting tab recording with Tab Audio Monitor enabled...');
    await popupPage.click('#recordButton');

    // Wait for RECORDING status
    let recordingStatus = '';
    for (let i = 0; i < 40; i++) {
      recordingStatus = await popupPage.$eval('#statusText', el => el.textContent?.trim());
      if (recordingStatus === 'RECORDING') break;
      await new Promise(r => setTimeout(r, 250));
    }
    if (recordingStatus !== 'RECORDING') {
      throw new Error(`Expected RECORDING status, got '${recordingStatus}'`);
    }
    console.log('✅ PASS: Tab recording active');

    // Query Audio Status from Offscreen Host via Service Worker
    const audioStatus1 = await popupPage.evaluate(async () => {
      const chrome = globalThis.chrome;
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            id: 'test_audio_stat_1',
            target: 'background',
            action: 'GET_AUDIO_STATUS',
            timestamp: Date.now()
          },
          resolve
        );
      });
    });

    console.log('Audio Status (Test 1):', audioStatus1);
    if (!audioStatus1.success || !audioStatus1.data?.hasAudioContext || !audioStatus1.data?.monitorActive) {
      throw new Error(`Expected hasAudioContext=true and monitorActive=true, got: ${JSON.stringify(audioStatus1)}`);
    }
    console.log('✅ PASS: Web Audio context active and tab audio monitor routing to speakers');

    // Test dynamic volume / mute control on monitor
    console.log('Testing dynamic monitor mute via SET_AUDIO_MONITOR...');
    const muteRes = await popupPage.evaluate(async () => {
      const chrome = globalThis.chrome;
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            id: 'test_mute_monitor',
            target: 'background',
            action: 'SET_AUDIO_MONITOR',
            timestamp: Date.now(),
            payload: { enabled: false }
          },
          resolve
        );
      });
    });
    console.log('Monitor Mute Result:', muteRes);
    if (!muteRes.success || muteRes.data?.monitorEnabled !== false) {
      throw new Error(`Expected monitorEnabled=false, got: ${JSON.stringify(muteRes)}`);
    }
    console.log('✅ PASS: Tab audio monitor gain node dynamically muted');

    // Unmute monitor
    console.log('Testing dynamic monitor unmute...');
    const unmuteRes = await popupPage.evaluate(async () => {
      const chrome = globalThis.chrome;
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            id: 'test_unmute_monitor',
            target: 'background',
            action: 'SET_AUDIO_MONITOR',
            timestamp: Date.now(),
            payload: { enabled: true, volume: 0.8 }
          },
          resolve
        );
      });
    });
    if (!unmuteRes.success || unmuteRes.data?.monitorEnabled !== true || Math.abs((unmuteRes.data?.volume ?? 0) - 0.8) > 0.01) {
      throw new Error(`Expected monitorEnabled=true & volume=0.8, got: ${JSON.stringify(unmuteRes)}`);
    }
    console.log('✅ PASS: Tab audio monitor gain dynamically restored to 0.8');

    // Record for 2.5 seconds and stop
    await new Promise(r => setTimeout(r, 2500));
    await popupPage.click('#stopButton');

    for (let i = 0; i < 40; i++) {
      recordingStatus = await popupPage.$eval('#statusText', el => el.textContent?.trim());
      if (recordingStatus === 'READY') break;
      await new Promise(r => setTimeout(r, 250));
    }
    if (recordingStatus !== 'READY') {
      throw new Error(`Expected READY status, got '${recordingStatus}'`);
    }

    const base64Data1 = await popupPage.evaluate(() => window.__lastRecordingBase64);
    const videoBuffer1 = Buffer.from(base64Data1, 'base64');
    console.log(`Test 1 WebM buffer size: ${videoBuffer1.length} bytes`);
    if (!verifyEbmlHeader(videoBuffer1)) {
      throw new Error('Test 1 WebM missing valid EBML header');
    }
    console.log('✅ PASS: Tab audio recording finalized with valid EBML header');

    // Verify audio metadata recorded in manifest
    const latestSessions1 = await popupPage.evaluate(async () => {
      const indexData = await chrome.storage.local.get('capdio_sessions_index');
      const sessionIds = indexData?.capdio_sessions_index || [];
      const keys = sessionIds.map(id => `capdio_session_${id}`);
      const sessionsMap = await chrome.storage.local.get(keys);
      return sessionIds.map(id => sessionsMap[`capdio_session_${id}`]).filter(Boolean);
    });

    const manifest1 = latestSessions1[latestSessions1.length - 1];
    const sourceAudioMeta1 = manifest1.sources[0]?.audioMetadata;
    console.log('Source Audio Metadata (Test 1):', sourceAudioMeta1);
    if (!sourceAudioMeta1 || sourceAudioMeta1.hasTabAudio !== true || sourceAudioMeta1.hasMicrophone !== false) {
      throw new Error(`Invalid audio metadata in manifest: ${JSON.stringify(sourceAudioMeta1)}`);
    }
    console.log('✅ PASS: Manifest accurately documents hasTabAudio=true and hasMicrophone=false');

    // =========================================================================
    // TEST 2: Dual Source Mixing (Tab Audio + Microphone) & Teardown
    // =========================================================================
    console.log('\n--- TEST 2: Tab Audio + Microphone Simultaneous Mixing ---');
    await popupPage.click('#resetButton');
    await new Promise(r => setTimeout(r, 400));

    // Enable both tabAudio and microphone
    await popupPage.evaluate(() => {
      const tabAudio = document.getElementById('tabAudioToggle');
      const mic = document.getElementById('micToggle');
      if (tabAudio) tabAudio.checked = true;
      if (mic) mic.checked = true;
    });

    console.log('Starting recording with both Tab Audio and Microphone enabled...');
    await popupPage.click('#recordButton');

    for (let i = 0; i < 40; i++) {
      recordingStatus = await popupPage.$eval('#statusText', el => el.textContent?.trim());
      if (recordingStatus === 'RECORDING') break;
      await new Promise(r => setTimeout(r, 250));
    }
    if (recordingStatus !== 'RECORDING') {
      throw new Error(`Expected RECORDING status, got '${recordingStatus}'`);
    }
    console.log('✅ PASS: Dual-source recording started');

    const audioStatus2 = await popupPage.evaluate(async () => {
      const chrome = globalThis.chrome;
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            id: 'test_audio_stat_2',
            target: 'background',
            action: 'GET_AUDIO_STATUS',
            timestamp: Date.now()
          },
          resolve
        );
      });
    });

    console.log('Audio Status (Test 2):', audioStatus2);
    if (!audioStatus2.success || !audioStatus2.data?.hasMicStream) {
      throw new Error(`Expected hasMicStream=true, got: ${JSON.stringify(audioStatus2)}`);
    }
    console.log('✅ PASS: Microphone stream acquired and mixed with tab audio');

    // Test mic mute control
    console.log('Testing microphone mute via SET_MIC_MUTE...');
    const micMuteRes = await popupPage.evaluate(async () => {
      const chrome = globalThis.chrome;
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            id: 'test_mute_mic',
            target: 'background',
            action: 'SET_MIC_MUTE',
            timestamp: Date.now(),
            payload: { muted: true }
          },
          resolve
        );
      });
    });
    if (!micMuteRes.success || micMuteRes.data?.micMuted !== true) {
      throw new Error(`Expected micMuted=true, got: ${JSON.stringify(micMuteRes)}`);
    }
    console.log('✅ PASS: Microphone record gain node muted');

    // Record for 2.5 seconds and stop
    await new Promise(r => setTimeout(r, 2500));
    await popupPage.click('#stopButton');

    for (let i = 0; i < 40; i++) {
      recordingStatus = await popupPage.$eval('#statusText', el => el.textContent?.trim());
      if (recordingStatus === 'READY') break;
      await new Promise(r => setTimeout(r, 250));
    }
    if (recordingStatus !== 'READY') {
      throw new Error(`Expected READY status, got '${recordingStatus}'`);
    }

    // Verify audio resources teardown
    const teardownStatus = await popupPage.evaluate(async () => {
      const chrome = globalThis.chrome;
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            id: 'test_teardown_check',
            target: 'background',
            action: 'GET_AUDIO_STATUS',
            timestamp: Date.now()
          },
          resolve
        );
      });
    });

    console.log('Teardown Status:', teardownStatus);
    if (teardownStatus.data?.hasAudioContext !== false || teardownStatus.data?.hasMicStream !== false) {
      throw new Error(`Expected all audio resources cleaned up, got: ${JSON.stringify(teardownStatus)}`);
    }
    console.log('✅ PASS: All microphone tracks stopped and AudioContext cleanly closed (no orphaned handles)');

    // Verify manifest metadata has hasMicrophone=true
    const latestSessions2 = await popupPage.evaluate(async () => {
      const indexData = await chrome.storage.local.get('capdio_sessions_index');
      const sessionIds = indexData?.capdio_sessions_index || [];
      const keys = sessionIds.map(id => `capdio_session_${id}`);
      const sessionsMap = await chrome.storage.local.get(keys);
      return sessionIds.map(id => sessionsMap[`capdio_session_${id}`]).filter(Boolean);
    });

    const manifest2 = latestSessions2[latestSessions2.length - 1];
    const sourceAudioMeta2 = manifest2.sources[0]?.audioMetadata;
    console.log('Source Audio Metadata (Test 2):', sourceAudioMeta2);
    if (!sourceAudioMeta2 || sourceAudioMeta2.hasMicrophone !== true) {
      throw new Error(`Expected hasMicrophone=true in manifest, got: ${JSON.stringify(sourceAudioMeta2)}`);
    }
    console.log('✅ PASS: Session manifest metadata accurately documents dual audio capture');

    console.log('\n======================================================');
    console.log('🎉 ALL OCS-106 AUDIO ROUTING & MONITOR TESTS PASSED!');
    console.log('======================================================');
  } finally {
    await browser.close();
    server.close();
  }
}

async function main() {
  const server = await startServer();
  try {
    await runAudioRoutingTest(server);
    process.exit(0);
  } catch (err) {
    console.error('❌ OCS-106 Audio Routing Test Failed:', err);
    server.close();
    process.exit(1);
  }
}

main();
