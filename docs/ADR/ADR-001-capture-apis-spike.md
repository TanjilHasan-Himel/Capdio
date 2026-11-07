# ADR-001: Chrome MV3 Capture APIs, Permissions, and Offscreen Architecture

**Status:** Accepted  
**Date:** 2026-11-07  
**Author:** OpenCapture Studio Architecture Team  
**Ticket:** OCS-002  

## Context
OpenCapture Studio requires reliable browser tab recording up to 1080p/4K with synchronized tab audio and optional microphone. In Chrome Manifest V3 (MV3):
1. Service workers cannot access DOM APIs, Web Audio (`AudioContext`), or media capture/recording APIs (`navigator.mediaDevices.getUserMedia`, `MediaRecorder`).
2. Google Chrome has introduced strict security policies regarding tab access, user gestures (`activeTab`), and command-line flags.

## Architectural Discoveries & Empirical Findings

### 1. Browser Environment & `--load-extension` Behavior
- **Chrome Official Distribution (v156+):** In official branded Google Chrome builds (starting v137/v142 through v156), Google deliberately disabled the `--load-extension` command-line switch to prevent adware/malware from force-loading unauthorized extensions.
- **Chrome for Testing (CfT):** For automated verification, headless/headful testing, and CI/CD pipelines, Google officially maintains "Chrome for Testing" (tested on v152.0.7977.42). In CfT, `--load-extension` works as intended. In everyday user environments, users load unpacked extensions via `chrome://extensions` Developer Mode or the Chrome Web Store.

### 2. Tab Capture API (`chrome.tabCapture.getMediaStreamId`)
- `chrome.tabCapture.getMediaStreamId` returns an ephemeral string stream ID (24 characters, base64-encoded GUID).
- **User Invocation Enforcement:** Calling `getMediaStreamId` without explicit user interaction on the target tab throws:
  `"Extension has not been invoked for the current page (see activeTab permission). Chrome pages cannot be captured."`
- The extension **must** be triggered via a direct user action on that tab:
  - An extension toolbar action click (`chrome.action.onClicked`)
  - A user gesture inside the extension's action popup
  - A context menu or registered keyboard shortcut (`commands`)
- Internal browser surfaces (`chrome://*`, `chrome-extension://*`, and the Chrome Web Store) are strictly protected by Chromium and cannot be captured.

### 3. Offscreen Document Host (`chrome.offscreen`)
- An offscreen document created with reason `chrome.offscreen.Reason.USER_MEDIA` serves as the media capture host.
- Passing `mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId }` to `navigator.mediaDevices.getUserMedia` inside the offscreen document successfully acquires:
  - Video Track: Captured at exact requested resolution (verified 1920×1080 @ 30 FPS, aspect ratio 1.7777777777777777).
  - Audio Track: 2 channels (stereo), 48,000 Hz sample rate, 16-bit depth, ~9ms latency.

### 4. Audio Suppression & Monitor Routing
- When Chrome captures a tab's audio via `tabCapture`, the browser automatically silences the tab from the physical speakers.
- To prevent the tab from going silent while recording, the offscreen document routes the audio track through Web Audio:
  ```javascript
  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  source.connect(audioCtx.destination);
  ```
- This restores live audio monitoring to the user's speakers while simultaneously piping the stream into `MediaRecorder`.

### 5. MediaRecorder & Codec Support
- Probed capabilities confirmed support for:
  - `video/webm;codecs=vp9,opus` (Primary recommendation for high quality)
  - `video/webm;codecs=vp8,opus` (Fallback for low-spec hardware)
  - `video/webm;codecs=h264,opus`
  - `video/mp4;codecs=avc1`
- In offscreen documents, attaching the stream to a playing HTML `<video>` element ensures frames flow continuously without stalling.
- Verified output: Valid WebM container with magic EBML header `0x1A 0x45 0xDF 0xA3`, producing 1.14 MB for 3.0s of 1080p/30 recording (~3.1 Mbps).

## Consequences
- Single-tab capture is fully viable under MV3 using `activeTab`, `tabCapture`, and `offscreen`.
- Multi-tab capture requires explicit per-tab authorization (as analyzed for Gate G4).
- Production design must always initiate capture from the user action/popup and pass the ephemeral `streamId` to the offscreen worker.

