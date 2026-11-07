import puppeteer from 'puppeteer-core';

const CHROME_PATH = 'C:\\Users\\Himel\\.cache\\puppeteer\\chrome\\win64-152.0.7977.42\\chrome-win64\\chrome.exe';
const EXTENSION_PATH = 'C:\\Users\\Himel\\Desktop\\NEWFOL~2\\test-harness\\extension';

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: false,
  args: [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    '--no-first-run',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream'
  ]
});

try {
  const swTarget = await browser.waitForTarget(t => t.type() === 'service_worker');
  const worker = await swTarget.worker();

  // Create offscreen document
  await worker.evaluate(async () => {
    if (!await chrome.offscreen.hasDocument()) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['USER_MEDIA'],
        justification: 'Testing mic capture'
      });
    }
  });

  // Query offscreen target
  const offscreenTarget = await browser.waitForTarget(t => t.url().includes('offscreen.html'));
  const offscreenPage = await offscreenTarget.asPage();

  const micTest = await offscreenPage.evaluate(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tracks = stream.getAudioTracks().map(t => ({ id: t.id, label: t.label, readyState: t.readyState }));
      stream.getTracks().forEach(t => t.stop());
      return { success: true, tracks, devices: devices.map(d => ({ kind: d.kind, label: d.label })) };
    } catch (err) {
      return { success: false, error: err.message, name: err.name };
    }
  });

  console.log('Offscreen mic test result:', micTest);

} finally {
  await browser.close();
}

