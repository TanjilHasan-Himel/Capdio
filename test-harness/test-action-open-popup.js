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
    '--no-first-run',
    '--autoplay-policy=no-user-gesture-required'
  ]
});

try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:3456/test-page.html');
  await page.bringToFront();
  await new Promise(r => setTimeout(r, 1000));

  let swTarget = null;
  for (let i = 0; i < 20; i++) {
    swTarget = browser.targets().find(t => t.type() === 'service_worker' && t.url().includes('background.js'));
    if (swTarget) break;
    await new Promise(r => setTimeout(r, 200));
  }

  const worker = await swTarget.worker();

  // Instruct Chrome to open the extension popup on the active tab
  console.log('Calling chrome.action.openPopup()...');
  await worker.evaluate(async () => {
    await chrome.action.openPopup();
  });
  console.log('✓ openPopup triggered');

  const popupTarget = await browser.waitForTarget(
    t => t.url().endsWith('popup.html'),
    { timeout: 5000 }
  );
  console.log('✓ Popup target found:', popupTarget.url());
  const popupPage = await popupTarget.asPage();

  // Click Test Capture inside popup
  console.log('Clicking #btnCapture in popup...');
  await popupPage.click('#btnCapture');

  // Wait for output
  let output = '';
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    const status = await popupPage.$eval('#statusBadge', el => el.textContent);
    if (status === 'Capture Completed' || status === 'Capture Failed') {
      output = await popupPage.$eval('#output', el => el.textContent);
      console.log(`Status: ${status}`);
      break;
    }
  }

  console.log('Popup capture output:');
  console.log(output);

} catch (err) {
  console.error('Test error:', err);
} finally {
  await browser.close();
  server.close();
}

