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

export interface CodecCapabilityReport {
  supportedMimeTypes: string[];
  bestWebM: string | null;
  bestMp4: string | null;
  canRecordWebM: boolean;
  canRecordMp4: boolean;
  defaultMimeType: string;
}

export interface CaptureProfile {
  width: number;
  height: number;
  fps: 24 | 30 | 60;
  mimePreference: 'webm' | 'mp4';
  videoBitrate?: number;
  tabAudio: boolean;
  microphone: boolean;
}

export interface AudioTrackMetadata {
  hasTabAudio: boolean;
  hasMicrophone: boolean;
  sampleRate?: number;
  channelCount?: number;
  echoCancellation?: boolean | string;
}

export interface SourceInfo {
  sourceId: string;
  kind: CaptureKind;
  tabId?: number;
  displayLabel: string;
  authorizedAt: string;
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

export interface SessionManifest {
  schemaVersion: number;
  sessionId: string;
  createdAt: string;
  status: RecordStatus;
  profile: CaptureProfile;
  sources: SourceInfo[];
  segments: RecordingSegment[];
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
  | OffscreenStartMessage
  | OffscreenPauseMessage
  | OffscreenResumeMessage
  | OffscreenStopMessage
  | OffscreenResetMessage
  | SetAudioMonitorMessage
  | SetMicMuteMessage
  | GetAudioStatusMessage;

export interface MessageResponse<T = unknown> {
  success: boolean;
  data?: T;
  errorCode?: ErrorCode;
  error?: string;
}

