// test-harness/test-apps-extension-smoke.js
// Automated Integration Smoke Test for Capdio Production MV3 App Skeleton (OCS-101)

import puppeteer from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHROME_PATH = 'C:\\Users\\Himel\\.cache\\puppeteer\\chrome\\win64-152.0.7977.42\\chrome-win64\\chrome.exe';
const EXTENSION_DIST = path.resolve(__dirname, '..', 'apps', 'extension', 'dist');

console.log('🚀 Running Capdio MV3 App Skeleton Integration Smoke Test (OCS-101)...');

async function runSmokeTest() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_DIST}`,
      `--load-extension=${EXTENSION_DIST}`,
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ],
    defaultViewport: { width: 1280, height: 720 }
  });

  try {
    console.log('1. Waiting for Extension Service Worker registration...');
    let workerTarget = null;
    for (let i = 0; i < 40; i++) {
      const targets = browser.targets();
      workerTarget = targets.find(t => t.type() === 'service_worker' && t.url().includes('chrome-extension://'));
      if (workerTarget) break;
      await new Promise(r => setTimeout(r, 200));
    }

    if (!workerTarget) {
      throw new Error('Capdio Service Worker failed to register within timeout');
    }

    const extensionUrl = workerTarget.url();
    const extensionId = new URL(extensionUrl).hostname;
    console.log(`✅ Service Worker active. Extension ID: ${extensionId}`);

    // 2. Open Extension Popup UI
    console.log('2. Opening Popup UI (popup.html)...');
    const popupPage = await browser.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });

    const brandTitle = await popupPage.$eval('.brand h1', el => el.textContent?.trim());
    const brandTagline = await popupPage.$eval('.brand p', el => el.textContent?.trim());
    const statusText = await popupPage.$eval('#statusText', el => el.textContent?.trim());
    const recordBtnText = await popupPage.$eval('#recordButton', el => el.textContent?.trim());

    console.log(`DOM Verified -> Title: "${brandTitle}", Tagline: "${brandTagline}", Status: "${statusText}", CTA: "${recordBtnText}"`);
    if (brandTitle !== 'Capdio') {
      throw new Error(`Expected brand title 'Capdio', got '${brandTitle}'`);
    }
    if (brandTagline !== 'Capture everything. Miss nothing.') {
      throw new Error(`Expected brand tagline 'Capture everything. Miss nothing.', got '${brandTagline}'`);
    }
    console.log('✅ PASS: Popup UI rendered with accurate Capdio branding and controls.');

    // 3. Test Typed Message Bus: Popup -> Background Service Worker
    console.log('3. Testing Typed Message Bus: Popup -> Service Worker (PING & GET_STATUS)...');
    const pingResponse = await popupPage.evaluate(async () => {
      const { sendTypedMessage } = await import('./popup.js');
      // send message via runtime
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({
          id: 'test_msg_1',
          target: 'background',
          action: 'PING',
          timestamp: Date.now()
        }, resolve);
      });
    });

    console.log('Service Worker PING response:', pingResponse);
    if (!pingResponse || !pingResponse.success || pingResponse.data?.appName !== 'Capdio') {
      throw new Error(`Unexpected PING response: ${JSON.stringify(pingResponse)}`);
    }
    console.log('✅ PASS: Background Service Worker typed PING/PONG verified.');

    const statusResponse = await popupPage.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({
          id: 'test_msg_2',
          target: 'background',
          action: 'GET_STATUS',
          timestamp: Date.now()
        }, resolve);
      });
    });

    console.log('Service Worker GET_STATUS response:', statusResponse);
    if (!statusResponse || !statusResponse.success || statusResponse.data?.status !== 'idle') {
      throw new Error(`Unexpected GET_STATUS response: ${JSON.stringify(statusResponse)}`);
    }
    console.log('✅ PASS: Initial RecordStatus verified as IDLE.');

    // 4. Test Offscreen Document Lifecycle via Service Worker
    console.log('4. Testing Offscreen Document creation and message bus...');
    const ensureOffscreenRes = await popupPage.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({
          id: 'test_msg_3',
          target: 'background',
          action: 'ENSURE_OFFSCREEN',
          timestamp: Date.now()
        }, resolve);
      });
    });
    console.log('ENSURE_OFFSCREEN response:', ensureOffscreenRes);
    if (!ensureOffscreenRes.success || !ensureOffscreenRes.data?.hasDocument) {
      throw new Error(`Failed to ensure offscreen document: ${JSON.stringify(ensureOffscreenRes)}`);
    }

    // Ping Offscreen Document
    const offscreenPingRes = await popupPage.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({
          id: 'test_msg_4',
          target: 'offscreen',
          action: 'PING',
          timestamp: Date.now()
        }, resolve);
      });
    });
    console.log('Offscreen Document PING response:', offscreenPingRes);
    if (!offscreenPingRes.success || !offscreenPingRes.data?.offscreenActive) {
      throw new Error(`Failed to ping offscreen host: ${JSON.stringify(offscreenPingRes)}`);
    }
    console.log('✅ PASS: Offscreen Document successfully instantiated and verified via Typed Message Bus.');

    console.log('\n=============================================================');
    console.log('🎉 OCS-101 MV3 APP SKELETON INTEGRATION SMOKE TEST PASSED!');
    console.log('=============================================================\n');
    return { success: true };
  } finally {
    await browser.close();
  }
}

runSmokeTest().catch((err) => {
  console.error('❌ SMOKE TEST FAILED:', err);
  process.exit(1);
});
