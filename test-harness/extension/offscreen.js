// OpenCapture Studio - Offscreen Host (OCS-002 Spike)

let activeStream = null;
let activeRecorder = null;
let activeAudioContext = null;
let recordedChunks = [];

// MIME types to probe for support
const PROBE_MIME_TYPES = [
  'video/webm',
  'video/webm;codecs=vp8',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=h264',
  'video/webm;codecs=h264,opus',
  'video/webm;codecs=avc1',
  'video/webm;codecs=av01',
  'video/mp4',
  'video/mp4;codecs=avc1',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=vp9'
];

function probeCapabilities() {
  const mimeSupport = {};
  for (const mime of PROBE_MIME_TYPES) {
    mimeSupport[mime] = MediaRecorder.isTypeSupported(mime);
  }

  return {
    audioContextSupported: typeof AudioContext !== 'undefined',
    mediaDevicesSupported: typeof navigator.mediaDevices !== 'undefined',
    getUserMediaSupported: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    mediaRecorderSupported: typeof MediaRecorder !== 'undefined',
    mimeSupport
  };
}

async function captureAndRecord({
  streamId,
  width = 1920,
  height = 1080,
  fps = 30,
  enableMonitorAudio = true,
  includeMic = false,
  durationMs = 3000,
  mimeType = 'video/webm;codecs=vp9,opus'
}) {
  const debugLogs = [];
  const startTime = performance.now();
  const oLog = (...args) => {
    const elapsed = (performance.now() - startTime).toFixed(1);
    const msg = `[+${elapsed}ms] ` + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    console.log(msg);
    debugLogs.push(msg);
  };

  oLog('Starting captureAndRecord with streamId:', streamId?.substring(0, 10), 'includeMic:', includeMic, 'durationMs:', durationMs);
  recordedChunks = [];

  // Best supported fallback if requested mimeType is not supported
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) {
      mimeType = 'video/webm;codecs=vp8,opus';
    } else if (MediaRecorder.isTypeSupported('video/webm')) {
      mimeType = 'video/webm';
    }
  }

  // Mandatory constraints for chromeMediaSource: 'tab'
  const constraints = {
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    },
    video: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
        maxFrameRate: fps,
        maxWidth: width,
        maxHeight: height
      }
    }
  };

  let tabStream = null;
  try {
    oLog('Requesting tabStream with constraints:', JSON.stringify(constraints));
    tabStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    oLog(`tabStream getUserMedia FAILED: ${err.name} - ${err.message}`);
    err.debugLogs = debugLogs;
    throw err;
  }
  activeStream = tabStream;

  // In offscreen documents, attaching the stream to a playing video element
  // ensures the video sink pipeline actively pulls and renders frames from the capture source
  const dummyVideo = document.createElement('video');
  dummyVideo.muted = true;
  dummyVideo.autoplay = true;
  dummyVideo.playsInline = true;
  dummyVideo.srcObject = tabStream;
  document.body.appendChild(dummyVideo);

  try {
    await dummyVideo.play();
  } catch (err) {
    console.warn('[Offscreen] video.play() warning:', err.message);
  }

  const videoTracks = tabStream.getVideoTracks();
  const tabAudioTracks = tabStream.getAudioTracks();

  if (videoTracks.length > 0) {
    const vt = videoTracks[0];
    oLog(`VideoTrack: id=${vt.id} enabled=${vt.enabled} muted=${vt.muted} readyState=${vt.readyState}`);
    vt.onmute = () => oLog('VideoTrack MUTED');
    vt.onunmute = () => oLog('VideoTrack UNMUTED');
  }

  if (tabAudioTracks.length > 0) {
    const at = tabAudioTracks[0];
    oLog(`TabAudioTrack: id=${at.id} enabled=${at.enabled} muted=${at.muted} readyState=${at.readyState}`);
    at.onmute = () => oLog('TabAudioTrack MUTED');
    at.onunmute = () => oLog('TabAudioTrack UNMUTED');
  }

  // Optional microphone stream
  let micStream = null;
  let micAudioTracks = [];
  if (includeMic) {
    try {
      oLog('Requesting microphone via getUserMedia({ audio: true })...');
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micAudioTracks = micStream.getAudioTracks();
      if (micAudioTracks.length > 0) {
        const mt = micAudioTracks[0];
        oLog(`MicAudioTrack: id=${mt.id} label="${mt.label}" enabled=${mt.enabled} readyState=${mt.readyState}`);
      }
    } catch (err) {
      oLog(`Microphone acquisition failed: ${err.message}`);
    }
  }

  const videoSettings = videoTracks.length > 0 ? videoTracks[0].getSettings() : null;
  const tabAudioSettings = tabAudioTracks.length > 0 ? tabAudioTracks[0].getSettings() : null;
  const micAudioSettings = micAudioTracks.length > 0 ? micAudioTracks[0].getSettings() : null;

  // Web Audio mixer graph:
  // 1. Instantiates AudioContext
  // 2. Mixes tab audio + mic audio into a single stereo destination track for recording
  // 3. Connects tab audio to speaker destination (monitor routing) so the user continues to hear the tab
  let monitorStatus = 'disabled';
  let streamToRecord = tabStream;

  try {
    activeAudioContext = new AudioContext();
    if (activeAudioContext.state === 'suspended') {
      await activeAudioContext.resume();
    }

    const mixedDestination = activeAudioContext.createMediaStreamDestination();

    if (tabAudioTracks.length > 0) {
      const tabSource = activeAudioContext.createMediaStreamSource(new MediaStream([tabAudioTracks[0]]));
      tabSource.connect(mixedDestination);

      if (enableMonitorAudio) {
        tabSource.connect(activeAudioContext.destination);
        monitorStatus = 'active (audio routed to speakers)';
      }
    }

    if (micAudioTracks.length > 0) {
      const micSource = activeAudioContext.createMediaStreamSource(new MediaStream([micAudioTracks[0]]));
      // Connect mic ONLY to recording destination, NOT to speakers (to avoid acoustic feedback loop)
      micSource.connect(mixedDestination);
      oLog('Microphone connected to Web Audio mixer destination.');
    }

    const mixedAudioTracks = mixedDestination.stream.getAudioTracks();
    if (mixedAudioTracks.length > 0 && videoTracks.length > 0) {
      streamToRecord = new MediaStream([videoTracks[0], mixedAudioTracks[0]]);
      oLog('Unified recording stream created with Video + Mixed Audio tracks.');
    }
  } catch (err) {
    oLog(`Web Audio setup error: ${err.message}`);
    streamToRecord = tabStream;
  }

  // Record snippet using MediaRecorder
  const recorderOptions = mimeType ? { mimeType } : {};
  oLog('Creating MediaRecorder with options:', recorderOptions);
  const recorder = new MediaRecorder(streamToRecord, recorderOptions);
  activeRecorder = recorder;

  const recordingPromise = new Promise((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      oLog('ondataavailable fired, size:', event.data?.size);
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    recorder.onerror = (event) => {
      oLog('MediaRecorder error:', event.error);
      reject(new Error(`MediaRecorder error: ${event.error}`));
    };

    recorder.onstop = async () => {
      oLog('onstop fired, total chunks:', recordedChunks.length);
      const blob = new Blob(recordedChunks, { type: recorder.mimeType });
      oLog('Created final blob, size:', blob.size, 'type:', blob.type);

      // Convert to base64 for test export/inspection
      let base64 = null;
      try {
        const buffer = await blob.arrayBuffer();
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        base64 = btoa(binary);
      } catch (e) {
        oLog('Base64 export warning:', e.message);
      }

      resolve({
        blobSize: blob.size,
        blobType: blob.type,
        chunksCount: recordedChunks.length,
        base64Data: base64
      });
    };
  });

  // Wait for onstart before counting duration
  const startedPromise = new Promise(resolve => {
    recorder.onstart = () => {
      oLog('MediaRecorder started event fired, state:', recorder.state);
      resolve();
    };
  });

  // Start recorder with 250ms timeslices
  oLog('Calling recorder.start(250)...');
  recorder.start(250);
  await startedPromise;

  oLog(`Waiting for ${durationMs}ms of active recording...`);
  await new Promise(r => setTimeout(r, durationMs));

  // Flush any pending data before stopping
  if (recorder.state === 'recording') {
    oLog('Calling recorder.requestData()...');
    recorder.requestData();
  }

  // Stop recorder
  oLog('Calling recorder.stop()...');
  recorder.stop();
  const recordResult = await recordingPromise;

  // Cleanup
  dummyVideo.srcObject = null;
  dummyVideo.remove();

  for (const t of tabStream.getTracks()) {
    t.stop();
  }
  if (micStream) {
    for (const t of micStream.getTracks()) {
      t.stop();
    }
  }
  if (activeAudioContext && activeAudioContext.state !== 'closed') {
    await activeAudioContext.close();
    activeAudioContext = null;
  }
  activeStream = null;
  activeRecorder = null;

  return {
    success: true,
    debugLogs,
    videoTrack: {
      count: videoTracks.length,
      label: videoTracks[0]?.label,
      enabled: videoTracks[0]?.enabled,
      readyState: videoTracks[0]?.readyState,
      settings: videoSettings
    },
    tabAudioTrack: {
      count: tabAudioTracks.length,
      label: tabAudioTracks[0]?.label,
      enabled: tabAudioTracks[0]?.enabled,
      readyState: tabAudioTracks[0]?.readyState,
      settings: tabAudioSettings
    },
    micAudioTrack: {
      count: micAudioTracks.length,
      label: micAudioTracks[0]?.label,
      enabled: micAudioTracks[0]?.enabled,
      readyState: micAudioTracks[0]?.readyState,
      settings: micAudioSettings
    },
    monitorStatus,
    recorderMimeType: recorder.mimeType,
    recordResult
  };
}

// Runtime message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Security Check 1: Enforce sender identity boundary
  if (!sender || sender.id !== chrome.runtime.id) {
    console.warn('[Offscreen Security] Rejected message from unauthorized sender:', sender);
    sendResponse({ success: false, errorCode: 'E_ACCESS_DENIED', error: 'Unauthorized sender origin' });
    return false;
  }

  // Security Check 2: Enforce message schema
  if (!message || typeof message !== 'object' || typeof message.action !== 'string') {
    console.warn('[Offscreen Security] Rejected malformed message:', message);
    sendResponse({ success: false, errorCode: 'E_INVALID_MESSAGE', error: 'Malformed message schema' });
    return false;
  }

  if (message.target !== 'offscreen') {
    return false;
  }

  if (message.action === 'PROBE_CAPABILITIES') {
    const caps = probeCapabilities();
    sendResponse({ success: true, capabilities: caps });
    return true;
  }

  if (message.action === 'CAPTURE_AND_RECORD') {
    captureAndRecord(message.payload)
      .then(result => sendResponse(result))
      .catch(err => {
        sendResponse({
          success: false,
          error: err.message,
          name: err.name,
          stack: err.stack,
          debugLogs: err.debugLogs || []
        });
      });
    return true; // Keep channel open for async response
  }

  sendResponse({ success: false, error: `Unknown action: ${message.action}` });
  return false;
});
