import puppeteer from 'puppeteer-core';
import { startTestServer } from './server.js';

const CHROME_PATH = 'C:\\Users\\Himel\\.cache\\puppeteer\\chrome\\win64-152.0.7977.42\\chrome-win64\\chrome.exe';
const EXTENSION_PATH = 'C:\\Users\\Himel\\Desktop\\NEWFOL~2\\test-harness\\extension';

const server = await startTestServer(3456);

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: false,
  args: [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    '--no-first-run'
  ]
});

const page = await browser.newPage();
await page.goto('http://127.0.0.1:3456/test-page.html');
await new Promise(r => setTimeout(r, 1000));

let swTarget = null;
for (let i = 0; i < 20; i++) {
  swTarget = browser.targets().find(t => t.type() === 'service_worker' && t.url().includes('background.js'));
  if (swTarget) break;
  await new Promise(r => setTimeout(r, 200));
}

const worker = await swTarget.worker();
const tabs = await worker.evaluate(async () => {
  return await chrome.tabs.query({});
});
console.log('Tabs visible to worker:', tabs.map(t => ({ id: t.id, url: t.url, active: t.active })));

const targetTab = tabs.find(t => t.url && t.url.includes('test-page'));
const streamResult = await worker.evaluate(async (tabId) => {
  return new Promise((resolve) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      resolve({ streamId, lastError: chrome.runtime.lastError?.message });
    });
  });
}, targetTab.id);

console.log('streamResult from worker:', streamResult);

await browser.close();
server.close();

