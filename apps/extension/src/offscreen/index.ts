// apps/extension/src/offscreen/index.ts
// Capdio Offscreen Document - Media Sandbox & Recorder Host (OCS-102 - OCS-106)

import { registerMessageListener, sendTypedMessage, MessageBusError } from '../shared/message-bus.ts';
import type { CaptureProfile, CaptureKind, AudioTrackMetadata } from '../shared/types.ts';
import { getCodecCapabilityReport, selectBestCodec } from '../shared/codec-detector.ts';
import { chunkStorage } from '../shared/chunk-storage.ts';
import { quotaMonitor } from '../shared/quota-monitor.ts';

console.log('[Capdio Offscreen] Host initializing...');

let activeStream: MediaStream | null = null;
let activeRecorder: MediaRecorder | null = null;
let activeAudioContext: AudioContext | null = null;
let activeMicStream: MediaStream | null = null;
let activeSessionId: string | null = null;
let activeNegotiatedMime: string | null = null;
let activeIsFallback = false;
let recordedChunks: Blob[] = [];
let chunkSequenceNumber = 0;
let recordingStartTimeMs = 0;

// Modular Gain Nodes for Audio Graph Control (OCS-106)
let monitorGainNode: GainNode | null = null;
let tabRecordGainNode: GainNode | null = null;
let micRecordGainNode: GainNode | null = null;

function cleanupAudioAndStreams() {
  if (activeMicStream) {
    activeMicStream.getTracks().forEach(t => {
      try {
        t.stop();
      } catch (err) {
        console.warn('[Offscreen] Mic track stop error:', err);
      }
    });
    activeMicStream = null;
  }
  if (activeStream) {
    activeStream.getTracks().forEach(t => {
      try {
        t.stop();
      } catch (err) {
        console.warn('[Offscreen] Active stream track stop error:', err);
      }
    });
    activeStream = null;
  }
  if (activeAudioContext && activeAudioContext.state !== 'closed') {
    activeAudioContext.close().catch(() => {});
    activeAudioContext = null;
  }
  monitorGainNode = null;
  tabRecordGainNode = null;
  micRecordGainNode = null;
}

function probeHostCapabilities() {
  return {
    audioContext: typeof AudioContext !== 'undefined',
    mediaDevices: typeof navigator.mediaDevices !== 'undefined',
    mediaRecorder: typeof MediaRecorder !== 'undefined',
    report: getCodecCapabilityReport()
  };
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
  chunkSequenceNumber = 0;
  recordingStartTimeMs = Date.now();
  lastFinalizedResult = null;

  // Initialize IndexedDB storage schema
  try {
    await chunkStorage.init();
  } catch (initErr) {
    console.warn('[Offscreen] ChunkStorage init error:', initErr);
  }

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
        await sendTypedMessage('background', 'STOP_CAPTURE', { reason: 'track_ended' });
      } catch (stopErr) {
        console.warn('[Offscreen] auto-stop onended warning:', stopErr);
      }
    };

    // Audio Graph setup (OCS-106: playback monitor & optional microphone)
    let finalAudioTrack: MediaStreamTrack | null = null;
    let hasMicrophone = false;

    if (sourceAudioTracks.length > 0 || profile.microphone) {
      activeAudioContext = new AudioContext();
      const mixedDestination = activeAudioContext.createMediaStreamDestination();

      if (sourceAudioTracks.length > 0) {
        const sourceAudio = activeAudioContext.createMediaStreamSource(new MediaStream([sourceAudioTracks[0]!]));

        // Route 1: Record mixer path
        tabRecordGainNode = activeAudioContext.createGain();
        tabRecordGainNode.gain.value = 1.0;
        sourceAudio.connect(tabRecordGainNode);
        tabRecordGainNode.connect(mixedDestination);

        // Route 2: Speakers monitor ONLY for tab capture to prevent tab muting
        // (Do NOT route screen/window audio to speakers, as system audio is already audible through speakers)
        if (kind === 'tab' && profile.tabAudio) {
          monitorGainNode = activeAudioContext.createGain();
          monitorGainNode.gain.value = 1.0;
          sourceAudio.connect(monitorGainNode);
          monitorGainNode.connect(activeAudioContext.destination);
          console.log('[Capdio Offscreen] Tab audio monitor connected to speakers (gain: 1.0)');
        }
      }

      if (profile.microphone) {
        try {
          activeMicStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          });
          const micSource = activeAudioContext.createMediaStreamSource(activeMicStream);
          micRecordGainNode = activeAudioContext.createGain();
          micRecordGainNode.gain.value = 1.0;
          micSource.connect(micRecordGainNode);
          // CRITICAL: Connect ONLY to recording mixedDestination, NEVER to activeAudioContext.destination
          micRecordGainNode.connect(mixedDestination);
          hasMicrophone = true;
          console.log('[Capdio Offscreen] Microphone connected exclusively to recording mixer');
        } catch (micErr: any) {
          console.warn('[Offscreen] Optional microphone access failed, proceeding without mic:', micErr);
        }
      }

      const mixedTracks = mixedDestination.stream.getAudioTracks();
      if (mixedTracks.length > 0) {
        finalAudioTrack = mixedTracks[0]!;
      }
    }

    const audioMetadata: AudioTrackMetadata = {
      hasTabAudio: sourceAudioTracks.length > 0,
      hasMicrophone,
      sampleRate: finalAudioTrack?.getSettings()?.sampleRate,
      channelCount: finalAudioTrack?.getSettings()?.channelCount,
      echoCancellation: finalAudioTrack?.getSettings()?.echoCancellation
    };

    // Combine video track and mixed audio track into recording stream
    const recordingStream = new MediaStream();
    recordingStream.addTrack(videoTracks[0]!);
    if (finalAudioTrack) {
      recordingStream.addTrack(finalAudioTrack);
    }

    const { mimeType, isFallback } = selectBestCodec(profile.mimePreference);
    activeNegotiatedMime = mimeType;
    activeIsFallback = isFallback;

    console.log(
      `[Capdio Offscreen] Selected MIME: ${activeNegotiatedMime} (requested: ${profile.mimePreference}, isFallback: ${activeIsFallback})`
    );

    activeRecorder = new MediaRecorder(recordingStream, {
      mimeType: activeNegotiatedMime,
      ...(profile.videoBitrate ? { videoBitsPerSecond: profile.videoBitrate } : {})
    });

    activeRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        const seq = chunkSequenceNumber++;
        const partId = `part_${seq}`;
        const bytes = event.data.size;
        const startMs = recordingStartTimeMs ? Math.max(0, Date.now() - recordingStartTimeMs) : 0;

        // Persist chunk to IndexedDB
        chunkStorage.persistChunk({
          sessionId,
          sequenceNumber: seq,
          partId,
          timestamp: Date.now(),
          startMs,
          bytes,
          data: event.data
        }).catch((err) => {
          console.warn('[Capdio Offscreen] Failed to persist chunk to IndexedDB:', err);
        });

        // Bounded memory buffer: keep chunks for in-memory consolidation fallback
        recordedChunks.push(event.data);

        // Proactive Mid-Recording Quota Monitor (OCS-203)
        if (seq > 0 && seq % 5 === 0) {
          quotaMonitor.getEstimate().then((est) => {
            if (est.level === 'critical') {
              console.warn(`[Capdio Offscreen] CRITICAL storage threshold reached: only ${(est.availableBytes / (1024 * 1024)).toFixed(1)} MB remaining. Auto-stopping capture.`);
              sendTypedMessage('background', 'STOP_CAPTURE', { reason: 'low_storage' }).catch((e) => {
                console.error('[Offscreen] Failed to signal low_storage stop:', e);
              });
            }
          }).catch(() => {});
        }
      }
    };

    const startPromise = new Promise<void>((resolve) => {
      if (!activeRecorder) return resolve();
      activeRecorder.onstart = () => resolve();
    });

    activeRecorder.start(250); // Slice every 250ms for incremental reliability
    await startPromise;

    console.log('[Capdio Offscreen] MediaRecorder actively recording with MIME:', activeNegotiatedMime);

    return {
      sessionId,
      status: 'recording',
      mimeType: activeNegotiatedMime,
      isFallback: activeIsFallback,
      videoSettings: videoTracks[0]?.getSettings(),
      audioTracksCount: recordingStream.getAudioTracks().length,
      audioMetadata
    };
  } catch (err: any) {
    console.error('[Capdio Offscreen] Failed to start capture and record:', err);
    cleanupAudioAndStreams();
    const code = typeof err.code === 'string' ? err.code : 'E_CAPTURE_DENIED';
    throw new MessageBusError(code, err.message || 'Capture initialization failed');
  }
}

let inFlightStopPromise: Promise<any> | null = null;
let lastFinalizedResult: any = null;

async function stopCaptureAndRecord(requestedSessionId?: string) {
  if (inFlightStopPromise) {
    console.log('[Capdio Offscreen] stopCaptureAndRecord already in flight; awaiting existing promise');
    return inFlightStopPromise;
  }

  const targetSessionId = activeSessionId || requestedSessionId || null;

  if (!activeRecorder || activeRecorder.state === 'inactive') {
    if (
      lastFinalizedResult &&
      targetSessionId &&
      lastFinalizedResult.sessionId === targetSessionId
    ) {
      console.log('[Capdio Offscreen] Returning previously finalized recording result for session:', targetSessionId);
      return lastFinalizedResult;
    }
    return {
      sessionId: targetSessionId,
      status: 'ready',
      totalBytes: 0,
      chunksCount: 0
    };
  }

  inFlightStopPromise = (async () => {
    try {
      console.log('[Capdio Offscreen] Stopping capture and finalizing recording...');
      const recorder = activeRecorder;

      const stopWait = new Promise<void>((resolve) => {
        if (!recorder || recorder.state === 'inactive') return resolve();
        recorder.onstop = () => resolve();
      });

      try {
        if (recorder.state === 'recording' || recorder.state === 'paused') {
          recorder.requestData();
        }
      } catch (err) {
        console.warn('[Capdio Offscreen] requestData error before stop:', err);
      }

      try {
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      } catch (err) {
        console.warn('[Capdio Offscreen] recorder.stop error:', err);
      }

      await stopWait;

      // Release all audio and media tracks cleanly (OCS-106)
      cleanupAudioAndStreams();

      const mimeType = recorder?.mimeType || activeNegotiatedMime || 'video/webm';
      let finalBlob: Blob;
      let totalBytes = 0;
      let chunksCount = 0;

      // Primary strategy: assemble and persist consolidated blob in IndexedDB (OCS-202)
      try {
        const storedCount = activeSessionId ? await chunkStorage.getChunkCount(activeSessionId) : 0;
        if (storedCount > 0 && activeSessionId) {
          const finalized = await chunkStorage.assembleAndSaveFinalized(activeSessionId, mimeType);
          finalBlob = finalized.blob;
          totalBytes = finalized.totalBytes;
          chunksCount = storedCount;
          console.log(`[Capdio Offscreen] Assembled & persisted recording to IndexedDB: ${totalBytes} bytes across ${chunksCount} chunks`);
        } else {
          finalBlob = new Blob(recordedChunks, { type: mimeType });
          totalBytes = finalBlob.size;
          chunksCount = recordedChunks.length;
        }
      } catch (err) {
        console.warn('[Capdio Offscreen] IndexedDB assembly fallback to in-memory blob:', err);
        finalBlob = new Blob(recordedChunks, { type: mimeType });
        totalBytes = finalBlob.size;
        chunksCount = recordedChunks.length;
      }

      console.log(`[Capdio Offscreen] Finalized recording blob: ${totalBytes} bytes in ${chunksCount} chunks`);

      // Convert Blob to base64 for message transfer (robust against commas in mimeType like codecs=vp9,opus)
      let base64Data = '';
      if (totalBytes > 0) {
        base64Data = await new Promise<string>((resolve) => {
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
      }

      const result = {
        sessionId: activeSessionId,
        status: 'ready',
        totalBytes,
        chunksCount,
        mimeType: finalBlob.type,
        negotiatedMimeType: activeNegotiatedMime || finalBlob.type,
        isFallback: activeIsFallback,
        base64Data
      };

      lastFinalizedResult = result;
      activeRecorder = null;
      activeSessionId = null;
      activeNegotiatedMime = null;
      activeIsFallback = false;
      recordedChunks = [];

      return result;
    } finally {
      inFlightStopPromise = null;
    }
  })();

  return inFlightStopPromise;
}

registerMessageListener('offscreen', {
  PING: async () => {
    return {
      offscreenActive: true,
      timestamp: Date.now(),
      report: getCodecCapabilityReport()
    };
  },

  PROBE_CAPABILITIES: async () => {
    return probeHostCapabilities();
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

  OFFSCREEN_STOP: async (msg: any) => {
    return await stopCaptureAndRecord(msg.payload?.sessionId);
  },

  OFFSCREEN_RESET: async () => {
    lastFinalizedResult = null;
    activeRecorder = null;
    activeSessionId = null;
    recordedChunks = [];
    chunkSequenceNumber = 0;
    cleanupAudioAndStreams();
    return { success: true };
  },

  GET_RECORDING_DATA: async (msg: any) => {
    const sessionId = msg.payload?.sessionId;
    if (!sessionId) {
      throw new MessageBusError('E_INVALID_MESSAGE', 'Missing sessionId for GET_RECORDING_DATA');
    }
    let finalized = await chunkStorage.getFinalizedRecording(sessionId);
    if (!finalized) {
      // Auto-assemble from persistent chunks if available (resilience fallback)
      const chunkCount = await chunkStorage.getChunkCount(sessionId);
      if (chunkCount > 0) {
        console.log(`[Capdio Offscreen] GET_RECORDING_DATA assembling ${chunkCount} persistent chunks for session '${sessionId}'`);
        finalized = await chunkStorage.assembleAndSaveFinalized(sessionId, 'video/webm', false);
      }
    }

    if (!finalized) {
      throw new MessageBusError('E_INVALID_MESSAGE', `No recording data found for session '${sessionId}'`);
    }

    const base64Data = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = (reader.result as string) || '';
        const marker = ';base64,';
        const idx = dataUrl.indexOf(marker);
        resolve(idx !== -1 ? dataUrl.substring(idx + marker.length) : '');
      };
      reader.readAsDataURL(finalized.blob);
    });

    return {
      sessionId,
      mimeType: finalized.mimeType,
      totalBytes: finalized.totalBytes,
      durationMs: finalized.durationMs,
      base64Data
    };
  },

  OFFSCREEN_RECOVER_SESSION: async (msg: any) => {
    const sessionId = msg.payload?.sessionId;
    if (!sessionId) {
      throw new MessageBusError('E_INVALID_MESSAGE', 'Missing sessionId for OFFSCREEN_RECOVER_SESSION');
    }

    let finalized = await chunkStorage.getFinalizedRecording(sessionId);
    let chunkCount = 0;

    if (!finalized) {
      const chunks = await chunkStorage.getChunks(sessionId);
      if (!chunks || chunks.length === 0) {
        throw new MessageBusError('E_SESSION_UNRECOVERABLE', `No chunks found in persistent storage for session '${sessionId}'`);
      }
      chunkCount = chunks.length;
      const mimeType = msg.payload?.mimeType || 'video/webm';
      console.log(`[Capdio Offscreen] Recovering session '${sessionId}' with ${chunkCount} chunks, MIME: ${mimeType}`);
      finalized = await chunkStorage.assembleAndSaveFinalized(sessionId, mimeType, false);
    } else {
      chunkCount = await chunkStorage.getChunkCount(sessionId);
    }

    const base64Data = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = (reader.result as string) || '';
        const marker = ';base64,';
        const idx = dataUrl.indexOf(marker);
        resolve(idx !== -1 ? dataUrl.substring(idx + marker.length) : '');
      };
      reader.readAsDataURL(finalized.blob);
    });

    return {
      sessionId,
      status: 'ready',
      chunksCount: chunkCount,
      totalBytes: finalized.totalBytes,
      durationMs: finalized.durationMs,
      mimeType: finalized.mimeType,
      base64Data
    };
  },

  GET_RECOVERABLE_INFO: async (msg: any) => {
    const sessionId = msg.payload?.sessionId;
    if (!sessionId) {
      return { chunkCount: 0, totalBytes: 0 };
    }
    const chunkCount = await chunkStorage.getChunkCount(sessionId);
    const totalBytes = await chunkStorage.getTotalBytes(sessionId);
    return { sessionId, chunkCount, totalBytes };
  },

  DELETE_RECORDING_DATA: async (msg: any) => {
    const sessionId = msg.payload?.sessionId;
    if (sessionId) {
      await chunkStorage.deleteSessionData(sessionId);
    }
    return { success: true };
  },

  SET_AUDIO_MONITOR: async (msg: any) => {
    if (monitorGainNode) {
      const volume = typeof msg.payload?.volume === 'number' ? msg.payload.volume : (msg.payload?.enabled !== false ? 1.0 : 0.0);
      monitorGainNode.gain.value = Math.max(0, Math.min(1, volume));
      return { monitorEnabled: monitorGainNode.gain.value > 0, volume: monitorGainNode.gain.value };
    }
    return { monitorEnabled: false, volume: 0 };
  },

  SET_MIC_MUTE: async (msg: any) => {
    if (micRecordGainNode) {
      micRecordGainNode.gain.value = msg.payload?.muted ? 0.0 : 1.0;
      return { micMuted: micRecordGainNode.gain.value === 0 };
    }
    return { micMuted: false };
  },

  GET_AUDIO_STATUS: async () => {
    return {
      hasAudioContext: !!activeAudioContext,
      hasMicStream: !!activeMicStream,
      monitorActive: !!monitorGainNode && monitorGainNode.gain.value > 0
    };
  }
});

console.log('[Capdio Offscreen] Host ready and message listeners registered');

(window as any).__capdio = {
  chunkStorage,
  quotaMonitor
};
