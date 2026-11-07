# OCS-002: Feasibility Spike Report — Chrome Capture APIs & Offscreen Pipeline

**Ticket ID:** OCS-002  
**Date:** 2026-11-07  
**Test Environment:** Windows 11 (win32), Chrome 152.0.7977.42 (Chrome for Testing) & Chrome 156.0.8078.80 (Host Chrome)  
**Status:** COMPLETED & VERIFIED WITH REAL MEDIA EVIDENCE  

---

## 1. Executive Summary
Ticket OCS-002 validated the core Chrome Manifest V3 APIs necessary to build OpenCapture Studio:
1. `chrome.tabCapture.getMediaStreamId` for tab media stream acquisition.
2. `chrome.offscreen` document creation and lifecycle management.
3. `navigator.mediaDevices.getUserMedia` consumption of tab stream ID.
4. Tab audio monitor routing via Web Audio API to prevent audio suppression.
5. `MediaRecorder` encoding into WebM (VP9 + Opus) with real binary output.
6. Verification of the output file's EBML magic header and playable structure.

All acceptance criteria for OCS-002 were satisfied with automated test evidence and an actual 1080p recording sample saved to disk.

---

## 2. Experimental Data & Measured Metrics

| Dimension | Requested | Actual Measured Output | Status |
|---|---|---|---|
| Video Resolution | 1920 × 1080 | 1920 × 1080 | Verified |
| Video Frame Rate | 30 FPS | 30 FPS | Verified |
| Aspect Ratio | 16:9 (1.7778) | 1.7777777777777777 | Verified |
| Video Resize Mode | - | crop-and-scale | Verified |
| Screen Pixel Ratio | - | 1.25 | Verified |
| Audio Channels | Stereo (2) | 2 (stereo) | Verified |
| Audio Sample Rate | 48,000 Hz | 48,000 Hz | Verified |
| Audio Sample Size | 16-bit | 16-bit | Verified |
| Audio Latency | - | 0.009187s (~9.2ms) | Verified |
| Audio Routing | Speakers audible | active (`audioContext.destination`) | Verified |
| Container / Mime | VP9 / Opus WebM | `video/webm;codecs=vp9,opus` | Verified |
| EBML Header | `0x1A 0x45 0xDF 0xA3` | `0x1A 0x45 0xDF 0xA3` (valid) | Verified |
| Output File Size | - | 1,143,793 bytes (1.14 MB / 3.0s) | Verified (~3.1 Mbps) |
| Chunks Emitted | - | 14 timesliced chunks | Verified |

---

## 3. Key Technical Discoveries & Resolutions

### Discovery 1: Google Chrome Flag Security Policy
- **Symptom:** Running `chrome.exe --load-extension=...` on official branded Google Chrome v156 failed to load unpacked extensions.
- **Cause:** Starting in Chrome 137+ and finalized in v142+, Google permanently removed the `--load-extension` CLI flag in official consumer builds to block malware/adware sideloading.
- **Resolution:** Automated test harnesses use Google's official **Chrome for Testing (CfT)** binary, which retains developer flags. End users install via Developer Mode in `chrome://extensions` or the Chrome Web Store.

### Discovery 2: User Invocation & `activeTab` Security Boundary
- **Symptom:** Background script calling `chrome.tabCapture.getMediaStreamId({ targetTabId })` threw:
  `"Extension has not been invoked for the current page (see activeTab permission). Chrome pages cannot be captured."`
- **Cause:** Chrome MV3 strictly forbids unprompted background recording of web pages. The extension must be invoked via a user action (`chrome.action.onClicked`, popup interaction, or keyboard shortcut).
- **Resolution:** The user interaction event triggers `activeTab` on the current tab, allowing `getMediaStreamId` to generate a valid, ephemeral 24-character stream token.

### Discovery 3: Tab Audio Suppression & AudioContext Bridge
- **Symptom:** Capturing tab audio automatically mutes the tab from the user's speakers in Chrome.
- **Resolution:** The offscreen document instantiates an `AudioContext`, creates a `MediaStreamSourceNode` from the tab audio track, and connects it to `audioContext.destination`. This provides transparent audio monitoring for the user while recording.

---

## 4. Test Execution & Evidence Verification

- Automated test command: `npm run spike:ocs-002`
- Script: `test-harness/test-action-click.js`
- Test fixture: `test-harness/fixtures/test-page.html` (animated 1080p canvas + 440Hz modulated synth audio)
- Generated media artifact: `recordings/test-spike-1080p.webm` (1,143,793 bytes)
- Header validation: First 4 bytes are confirmed `0x1A 0x45 0xDF 0xA3` (standard EBML ID).

