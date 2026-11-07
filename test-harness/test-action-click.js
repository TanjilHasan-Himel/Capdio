import puppeteer from 'puppeteer-core';
import { startTestServer } from './server.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    '--autoplay-policy=no-user-gesture-required',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling'
  ]
});

try {
  browser.on('targetcreated', async (target) => {
    if (target.url().includes('offscreen')) {
      try {
        const offscreenPage = await target.asPage();
        if (offscreenPage) {
          offscreenPage.on('console', msg => console.log('[Offscreen Console]', msg.text()));
        }
      } catch (e) {}
    }
  });

  const swTarget = await browser.waitForTarget(
    t => t.type() === 'service_worker',
    { timeout: 10000 }
  );
  const worker = await swTarget.worker();
  worker.on('console', msg => console.log('[Worker Console]', msg.text()));

  const extensionId = new URL(swTarget.url()).hostname;
  console.log('✓ Found Extension ID:', extensionId);

  // Grant microphone permission to extension origin
  const extensionOrigin = `chrome-extension://${extensionId}`;
  await browser.defaultBrowserContext().overridePermissions(extensionOrigin, ['microphone']);
  console.log('✓ Microphone permission granted to', extensionOrigin);

  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:3456/test-page.html?autoplayAudio=1', { waitUntil: 'load' });
  await page.bringToFront();
  await new Promise(r => setTimeout(r, 1000));
  console.log('✓ Target page loaded.');

  // Create browser CDP session to send Extensions.triggerAction
  const browserClient = await browser.target().createCDPSession();
  const tabTargetId = page._tabId;
  console.log(`Sending Extensions.triggerAction with id=${extensionId}, targetId=${tabTargetId}...`);

  await browserClient.send('Extensions.triggerAction', {
    id: extensionId,
    targetId: tabTargetId
  });
  console.log('✓ Extensions.triggerAction sent! Waiting for capture result...');

  // Poll for result
  let actionResult = null;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500));
    actionResult = await worker.evaluate(() => globalThis.__lastResult);
    if (actionResult) break;
  }

  console.log('\n=== ACTION CAPTURE RESULT ===');
  console.log(JSON.stringify({
    ...actionResult,
    captureResult: {
      ...actionResult?.captureResult,
      recordResult: {
        blobSize: actionResult?.captureResult?.recordResult?.blobSize,
        blobType: actionResult?.captureResult?.recordResult?.blobType,
        chunksCount: actionResult?.captureResult?.recordResult?.chunksCount,
        hasBase64: !!actionResult?.captureResult?.recordResult?.base64Data
      }
    }
  }, null, 2));

  // Verify and write recording file
  if (actionResult?.captureResult?.recordResult?.base64Data) {
    const recordingsDir = path.resolve(__dirname, '..', 'recordings');
    if (!fs.existsSync(recordingsDir)) {
      fs.mkdirSync(recordingsDir, { recursive: true });
    }
    const webmBuffer = Buffer.from(actionResult.captureResult.recordResult.base64Data, 'base64');
    const outFilePath = path.join(recordingsDir, 'test-spike-1080p.webm');
    fs.writeFileSync(outFilePath, webmBuffer);

    const isEbml = webmBuffer[0] === 0x1A && webmBuffer[1] === 0x45 && webmBuffer[2] === 0xDF && webmBuffer[3] === 0xA3;
    console.log(`\n✓ Recording file saved: ${outFilePath} (${webmBuffer.length} bytes)`);
    console.log(`✓ EBML Magic Header verified: ${isEbml ? 'VALID (0x1A 0x45 0xDF 0xA3)' : 'INVALID'}`);

    // Save summary results
    const results = {
      ticket: 'OCS-002',
      status: 'VERIFIED',
      timestamp: new Date().toISOString(),
      chromeVersion: await browser.version(),
      platform: process.platform,
      fileSize: webmBuffer.length,
      isEbmlValid: isEbml,
      settings: actionResult.captureResult.videoTrack?.settings,
      tabAudioSettings: actionResult.captureResult.tabAudioTrack?.settings,
      micAudioSettings: actionResult.captureResult.micAudioTrack?.settings,
      monitorStatus: actionResult.captureResult.monitorStatus,
      chunksCount: actionResult.captureResult.recordResult.chunksCount,
      debugLogs: actionResult.captureResult.debugLogs
    };

    fs.writeFileSync(
      path.resolve(__dirname, 'spike-results-ocs002.json'),
      JSON.stringify(results, null, 2),
      'utf-8'
    );
  }

} catch (err) {
  console.error('Error during action click test:', err);
} finally {
  await browser.close();
  server.close();
}
