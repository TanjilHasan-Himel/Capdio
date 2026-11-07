# OpenCapture Studio — TDR

> Companion module to MASTER_SPEC.md. Master specification takes precedence.

# 02. TDR — Technical Design & Architecture

## 2.1 Supported environment
- Browser: latest stable Google Chrome desktop; minimum version selected after API compatibility tests (Chrome 116 introduced documented service-worker/offscreen flow).
- OS baseline: Windows 10/11; macOS/Linux best-effort after explicit smoke tests.
- V1: Chrome-only; do not advertise cross-browser support untested.
- Offline-first; no sign-up; no server and no remote telemetry in initial build.

## 2.2 Recommended technology choices
- TypeScript (strict mode), React + Vite for popup/options/side panel; MV3 extension manifest.
- Chrome extension `tabCapture`, `activeTab` when justified, `offscreen` and `storage` as necessary; `desktopCapture` or `getDisplayMedia` via permissible user gesture for screen/window source; avoid broad `tabs`, `host_permissions`, `scripting` unless justified with a tested feature.
- Service worker: routing, session state coordinator, permission/gesture orchestration; **does not** directly own MediaStream recording.
- Offscreen document: media acquisition (where permitted), MediaRecorder, Web Audio graph, session/chunk pipeline.
- WebM MediaRecorder as conservative default, MIME capability checks via `MediaRecorder.isTypeSupported()`; optional MP4 via proven browser codec/muxer implementation, not assumed.
- IndexedDB for metadata and bounded blobs or OPFS for large file/chunk persistence after browser-specific behavior tests; File System Access API optional if supported.
- Optional WebCodecs for advanced processing only after implementation benchmark; native-browser/worker performance preferred. Do not ship huge WASM FFmpeg without memory/security/performance analysis.
- Unit tests: Vitest; UI: Testing Library; extension E2E: Playwright/Puppeteer plus real-browser manual recording tests. Automation alone cannot prove capture UX or hardware behavior.

## 2.3 Component diagram (logical)
```text
User (popup / side panel / options)
  | explicit user action
MV3 Service Worker (command validation, FSM, session registry)
  | typed runtime messages / short-lived stream IDs
Offscreen Capture Host (MediaStream, Web Audio, MediaRecorder)
  | incremental chunks + checksums + timestamps
Local Storage Layer (IndexedDB / OPFS + manifest)
  | finalized/recovered recording assets
Library & Editor (preview / trim / export)
  | explicit user download
Device local files
```

## 2.4 Recording finite-state machine
`IDLE → REQUESTING_PERMISSION → PREPARING → RECORDING ↔ PAUSED → FINALIZING → READY`; failure path `ERROR` or `INTERRUPTED → RECOVERABLE / UNRECOVERABLE`. Every transition must be validated and persist the session ID/reason. `STOP` is idempotent. Closing the popup must not interrupt a running capture; closing source/browser may.

## 2.5 Interfaces / contracts
```ts
type CaptureKind = 'tab' | 'display' | 'window';
type RecordStatus = 'idle'|'requesting_permission'|'preparing'|'recording'|'paused'|'finalizing'|'ready'|'interrupted'|'error';
interface CaptureProfile { width: number; height: number; fps: 24|30|60; mimePreference: 'webm'|'mp4'; videoBitrate?: number; tabAudio: boolean; microphone: boolean; }
interface SourceInfo { sourceId: string; kind: CaptureKind; tabId?: number; displayLabel: string; authorizedAt: string; actualWidth?: number; actualHeight?: number; actualFps?: number; }
interface SessionManifest { schemaVersion: number; sessionId: string; createdAt: string; status: RecordStatus; profile: CaptureProfile; sources: SourceInfo[]; segments: Array<{partId:string; sourceId:string; startMs:number; durationMs?:number; bytes:number; digest?:string}>; errorCode?: string; }
type CaptureCommand = {requestId: string; sessionId: string; action: 'START'|'PAUSE'|'RESUME'|'STOP'|'STATUS'; sourceId?: string; profile?: CaptureProfile};
```

Rules: runtime messages must validate origin/sender and runtime payload schema; stream IDs are ephemeral; no recording blobs in chrome.storage.local; use append-only chunks and transactional manifest updates when possible. Use UUIDs; never rely on tab titles as storage keys. Restrict filenames and paths. Each segment tracks monotonic/clock timestamp and byte count; checksum if affordable.

## 2.6 Audio model
Capture tab audio only when the user opted in and browser provides it. If capture suppresses playback, use an explicitly user-controlled audio-monitor route through `AudioContext` to maintain listening when appropriate. Microphone needs separate permission and device selection. Prefer separate internal capture streams and source metadata; mixed master track only if user requests it. Distinguish own microphone from other meeting participants: normal conference tab capture is mixed remote audio, not independently isolated speakers.

## 2.7 Multi-tab spike: technical gate
**Hypothesis:** Multiple selected-tab streams may be maintained only when each source has a valid, user-authorized activation and the browser permits each `getMediaStreamId`/consumer route. `targetTabId` is permission-scoped; do not treat it as arbitrary silent access.

Experiments: (A) one active tab; (B) second tab after separate extension activation; (C) backgrounded first tab; (D) navigation/close in one; (E) distinct sound per tab; (F) 10/30-minute stress; (G) two 1080p/30 captures then optional 4K; (H) browser restart/recovery. Record exact Chrome version, permissions, clicks, logs, CPU/RAM/GPU/dropped FPS, file sizes, sync offset. **GO:** compliant user flow, two distinct playable outputs, acceptable resource load, reliable stop and disclosure. **NO-GO:** no permissions-safe workflow, high corruption, unacceptable CPU/RAM, or capture of wrong tab. If NO-GO, keep the feature behind disabled experimental flag; consider an explicitly installed desktop companion in future, never a permission bypass.

## 2.8 Recording/storage lifecycle
Initialize session manifest before capture → start with tested MIME and measured settings → chunk every ~1–5 seconds subject to benchmarking → persist chunks with quotas and free-space checks → flush on stop/track ended/OS events when possible → finalize asynchronously but show truthful state → maintain recovery index → only delete raw chunks after integrity-checked final output and user-approved retention. Do not hold a 30-minute 4K recording solely in JS memory. Data deletion means delete local assets and metadata; document that OS/browser backups may remain beyond app control.

## 2.9 Error taxonomy
- E_CAPTURE_DENIED, E_PERMISSION_REVOKED, E_SOURCE_CLOSED, E_AUDIO_DEVICE_UNAVAILABLE
- E_CODEC_UNSUPPORTED, E_STORAGE_QUOTA, E_WRITE_FAILED, E_ENCODER_FAILED
- E_SESSION_CONFLICT, E_INVALID_MESSAGE, E_FINALIZE_TIMEOUT, E_RECOVERY_PARTIAL
- E_BROWSER_INCOMPATIBLE, E_MULTI_TAB_NOT_SUPPORTED
Every error must offer user action, avoid leaking private titles/URLs into logs, and retain safe recoverable assets.

## 2.10 Accessibility & design
WCAG 2.2 AA as design target, keyboard focus order, labels, color-independent status, reduced-motion support, semantic controls, captions for any tutorial assets. High-quality minimalist UI; no heavy animations during recording. A recording badge must remain visible in extension surfaces and Chrome capture indicators must be respected.

---

