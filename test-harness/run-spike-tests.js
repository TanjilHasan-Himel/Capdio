// OpenCapture Studio - OCS-002 Spike Runner
import puppeteer from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { startTestServer } from './server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHROME_PATH = 'C:\\Users\\Himel\\.cache\\puppeteer\\chrome\\win64-152.0.7977.42\\chrome-win64\\chrome.exe';
const EXTENSION_PATH = 'C:\\Users\\Himel\\Desktop\\NEWFOL~2\\test-harness\\extension';

async function runSpike() {
  console.log('=== OpenCapture Studio: OCS-002 Feasibility Spike ===');
  console.log(`Chrome binary: ${CHROME_PATH}`);
  console.log(`Extension path: ${EXTENSION_PATH}`);

  console.log('\n[0/4] Starting local HTTP fixture server on port 3456...');
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
    console.log('\n[1/4] Discovering Extension ID from Service Worker target...');
    let swTarget = null;
    for (let i = 0; i < 30; i++) {
      const targets = browser.targets();
      swTarget = targets.find(t => t.type() === 'service_worker' && t.url().includes('background.js'));
      if (swTarget) break;
      await new Promise(r => setTimeout(r, 200));
    }

    if (!swTarget) {
      throw new Error('Extension Service Worker not found within timeout.');
    }
    const extensionId = new URL(swTarget.url()).hostname;
    console.log(`✓ Extension loaded successfully. Extension ID: ${extensionId}`);

    console.log('\n[2/4] Opening in-extension test harness page...');
    const page = await browser.newPage();
    const harnessUrl = `chrome-extension://${extensionId}/harness.html`;
    await page.goto(harnessUrl, { waitUntil: 'domcontentloaded' });
    console.log(`✓ Test harness loaded: ${harnessUrl}`);

    console.log('\n[3/4] Executing Spike Test Suite inside extension environment...');
    const results = await page.evaluate(async () => {
      return await window.runSpikeSuite();
    });

    console.log('\n[4/4] Evaluating Spike Results:');
    console.log(JSON.stringify(results, null, 2));

    const resultsPath = path.resolve(__dirname, 'spike-results-ocs002.json');
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2), 'utf-8');
    console.log(`\n======================================================`);
    console.log(`Spike suite overallSuccess: ${results.overallSuccess}`);
    console.log(`Results saved to: ${resultsPath}`);
    console.log(`======================================================`);

    if (!results.overallSuccess) {
      throw new Error(`Spike suite failed: ${results.error?.message || 'unknown error'}`);
    }

  } finally {
    if (browser) {
      await browser.close();
    }
    server.close();
  }
}

runSpike().catch(err => {
  console.error('Fatal error during spike execution:', err);
  process.exit(1);
});
