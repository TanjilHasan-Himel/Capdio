// apps/extension/src/offscreen/index.ts
// Capdio Offscreen Document - Media Sandbox & Recorder Host (OCS-102 / OCS-103 / OCS-104)

import { registerMessageListener, sendTypedMessage, MessageBusError } from '../shared/message-bus.ts';
import type { CaptureProfile, CaptureKind } from '../shared/types.ts';

console.log('[Capdio Offscreen] Host initializing...');

let activeStream: MediaStream | null = null;
let activeRecorder: MediaRecorder | null = null;
let activeAudioContext: AudioContext | null = null;
let activeMicStream: MediaStream | null = null;
let activeSessionId: string | null = null;
let recordedChunks: Blob[] = [];

function probeCapabilities() {
  const codecs = [
    'video/webm',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=h264,opus',
    'video/mp4'
  ];

  const codecSupport: Record<string, boolean> = {};
  for (const codec of codecs) {
    codecSupport[codec] = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(codec);
  }

  return {
    audioContext: typeof AudioContext !== 'undefined',
    mediaDevices: typeof navigator.mediaDevices !== 'undefined',
    mediaRecorder: typeof MediaRecorder !== 'undefined',
    codecs: codecSupport
  };
}

function selectBestMimeType(preference: 'webm' | 'mp4' = 'webm'): string {
  if (preference === 'mp4' && MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a.40.2')) {
    return 'video/mp4;codecs=avc1,mp4a.40.2';
  }
  if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')) {
    return 'video/webm;codecs=vp9,opus';
  }
  if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) {
    return 'video/webm;codecs=vp8,opus';
  }
  if (MediaRecorder.isTypeSupported('video/webm')) {
    return 'video/webm';
  }
  return '';
}

async function startCaptureAndRecord(payload: {
  sessionId: string;
  streamId?: string;
  kind?: CaptureKind;
  profile: CaptureProfile;
}) {
  const { sessionId, streamId, kind = 'tab', profile } = payload;
  console.log(`[Capdio Offscreen] Starting capture for session: ${sessionId}, kind: ${kind}, streamId: ${streamId}`);

  activeSessionId = sessionId;
  recordedChunks = [];

  let capturedStream: MediaStream;
  try {
    if (kind === 'screen' || kind === 'window') {
      const displayConstraints: DisplayMediaStreamOptions = {
        video: {
          width: { ideal: profile.width || 1920, max: 3840 },
          height: { ideal: profile.height || 1080, max: 2160 },
          frameRate: { ideal: profile.fps || 30, max: 60 }
        },
        audio: profile.tabAudio !== false
      };
      try {
        capturedStream = await navigator.mediaDevices.getDisplayMedia(displayConstraints);
      } catch (dispErr: any) {
        console.warn('[Offscreen] getDisplayMedia rejected:', dispErr.name, dispErr.message);
        if (
          dispErr.name === 'NotAllowedError' ||
          dispErr.message?.toLowerCase().includes('denied') ||
          dispErr.message?.toLowerCase().includes('cancel')
        ) {
          throw new MessageBusError('E_CAPTURE_DENIED', 'Screen or window capture was cancelled or denied by user');
        }
        throw new MessageBusError('E_CAPTURE_DENIED', dispErr.message || 'Display capture failed');
      }
    } else {
      if (!streamId) {
        throw new MessageBusError('E_CAPTURE_DENIED', 'No streamId provided for tab capture');
      }
      const constraints = {
        audio: profile.tabAudio !== false ? {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: streamId
          }
        } : false,
        video: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: streamId,
            maxWidth: profile.width || 1920,
            maxHeight: profile.height || 1080,
            maxFrameRate: profile.fps || 30
          }
        }
      };
      capturedStream = await navigator.mediaDevices.getUserMedia(constraints as any);
    }

    activeStream = capturedStream;

    // Attach to video sink to ensure active frame delivery
    const videoSink = document.getElementById('captureSink') as HTMLVideoElement;
    if (videoSink) {
      videoSink.srcObject = capturedStream;
      await videoSink.play().catch(err => console.warn('[Offscreen] videoSink play warning:', err));
    }

    const videoTracks = capturedStream.getVideoTracks();
    const sourceAudioTracks = capturedStream.getAudioTracks();

    if (videoTracks.length === 0) {
      throw new MessageBusError('E_CAPTURE_DENIED', 'No video track returned by capture');
    }

    // Attach onended to video track so user clicking "Stop sharing" automatically stops recording
    videoTracks[0]!.onended = async () => {
      console.log('[Capdio Offscreen] Video track ended by user/system, stopping capture...');
      try {
        await sendTypedMessage('background', 'STOP_CAPTURE');
      } catch (stopErr) {
        console.warn('[Offscreen] auto-stop onended warning:', stopErr);
      }
    };

    // Audio Graph setup
    let finalAudioTrack: MediaStreamTrack | null = null;
    if (sourceAudioTracks.length > 0 || profile.microphone) {
      activeAudioContext = new AudioContext();
      const mixedDestination = activeAudioContext.createMediaStreamDestination();

      if (sourceAudioTracks.length > 0) {
        const sourceAudio = activeAudioContext.createMediaStreamSource(new MediaStream([sourceAudioTracks[0]!]));
        // Route 1: Record mixer
        sourceAudio.connect(mixedDestination);
        // Route 2: Speakers monitor ONLY for tab capture to prevent tab muting
        // (Do NOT route screen/window audio to speakers, as system audio is already audible through speakers)
        if (kind === 'tab' && profile.tabAudio) {
          sourceAudio.connect(activeAudioContext.destination);
        }
      }

      if (profile.microphone) {
        try {
          activeMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const micSource = activeAudioContext.createMediaStreamSource(activeMicStream);
          // Route exclusively to recording mixer (NEVER to speakers to prevent feedback!)
          micSource.connect(mixedDestination);
        } catch (micErr: any) {
          console.warn('[Offscreen] Optional microphone access failed, proceeding without mic:', micErr);
        }
      }

      const mixedTracks = mixedDestination.stream.getAudioTracks();
      if (mixedTracks.length > 0) {
        finalAudioTrack = mixedTracks[0]!;
      }
    }

    // Combine video track and mixed audio track into recording stream
    const recordingStream = new MediaStream();
    recordingStream.addTrack(videoTracks[0]!);
    if (finalAudioTrack) {
      recordingStream.addTrack(finalAudioTrack);
    }

    const mimeType = selectBestMimeType(profile.mimePreference);
    if (!mimeType) {
      throw new MessageBusError('E_CODEC_UNSUPPORTED', 'No supported WebM or MP4 MediaRecorder codec found');
    }

    activeRecorder = new MediaRecorder(recordingStream, {
      mimeType,
      ...(profile.videoBitrate ? { videoBitsPerSecond: profile.videoBitrate } : {})
    });

    activeRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    const startPromise = new Promise<void>((resolve) => {
      if (!activeRecorder) return resolve();
      activeRecorder.onstart = () => resolve();
    });

    activeRecorder.start(250); // Slice every 250ms for incremental reliability
    await startPromise;

    console.log('[Capdio Offscreen] MediaRecorder actively recording with MIME:', mimeType);

    return {
      sessionId,
      status: 'recording',
      mimeType,
      videoSettings: videoTracks[0]?.getSettings(),
      audioTracksCount: recordingStream.getAudioTracks().length
    };
  } catch (err: any) {
    console.error('[Capdio Offscreen] Failed to start capture and record:', err);
    throw new MessageBusError('E_CAPTURE_DENIED', err.message || 'Capture initialization failed');
  }
}

async function stopCaptureAndRecord() {
  console.log('[Capdio Offscreen] Stopping capture and finalizing recording...');
  if (!activeRecorder || activeRecorder.state === 'inactive') {
    return {
      sessionId: activeSessionId,
      status: 'ready',
      totalBytes: 0,
      chunksCount: 0
    };
  }

  const stopPromise = new Promise<void>((resolve) => {
    if (!activeRecorder) return resolve();
    activeRecorder.onstop = () => resolve();
  });

  try {
    activeRecorder.requestData();
  } catch (err) {
    console.warn('[Capdio Offscreen] requestData error before stop:', err);
  }

  activeRecorder.stop();
  await stopPromise;

  // Release all tracks
  if (activeStream) {
    activeStream.getTracks().forEach(t => t.stop());
    activeStream = null;
  }
  if (activeMicStream) {
    activeMicStream.getTracks().forEach(t => t.stop());
    activeMicStream = null;
  }
  if (activeAudioContext) {
    await activeAudioContext.close().catch(() => {});
    activeAudioContext = null;
  }

  const mimeType = activeRecorder?.mimeType || 'video/webm';
  const finalBlob = new Blob(recordedChunks, { type: mimeType });
  const totalBytes = finalBlob.size;
  const chunksCount = recordedChunks.length;

  console.log(`[Capdio Offscreen] Finalized recording blob: ${totalBytes} bytes in ${chunksCount} chunks`);

  // Convert Blob to base64 for message transfer (robust against commas in mimeType like codecs=vp9,opus)
  const base64Data = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = (reader.result as string) || '';
      const marker = ';base64,';
      const markerIndex = dataUrl.indexOf(marker);
      const base64 = markerIndex !== -1 ? dataUrl.substring(markerIndex + marker.length) : '';
      resolve(base64);
    };
    reader.readAsDataURL(finalBlob);
  });

  const result = {
    sessionId: activeSessionId,
    status: 'ready',
    totalBytes,
    chunksCount,
    mimeType: finalBlob.type,
    base64Data
  };

  activeRecorder = null;
  activeSessionId = null;
  recordedChunks = [];

  return result;
}

registerMessageListener('offscreen', {
  PING: async () => {
    return {
      offscreenActive: true,
      timestamp: Date.now(),
      capabilities: probeCapabilities()
    };
  },

  OFFSCREEN_START: async (msg: any) => {
    return await startCaptureAndRecord(msg.payload);
  },

  OFFSCREEN_PAUSE: async () => {
    if (activeRecorder && activeRecorder.state === 'recording') {
      activeRecorder.pause();
    }
    return { status: 'paused', sessionId: activeSessionId };
  },

  OFFSCREEN_RESUME: async () => {
    if (activeRecorder && activeRecorder.state === 'paused') {
      activeRecorder.resume();
    }
    return { status: 'recording', sessionId: activeSessionId };
  },

  OFFSCREEN_STOP: async () => {
    return await stopCaptureAndRecord();
  }
});

console.log('[Capdio Offscreen] Host ready and message listeners registered');
