import puppeteer from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extPath = 'C:\\Users\\Himel\\Desktop\\NEWFOL~2\\test-harness\\extension';
console.log('Testing extension loading from:', extPath);

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: false,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
    '--no-first-run'
  ]
});

// Wait up to 5 seconds
await new Promise(r => setTimeout(r, 3000));
const targets = browser.targets();
console.log('All Targets:', targets.map(t => ({ type: t.type(), url: t.url() })));

const page = await browser.newPage();
await page.goto('chrome://extensions');
await new Promise(r => setTimeout(r, 2000));
const extData = await page.evaluate(() => {
  const manager = document.querySelector('extensions-manager');
  const itemList = manager?.shadowRoot?.querySelector('extensions-item-list');
  const items = itemList?.shadowRoot?.querySelectorAll('extensions-item') || [];
  return Array.from(items).map(item => {
    const name = item.shadowRoot?.querySelector('#name')?.textContent?.trim();
    const id = item.id;
    const inspectViews = Array.from(item.shadowRoot?.querySelectorAll('.inspectable-view') || []).map(v => v.textContent?.trim());
    return { name, id, inspectViews };
  });
});
console.log('Extensions found on chrome://extensions:', extData);

await browser.close();
