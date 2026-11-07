// OpenCapture Studio - Service Worker (OCS-002 Spike)

chrome.runtime.onInstalled.addListener(() => {
  console.log('[SW] Extension installed / initialized');
});

const OFFSCREEN_PATH = 'offscreen.html';

async function hasOffscreenDocument() {
  if ('hasDocument' in chrome.offscreen) {
    return await chrome.offscreen.hasDocument();
  }
  // Fallback for older Chrome versions
  const clients = await self.clients.matchAll();
  return clients.some(c => c.url.endsWith(OFFSCREEN_PATH));
}

async function ensureOffscreenDocument() {
  const exists = await hasOffscreenDocument();
  if (!exists) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: 'Recording tab capture audio and video stream via MediaRecorder'
    });
  }
}

async function closeOffscreenDocument() {
  const exists = await hasOffscreenDocument();
  if (exists) {
    await chrome.offscreen.closeDocument();
  }
}

async function getTabMediaStreamId(targetTabId) {
  return new Promise((resolve, reject) => {
    const options = {};
    if (typeof targetTabId === 'number') {
      options.targetTabId = targetTabId;
    }
    chrome.tabCapture.getMediaStreamId(options, (streamId) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      if (!streamId) {
        return reject(new Error('Failed to obtain stream ID from tabCapture'));
      }
      resolve(streamId);
    });
  });
}

let lastActionCaptureResult = null;
globalThis.__lastResult = null;
globalThis.__recordingConfig = null;

chrome.action.onClicked.addListener(async (tab) => {
  console.log('[SW] Action clicked on tab:', tab.id, tab.url);
  try {
    const streamId = await getTabMediaStreamId(tab.id);
    console.log('[SW] Acquired streamId:', streamId);

    const config = globalThis.__recordingConfig || {
      width: 1920,
      height: 1080,
      fps: 30,
      enableMonitorAudio: true,
      includeMic: true,
      durationMs: 3000,
      mimeType: 'video/webm;codecs=vp9,opus'
    };

    await ensureOffscreenDocument();
    console.log('[SW] Sending to offscreen document with config:', config);
    const captureResult = await chrome.runtime.sendMessage({
      target: 'offscreen',
      action: 'CAPTURE_AND_RECORD',
      payload: {
        streamId,
        ...config
      }
    });

    lastActionCaptureResult = {
      success: true,
      tabId: tab.id,
      tabUrl: tab.url,
      streamIdPreview: streamId.substring(0, 15) + '...',
      streamIdLength: streamId.length,
      captureResult
    };
    globalThis.__lastResult = lastActionCaptureResult;
    console.log('[SW] Capture finished successfully:', lastActionCaptureResult);
  } catch (err) {
    console.error('[SW] Action capture failed:', err);
    lastActionCaptureResult = {
      success: false,
      error: err.message,
      stack: err.stack
    };
    globalThis.__lastResult = lastActionCaptureResult;
  }
});

// Handler for messages from popup, offscreen, or test runner
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Security Check 1: Enforce sender identity boundary
  if (!sender || sender.id !== chrome.runtime.id) {
    console.warn('[SW Security] Rejected message from unauthorized sender:', sender);
    sendResponse({ success: false, errorCode: 'E_ACCESS_DENIED', error: 'Unauthorized sender origin' });
    return false;
  }

  // Security Check 2: Enforce message schema
  if (!message || typeof message !== 'object' || typeof message.action !== 'string') {
    console.warn('[SW Security] Rejected malformed message:', message);
    sendResponse({ success: false, errorCode: 'E_INVALID_MESSAGE', error: 'Malformed message schema: missing action string' });
    return false;
  }

  if (message.target === 'offscreen') {
    // Let offscreen handle it
    return false;
  }

  (async () => {
    try {
      if (message.action === 'PING') {
        return { success: true, timestamp: Date.now() };
      }

      if (message.action === 'GET_LAST_ACTION_RESULT') {
        return { success: true, result: lastActionCaptureResult };
      }

      if (message.action === 'ENSURE_OFFSCREEN') {
        await ensureOffscreenDocument();
        return { success: true, hasDocument: true };
      }

      if (message.action === 'CLOSE_OFFSCREEN') {
        await closeOffscreenDocument();
        return { success: true, hasDocument: false };
      }

      if (message.action === 'GET_STREAM_ID') {
        const streamId = await getTabMediaStreamId(message.targetTabId);
        return {
          success: true,
          streamId,
          streamIdLength: streamId.length,
          streamIdType: typeof streamId
        };
      }

      if (message.action === 'RUN_SPIKE_PROBE') {
        await ensureOffscreenDocument();
        const probeResponse = await chrome.runtime.sendMessage({
          target: 'offscreen',
          action: 'PROBE_CAPABILITIES'
        });
        return probeResponse;
      }

      if (message.action === 'RUN_CAPTURE_WITH_STREAM_ID') {
        await ensureOffscreenDocument();
        const captureResponse = await chrome.runtime.sendMessage({
          target: 'offscreen',
          action: 'CAPTURE_AND_RECORD',
          payload: {
            streamId: message.streamId,
            width: message.width || 1920,
            height: message.height || 1080,
            fps: message.fps || 30,
            enableMonitorAudio: message.enableMonitorAudio !== false,
            durationMs: message.durationMs || 3000,
            mimeType: message.mimeType || 'video/webm;codecs=vp9,opus'
          }
        });
        return {
          success: true,
          captureResult: captureResponse
        };
      }

      if (message.action === 'RUN_FULL_CAPTURE_SPIKE') {
        await ensureOffscreenDocument();
        const targetTabId = message.targetTabId;
        const streamId = await getTabMediaStreamId(targetTabId);

        const captureResponse = await chrome.runtime.sendMessage({
          target: 'offscreen',
          action: 'CAPTURE_AND_RECORD',
          payload: {
            streamId,
            width: message.width || 1920,
            height: message.height || 1080,
            fps: message.fps || 30,
            enableMonitorAudio: message.enableMonitorAudio !== false,
            durationMs: message.durationMs || 3000,
            mimeType: message.mimeType || 'video/webm;codecs=vp9,opus'
          }
        });

        return {
          success: true,
          streamIdPreview: streamId.substring(0, 12) + '...',
          captureResult: captureResponse
        };
      }

      return { success: false, error: `Unhandled action: ${message.action}` };
    } catch (err) {
      return { success: false, error: err.message, stack: err.stack };
    }
  })().then(sendResponse);

  return true; // Keep channel open for async response
});
