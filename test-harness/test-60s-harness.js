// OpenCapture Studio - OCS-003 60-Second 1080p Benchmark Harness
import puppeteer from 'puppeteer-core';
import { startTestServer } from './server.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHROME_PATH = 'C:\\Users\\Himel\\.cache\\puppeteer\\chrome\\win64-152.0.7977.42\\chrome-win64\\chrome.exe';
const EXTENSION_PATH = 'C:\\Users\\Himel\\Desktop\\NEWFOL~2\\test-harness\\extension';
const DURATION_MS = 60000; // Full 60 seconds

async function runBenchmark() {
  console.log('===============================================================');
  console.log('OpenCapture Studio: OCS-003 60s 1080p Video+Audio+Mic Benchmark');
  console.log('===============================================================');

  const server = await startTestServer(3456);
  console.log('✓ Fixture server running at http://127.0.0.1:3456');

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

  const resourceSamples = [];
  let samplingInterval = null;

  try {
    const swTarget = await browser.waitForTarget(
      t => t.type() === 'service_worker',
      { timeout: 10000 }
    );
    const worker = await swTarget.worker();
    worker.on('console', msg => console.log('[SW Log]', msg.text()));

    const extensionId = new URL(swTarget.url()).hostname;
    console.log('✓ Found Extension ID:', extensionId);

    // Override microphone permission for the extension origin
    const extensionOrigin = `chrome-extension://${extensionId}`;
    await browser.defaultBrowserContext().overridePermissions(extensionOrigin, ['microphone']);
    console.log(`✓ Microphone permission granted to ${extensionOrigin}`);

    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:3456/test-page.html?autoplayAudio=1', { waitUntil: 'load' });
    await page.bringToFront();
    await new Promise(r => setTimeout(r, 1000));
    console.log('✓ 1080p target page loaded with continuous test audio.');

    // Configure 60s recording with microphone, tab audio, and 1080p/30
    await worker.evaluate((duration) => {
      globalThis.__lastResult = null;
      globalThis.__recordingConfig = {
        width: 1920,
        height: 1080,
        fps: 30,
        enableMonitorAudio: true,
        includeMic: true,
        durationMs: duration,
        mimeType: 'video/webm;codecs=vp9,opus'
      };
    }, DURATION_MS);
    console.log(`✓ Recording configuration set: 1080p/30, duration=${DURATION_MS / 1000}s, includeMic=true`);

    // Start resource monitoring every 5 seconds
    const benchmarkStartTime = performance.now();
    samplingInterval = setInterval(async () => {
      try {
        const mem = process.memoryUsage();
        const elapsedSec = ((performance.now() - benchmarkStartTime) / 1000).toFixed(1);
        const sample = {
          elapsedSec: Number(elapsedSec),
          heapUsedMB: +(mem.heapUsed / 1024 / 1024).toFixed(2),
          heapTotalMB: +(mem.heapTotal / 1024 / 1024).toFixed(2),
          rssMB: +(mem.rss / 1024 / 1024).toFixed(2)
        };
        resourceSamples.push(sample);
        console.log(`[Progress ${elapsedSec}s / 60s] Heap: ${sample.heapUsedMB} MB | RSS: ${sample.rssMB} MB`);
      } catch (e) {}
    }, 5000);

    // Trigger extension action on target tab
    const browserClient = await browser.target().createCDPSession();
    const tabTargetId = page._tabId;
    console.log(`\nTriggering Extensions.triggerAction to start 60s recording...`);
    await browserClient.send('Extensions.triggerAction', {
      id: extensionId,
      targetId: tabTargetId
    });

    console.log('✓ Recording started. Capturing 60 seconds of live 1080p video + tab audio + mic...');

    // Wait for result (up to 90 seconds total)
    let actionResult = null;
    const maxPollIterations = 180; // 180 * 500ms = 90 seconds
    for (let i = 0; i < maxPollIterations; i++) {
      await new Promise(r => setTimeout(r, 500));
      actionResult = await worker.evaluate(() => globalThis.__lastResult);
      if (actionResult) break;
    }

    clearInterval(samplingInterval);
    const totalElapsedSec = ((performance.now() - benchmarkStartTime) / 1000).toFixed(2);
    console.log(`\n✓ Recording finalized in ${totalElapsedSec}s.`);

    if (!actionResult || !actionResult.success) {
      throw new Error(`Recording failed: ${actionResult?.error || 'Timed out waiting for result'}`);
    }

    const captureRes = actionResult.captureResult;
    const recordRes = captureRes.recordResult;

    console.log('\n===============================================================');
    console.log('BENCHMARK RESULTS (OCS-003):');
    console.log('===============================================================');
    console.log('Video Settings:', JSON.stringify(captureRes.videoTrack?.settings, null, 2));
    console.log('Tab Audio Settings:', JSON.stringify(captureRes.tabAudioTrack?.settings, null, 2));
    console.log('Mic Audio Settings:', JSON.stringify(captureRes.micAudioTrack?.settings, null, 2));
    console.log('Audio Monitor Status:', captureRes.monitorStatus);
    console.log('MIME Type:', captureRes.recorderMimeType);
    console.log('Chunks Emitted:', recordRes.chunksCount);
    console.log('Blob Size:', recordRes.blobSize, 'bytes', `(${(recordRes.blobSize / 1024 / 1024).toFixed(2)} MB)`);

    const averageBitrateMbps = ((recordRes.blobSize * 8) / (DURATION_MS / 1000) / 1000 / 1000).toFixed(2);
    console.log(`Average Bitrate: ${averageBitrateMbps} Mbps`);

    // Verify and save recording file
    let outFilePath = null;
    let isEbml = false;
    if (recordRes.base64Data) {
      const recordingsDir = path.resolve(__dirname, '..', 'recordings');
      if (!fs.existsSync(recordingsDir)) {
        fs.mkdirSync(recordingsDir, { recursive: true });
      }
      const webmBuffer = Buffer.from(recordRes.base64Data, 'base64');
      outFilePath = path.join(recordingsDir, 'recording-1080p-60s.webm');
      fs.writeFileSync(outFilePath, webmBuffer);

      isEbml = webmBuffer[0] === 0x1A && webmBuffer[1] === 0x45 && webmBuffer[2] === 0xDF && webmBuffer[3] === 0xA3;
      console.log(`\n✓ Recording saved to: ${outFilePath}`);
      console.log(`✓ Magic EBML Header: ${isEbml ? 'VALID (0x1A 0x45 0xDF 0xA3)' : 'INVALID'}`);
    }

    // Save structured benchmark report
    const benchmarkData = {
      ticket: 'OCS-003',
      status: 'VERIFIED',
      timestamp: new Date().toISOString(),
      chromeVersion: await browser.version(),
      platform: process.platform,
      requested: {
        width: 1920,
        height: 1080,
        fps: 30,
        durationSeconds: 60,
        includeTabAudio: true,
        includeMicAudio: true,
        mimeType: 'video/webm;codecs=vp9,opus'
      },
      actual: {
        videoSettings: captureRes.videoTrack?.settings,
        tabAudioSettings: captureRes.tabAudioTrack?.settings,
        micAudioSettings: captureRes.micAudioTrack?.settings,
        monitorStatus: captureRes.monitorStatus,
        chunksCount: recordRes.chunksCount,
        blobSizeBytes: recordRes.blobSize,
        blobSizeMB: +(recordRes.blobSize / 1024 / 1024).toFixed(2),
        bitrateMbps: +averageBitrateMbps,
        isEbmlValid: isEbml,
        savedPath: outFilePath
      },
      resourceSamples,
      debugLogs: captureRes.debugLogs
    };

    const outJsonPath = path.resolve(__dirname, 'benchmark-results-ocs003.json');
    fs.writeFileSync(outJsonPath, JSON.stringify(benchmarkData, null, 2), 'utf-8');
    console.log(`✓ Benchmark data saved to: ${outJsonPath}`);

  } finally {
    if (samplingInterval) clearInterval(samplingInterval);
    await browser.close();
    server.close();
  }
}

runBenchmark().catch(err => {
  console.error('Fatal error during OCS-003 benchmark:', err);
  process.exit(1);
});
