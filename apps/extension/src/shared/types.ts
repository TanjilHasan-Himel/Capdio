// apps/extension/src/shared/types.ts
// Capdio Core Data Types & Message Contracts (MASTER_SPEC.md §02.5 & §02.9)

export type CaptureKind = 'tab' | 'display' | 'window';

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

export interface CaptureProfile {
  width: number;
  height: number;
  fps: 24 | 30 | 60;
  mimePreference: 'webm' | 'mp4';
  videoBitrate?: number;
  tabAudio: boolean;
  microphone: boolean;
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

export interface GetStatusMessage extends BaseMessage {
  action: 'GET_STATUS';
}

export interface StartCaptureMessage extends BaseMessage {
  action: 'START_CAPTURE';
  payload: {
    targetTabId?: number;
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
  payload: {
    sessionId: string;
  };
}

export interface OffscreenStartMessage extends BaseMessage {
  target: 'offscreen';
  action: 'OFFSCREEN_START';
  payload: {
    sessionId: string;
    streamId: string;
    profile: CaptureProfile;
  };
}

export interface OffscreenStopMessage extends BaseMessage {
  target: 'offscreen';
  action: 'OFFSCREEN_STOP';
  payload: {
    sessionId: string;
  };
}

export type ExtensionMessage =
  | PingMessage
  | GetStatusMessage
  | StartCaptureMessage
  | PauseCaptureMessage
  | ResumeCaptureMessage
  | StopCaptureMessage
  | OffscreenStartMessage
  | OffscreenStopMessage;

export interface MessageResponse<T = unknown> {
  success: boolean;
  data?: T;
  errorCode?: ErrorCode;
  error?: string;
}
