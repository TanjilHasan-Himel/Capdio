// apps/extension/src/shared/types.ts
// Capdio Core Data Types & Message Contracts (MASTER_SPEC.md §02.5 & §02.9)

export type CaptureKind = 'tab' | 'display' | 'screen' | 'window';

export type RecordStatus =
  | 'idle'
  | 'requesting_permission'
  | 'preparing'
  | 'recording'
  | 'paused'
  | 'finalizing'
  | 'ready'
  | 'interrupted'
  | 'error';

export type QualityPresetName = 'economy' | 'balanced' | 'high' | 'ultra';

export interface QualityPreset {
  name: QualityPresetName;
  label: string;
  width: number;
  height: number;
  fps: 24 | 30 | 60;
  videoBitrate: number; // in bps
}

export const QUALITY_PRESETS: Record<QualityPresetName, QualityPreset> = {
  economy: {
    name: 'economy',
    label: '720p HD (30 FPS, 2.5 Mbps)',
    width: 1280,
    height: 720,
    fps: 30,
    videoBitrate: 2_500_000
  },
  balanced: {
    name: 'balanced',
    label: '1080p Full HD (30 FPS, 5.0 Mbps)',
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrate: 5_000_000
  },
  high: {
    name: 'high',
    label: '1440p 2K (60 FPS, 10.0 Mbps)',
    width: 2560,
    height: 1440,
    fps: 60,
    videoBitrate: 10_000_000
  },
  ultra: {
    name: 'ultra',
    label: '4K Ultra HD (60 FPS, 20.0 Mbps)',
    width: 3840,
    height: 2160,
    fps: 60,
    videoBitrate: 20_000_000
  }
};

export function getPreset(name: QualityPresetName): QualityPreset {
  return QUALITY_PRESETS[name] || QUALITY_PRESETS.balanced;
}

export function formatQualityDisplay(
  requested: { presetName?: QualityPresetName; width?: number; height?: number; fps?: number },
  actual?: { width?: number; height?: number; fps?: number }
): {
  badgeLabel: string;
  detailLabel: string;
  isConstrained: boolean;
} {
  const reqPreset = requested.presetName ? QUALITY_PRESETS[requested.presetName] : null;
  const reqWidth = requested.width || reqPreset?.width || 1920;
  const reqHeight = requested.height || reqPreset?.height || 1080;
  const reqFps = requested.fps || reqPreset?.fps || 30;

  const actWidth = actual?.width || reqWidth;
  const actHeight = actual?.height || reqHeight;
  const actFps = actual?.fps || reqFps;

  const isConstrained = actWidth < reqWidth || actHeight < reqHeight || actFps < reqFps;

  const presetNameUpper = requested.presetName
    ? requested.presetName.charAt(0).toUpperCase() + requested.presetName.slice(1)
    : '';

  const badgeLabel = isConstrained
    ? `${actHeight}p @ ${actFps}fps (Constrained)`
    : `${actHeight}p @ ${actFps}fps`;

  const detailLabel = isConstrained
    ? `Requested: ${presetNameUpper ? presetNameUpper + ' ' : ''}${reqWidth}×${reqHeight} @ ${reqFps} FPS • Actual: ${actWidth}×${actHeight} @ ${actFps} FPS (Display Constrained)`
    : `Quality: ${actWidth}×${actHeight} @ ${actFps} FPS (${presetNameUpper || 'Native'})`;

  return {
    badgeLabel,
    detailLabel,
    isConstrained
  };
}

export interface CodecCapabilityReport {
  supportedMimeTypes: string[];
  bestWebM: string | null;
  bestMp4: string | null;
  canRecordWebM: boolean;
  canRecordMp4: boolean;
  defaultMimeType: string;
}

export interface CaptureProfile {
  presetName?: QualityPresetName;
  width: number;
  height: number;
  fps: 24 | 30 | 60;
  mimePreference: 'webm' | 'mp4';
  videoBitrate?: number;
  tabAudio: boolean;
  microphone: boolean;
  micDeviceId?: string;
}

export interface AudioTrackMetadata {
  hasTabAudio: boolean;
  hasMicrophone: boolean;
  micDeviceId?: string;
  micDeviceLabel?: string;
  sampleRate?: number;
  channelCount?: number;
  echoCancellation?: boolean | string;
}

export interface AudioInputDevice {
  deviceId: string;
  label: string;
  groupId?: string;
}

export interface AudioHealthReport {
  hasAudioContext: boolean;
  hasMicStream: boolean;
  monitorActive: boolean;
  micMuted: boolean;
  rmsLevel: number;
  peakDb: number;
  isClipping: boolean;
}

export function calculateAudioLevels(timeDomainData: Float32Array): {
  rmsLevel: number;
  peakDb: number;
  isClipping: boolean;
} {
  let sumSquares = 0;
  let peak = 0;
  const len = timeDomainData.length;
  for (let i = 0; i < len; i++) {
    const val = timeDomainData[i]!;
    const abs = Math.abs(val);
    if (abs > peak) peak = abs;
    sumSquares += val * val;
  }
  const rms = Math.sqrt(sumSquares / (len || 1));
  const rmsLevel = Math.min(1.0, Math.max(0.0, rms * 2.5));
  const peakDb = peak > 0.0001 ? Math.max(-60, 20 * Math.log10(peak)) : -100;
  const isClipping = peak >= 0.98;

  return {
    rmsLevel: parseFloat(rmsLevel.toFixed(3)),
    peakDb: parseFloat(peakDb.toFixed(1)),
    isClipping
  };
}

export interface SourceInfo {
  sourceId: string;
  kind: CaptureKind;
  tabId?: number;
  displayLabel: string;
  authorizedAt: string;
  requestedWidth?: number;
  requestedHeight?: number;
  requestedFps?: number;
  actualWidth?: number;
  actualHeight?: number;
  actualFps?: number;
  audioMetadata?: AudioTrackMetadata;
}

export interface RecordingSegment {
  partId: string;
  sourceId: string;
  startMs: number;
  durationMs?: number;
  bytes: number;
  digest?: string;
}

export const CURRENT_MANIFEST_SCHEMA_VERSION = 2;

export type StorageBackend = 'memory' | 'indexeddb' | 'opfs';

export interface SessionManifest {
  schemaVersion: number;
  sessionId: string;
  createdAt: string;
  status: RecordStatus;
  profile: CaptureProfile;
  sources: SourceInfo[];
  segments: RecordingSegment[];
  title?: string;
  durationMs?: number;
  totalBytes?: number;
  finalizedAt?: string;
  storageBackend?: StorageBackend;
  isRecoverable?: boolean;
  errorCode?: ErrorCode;
}

// Error Taxonomy (MASTER_SPEC.md §02.9)
export type ErrorCode =
  | 'E_CAPTURE_DENIED'
  | 'E_PERMISSION_REVOKED'
  | 'E_SOURCE_CLOSED'
  | 'E_AUDIO_DEVICE_UNAVAILABLE'
  | 'E_CODEC_UNSUPPORTED'
  | 'E_STORAGE_QUOTA'
  | 'E_WRITE_FAILED'
  | 'E_ENCODER_FAILED'
  | 'E_SESSION_CONFLICT'
  | 'E_INVALID_MESSAGE'
  | 'E_ACCESS_DENIED'
  | 'E_FINALIZE_TIMEOUT'
  | 'E_RECOVERY_PARTIAL'
  | 'E_SESSION_UNRECOVERABLE'
  | 'E_BROWSER_INCOMPATIBLE'
  | 'E_MULTI_TAB_NOT_SUPPORTED';

// Message Targets
export type MessageTarget = 'background' | 'offscreen' | 'popup';

// Base Message
export interface BaseMessage {
  id: string;
  target: MessageTarget;
  timestamp: number;
  action: string;
}

// Concrete Message Actions
export interface PingMessage extends BaseMessage {
  action: 'PING';
}

export interface ProbeCapabilitiesMessage extends BaseMessage {
  action: 'PROBE_CAPABILITIES';
}

export interface GetStatusMessage extends BaseMessage {
  action: 'GET_STATUS';
}

export interface StartCaptureMessage extends BaseMessage {
  action: 'START_CAPTURE';
  payload: {
    targetTabId?: number;
    streamId?: string;
    displayLabel?: string;
    targetKind?: string;
    profile: CaptureProfile;
  };
}

export interface PauseCaptureMessage extends BaseMessage {
  action: 'PAUSE_CAPTURE';
  payload: {
    sessionId: string;
  };
}

export interface ResumeCaptureMessage extends BaseMessage {
  action: 'RESUME_CAPTURE';
  payload: {
    sessionId: string;
  };
}

export interface StopCaptureMessage extends BaseMessage {
  action: 'STOP_CAPTURE';
  payload?: {
    sessionId?: string;
    reason?: 'user_stop' | 'source_tab_closed' | 'track_ended' | string;
  };
}

export interface ResetCaptureMessage extends BaseMessage {
  action: 'RESET_CAPTURE';
}

export interface GetSessionMessage extends BaseMessage {
  action: 'GET_SESSION';
  payload: {
    sessionId: string;
  };
}

export interface ListSessionsMessage extends BaseMessage {
  action: 'LIST_SESSIONS';
}

export interface DeleteSessionMessage extends BaseMessage {
  action: 'DELETE_SESSION';
  payload: {
    sessionId: string;
  };
}

export interface UpdateSessionMetadataMessage extends BaseMessage {
  action: 'UPDATE_SESSION_METADATA';
  payload: {
    sessionId: string;
    title?: string;
  };
}

export interface GetRecordingDataMessage extends BaseMessage {
  action: 'GET_RECORDING_DATA';
  payload: {
    sessionId: string;
  };
}

export interface DeleteRecordingDataMessage extends BaseMessage {
  action: 'DELETE_RECORDING_DATA';
  payload: {
    sessionId: string;
  };
}

export interface GetStorageEstimateMessage extends BaseMessage {
  action: 'GET_STORAGE_ESTIMATE';
}

export interface ListRecoverableSessionsMessage extends BaseMessage {
  action: 'LIST_RECOVERABLE_SESSIONS';
}

export interface RecoverSessionMessage extends BaseMessage {
  action: 'RECOVER_SESSION';
  payload: {
    sessionId: string;
  };
}

export interface DiscardRecoverableSessionMessage extends BaseMessage {
  action: 'DISCARD_RECOVERABLE_SESSION';
  payload: {
    sessionId: string;
  };
}

export interface OffscreenRecoverSessionMessage extends BaseMessage {
  target: 'offscreen';
  action: 'OFFSCREEN_RECOVER_SESSION';
  payload: {
    sessionId: string;
    mimeType?: string;
  };
}

export interface GetRecoverableInfoMessage extends BaseMessage {
  target: 'offscreen';
  action: 'GET_RECOVERABLE_INFO';
  payload: {
    sessionId: string;
  };
}

export interface OffscreenStartMessage extends BaseMessage {
  target: 'offscreen';
  action: 'OFFSCREEN_START';
  payload: {
    sessionId: string;
    streamId?: string;
    kind?: CaptureKind;
    profile: CaptureProfile;
  };
}

export interface OffscreenPauseMessage extends BaseMessage {
  target: 'offscreen';
  action: 'OFFSCREEN_PAUSE';
}

export interface OffscreenResumeMessage extends BaseMessage {
  target: 'offscreen';
  action: 'OFFSCREEN_RESUME';
}

export interface OffscreenStopMessage extends BaseMessage {
  target: 'offscreen';
  action: 'OFFSCREEN_STOP';
  payload?: {
    sessionId?: string;
  };
}

export interface OffscreenResetMessage extends BaseMessage {
  target: 'offscreen';
  action: 'OFFSCREEN_RESET';
}

export interface SetAudioMonitorMessage extends BaseMessage {
  action: 'SET_AUDIO_MONITOR';
  payload?: {
    enabled?: boolean;
    volume?: number;
  };
}

export interface SetMicMuteMessage extends BaseMessage {
  action: 'SET_MIC_MUTE';
  payload?: {
    muted: boolean;
  };
}

export interface GetAudioStatusMessage extends BaseMessage {
  action: 'GET_AUDIO_STATUS';
}

export interface EnumerateAudioDevicesMessage extends BaseMessage {
  action: 'ENUMERATE_AUDIO_DEVICES';
}

export type ExtensionMessage =
  | PingMessage
  | ProbeCapabilitiesMessage
  | GetStatusMessage
  | StartCaptureMessage
  | PauseCaptureMessage
  | ResumeCaptureMessage
  | StopCaptureMessage
  | ResetCaptureMessage
  | GetSessionMessage
  | ListSessionsMessage
  | DeleteSessionMessage
  | UpdateSessionMetadataMessage
  | GetRecordingDataMessage
  | DeleteRecordingDataMessage
  | GetStorageEstimateMessage
  | ListRecoverableSessionsMessage
  | RecoverSessionMessage
  | DiscardRecoverableSessionMessage
  | OffscreenRecoverSessionMessage
  | GetRecoverableInfoMessage
  | OffscreenStartMessage
  | OffscreenPauseMessage
  | OffscreenResumeMessage
  | OffscreenStopMessage
  | OffscreenResetMessage
  | SetAudioMonitorMessage
  | SetMicMuteMessage
  | GetAudioStatusMessage
  | EnumerateAudioDevicesMessage;

export interface MessageResponse<T = unknown> {
  success: boolean;
  data?: T;
  errorCode?: ErrorCode;
  error?: string;
}

