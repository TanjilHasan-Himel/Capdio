// OpenCapture Studio - Extension Test Harness (OCS-002)

const logEl = document.getElementById('log');
const statusEl = document.getElementById('status');

function log(msg) {
  const line = typeof msg === 'object' ? JSON.stringify(msg, null, 2) : msg;
  console.log(line);
  if (logEl) {
    logEl.textContent += line + '\n';
  }
}

window.runSpikeSuite = async function() {
  const results = {
    startedAt: new Date().toISOString(),
    tests: {}
  };

  try {
    statusEl.textContent = 'RUNNING';

    // 1. Service Worker Ping
    log('--- 1. Testing Service Worker Ping ---');
    const pingStart = performance.now();
    const pingRes = await chrome.runtime.sendMessage({ action: 'PING' });
    const pingLatencyMs = Math.round(performance.now() - pingStart);
    log({ pingRes, pingLatencyMs });
    results.tests.swPing = { ...pingRes, latencyMs: pingLatencyMs };

    // 2. Offscreen Document & Capability Probing
    log('--- 2. Testing Offscreen Document & Capability Probe ---');
    const probeRes = await chrome.runtime.sendMessage({ action: 'RUN_SPIKE_PROBE' });
    log(probeRes);
    results.tests.capabilities = probeRes;

    // 3. Create Fixture Tab
    log('--- 3. Creating Test Target Tab ---');
    const targetUrl = 'http://127.0.0.1:3456/test-page.html';
    const fixtureTab = await chrome.tabs.create({ url: targetUrl, active: false });
    log(`Fixture tab created: ID=${fixtureTab.id}`);
    results.tests.fixtureTab = { id: fixtureTab.id, url: targetUrl };

    // Wait 1.5s for tab to load and audio to start
    await new Promise(r => setTimeout(r, 1500));

    // 4. Stream ID Acquisition via chrome.tabCapture.getMediaStreamId
    log('--- 4. Requesting streamId from chrome.tabCapture ---');
    const streamStart = performance.now();
    const streamRes = await chrome.runtime.sendMessage({
      action: 'GET_STREAM_ID',
      targetTabId: fixtureTab.id
    });
    const streamLatencyMs = Math.round(performance.now() - streamStart);
    log({ streamRes, streamLatencyMs });
    results.tests.streamId = { ...streamRes, latencyMs: streamLatencyMs };

    if (!streamRes.success) {
      throw new Error(`Failed to get stream ID: ${streamRes.error}`);
    }

    // 5. Full Capture & Recording Spike (3 seconds)
    log('--- 5. Executing Capture & Recording Spike in Offscreen Host ---');
    const captureStart = performance.now();
    const captureRes = await chrome.runtime.sendMessage({
      action: 'RUN_FULL_CAPTURE_SPIKE',
      targetTabId: fixtureTab.id,
      width: 1920,
      height: 1080,
      fps: 30,
      enableMonitorAudio: true,
      durationMs: 3000,
      mimeType: 'video/webm;codecs=vp9,opus'
    });
    const captureDurationMs = Math.round(performance.now() - captureStart);
    log({ captureRes, captureDurationMs });
    results.tests.captureAndRecord = { ...captureRes, durationMs: captureDurationMs };

    // 6. Cleanup: close fixture tab and offscreen document
    log('--- 6. Cleaning up resources ---');
    await chrome.tabs.remove(fixtureTab.id);
    const closeOffscreenRes = await chrome.runtime.sendMessage({ action: 'CLOSE_OFFSCREEN' });
    log({ fixtureTabClosed: true, closeOffscreenRes });
    results.tests.cleanup = { fixtureTabClosed: true, closeOffscreenRes };

    results.completedAt = new Date().toISOString();
    results.overallSuccess = true;
    statusEl.textContent = 'PASSED';
  } catch (err) {
    log(`FAILED: ${err.message}\n${err.stack}`);
    results.error = { message: err.message, stack: err.stack };
    results.overallSuccess = false;
    statusEl.textContent = 'FAILED';
  }

  return results;
};
