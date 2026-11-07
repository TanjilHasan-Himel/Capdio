// OpenCapture Studio - OCS-002 Popup Capture Flow Test
import puppeteer from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { startTestServer } from './server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHROME_PATH = 'C:\\Users\\Himel\\.cache\\puppeteer\\chrome\\win64-152.0.7977.42\\chrome-win64\\chrome.exe';
const EXTENSION_PATH = 'C:\\Users\\Himel\\Desktop\\NEWFOL~2\\test-harness\\extension';

async function testPopupFlow() {
  console.log('=== OpenCapture Studio: OCS-002 Popup Capture Flow ===');

  const server = await startTestServer(3456);
  console.log('✓ Fixture server running at http://127.0.0.1:3456');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--autoplay-policy=no-user-gesture-required',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,800'
    ]
  });

  try {
    // 1. Find Extension ID
    let swTarget = null;
    for (let i = 0; i < 30; i++) {
      const targets = browser.targets();
      swTarget = targets.find(t => t.type() === 'service_worker' && t.url().includes('background.js'));
      if (swTarget) break;
      await new Promise(r => setTimeout(r, 200));
    }
    if (!swTarget) throw new Error('Service Worker not found.');
    const extensionId = new URL(swTarget.url()).hostname;
    console.log(`✓ Extension ID: ${extensionId}`);

    // 2. Open fixture target page in first tab
    const [page1] = await browser.pages();
    await page1.goto('http://127.0.0.1:3456/test-page.html?autoplayAudio=1', { waitUntil: 'load' });
    await page1.bringToFront();
    console.log('✓ Target fixture page loaded in active tab.');
    await new Promise(r => setTimeout(r, 1000));

    // 3. Open Popup
    const popupPage = await browser.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
    console.log('✓ Extension popup opened.');

    // 4. Click Probe Capabilities
    console.log('Testing Capabilities Probe...');
    await popupPage.click('#btnProbe');
    await new Promise(r => setTimeout(r, 1000));
    const probeText = await popupPage.$eval('#output', el => el.textContent);
    console.log('Capabilities probe output:\n', probeText);

    // 5. Switch back to target page to ensure it is active tab in window
    await page1.bringToFront();
    await new Promise(r => setTimeout(r, 500));

    // In popup: click Test Capture
    console.log('Triggering Test Capture (3s) from popup...');
    await popupPage.bringToFront();
    await popupPage.click('#btnCapture');

    // Wait for capture to finish (status badge changes to 'Capture Completed' or 'Capture Failed')
    console.log('Waiting for capture to complete...');
    let outputText = '';
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 500));
      const status = await popupPage.$eval('#statusBadge', el => el.textContent);
      if (status === 'Capture Completed' || status === 'Capture Failed') {
        outputText = await popupPage.$eval('#output', el => el.textContent);
        console.log(`Status changed to: ${status}`);
        break;
      }
    }

    console.log('Final Capture Output:');
    console.log(outputText);

    const parsedOutput = JSON.parse(outputText);
    const results = {
      timestamp: new Date().toISOString(),
      chromeVersion: await browser.version(),
      platform: process.platform,
      captureOutput: parsedOutput
    };

    fs.writeFileSync(
      path.resolve(__dirname, 'spike-results-ocs002.json'),
      JSON.stringify(results, null, 2),
      'utf-8'
    );

    if (parsedOutput.error) {
      throw new Error(`Capture failed: ${parsedOutput.error}`);
    }

    console.log('✓ OCS-002 Popup flow succeeded with real media recording!');

  } finally {
    await browser.close();
    server.close();
  }
}

testPopupFlow().catch(err => {
  console.error('Fatal error in testPopupFlow:', err);
  process.exit(1);
});

