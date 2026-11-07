# OpenCapture Studio — Security & Privacy Architecture Review (OCS-004)

> **Document Status:** APPROVED / RATIFIED  
> **Target Release:** MV3 Local-First Core (Phase 0 / Gate G0)  
> **Last Updated:** 2026-11-07  
> **Specification Reference:** `MASTER_SPEC.md` §03 (Security, Privacy, Abuse-Prevention & Compliance)

---

## 1. Executive Summary

This document establishes the security architecture, threat model, and permission matrix for **OpenCapture Studio**. OpenCapture Studio is a privacy-first, local-only Chrome extension designed to record browser tabs and screens up to 4K resolution with high-fidelity audio (tab sound + microphone).

Phase 0 security testing empirically demonstrated that OpenCapture Studio **requires zero host permissions** (`<all_urls>` is completely eliminated). The extension strictly adheres to the principle of least privilege, operates within isolated Manifest V3 boundaries, and initiates zero external network requests.

---

## 2. Manifest V3 Permission Matrix

### 2.1 Justified Permissions (Minimal Whitelist)

| Permission | Scope / API | Technical Justification | User Exposure / UI Impact |
| :--- | :--- | :--- | :--- |
| **`tabCapture`** | `chrome.tabCapture.getMediaStreamId({ targetTabId })` | Required to generate an ephemeral, single-use media stream token scoped to the user-selected tab. | Explicit user invocation via extension icon or popup. Chrome shows native tab capture badge. |
| **`offscreen`** | `chrome.offscreen.createDocument({ reasons: ['USER_MEDIA'], ... })` | MV3 Service Workers cannot access DOM or `MediaStream` objects. An offscreen document is required to host Web Audio mixing and `MediaRecorder`. | Headless offscreen document. Managed entirely by service worker lifecycle. |
| **`activeTab`** | Ephemeral tab access upon user gesture | Grants temporary permission to access the currently active tab ID upon user gesture (clicking extension icon or popup). | No permanent permissions prompt. Scoped strictly to the active tab during invocation. |
| **`storage`** | `chrome.storage.local` | Stores user configuration (resolution presets, audio device preferences) and session manifest registry. Media chunks are stored in OPFS/IndexedDB. | None. Purely local to extension origin. |

---

### 2.2 Prohibited & Explicitly Excluded Permissions

| Prohibited Permission | Risk Identified in Threat Model | Resolution / Architecture Rule |
| :--- | :--- | :--- |
| **`<all_urls>` / `*://*/*`** | High risk: allows reading/modifying DOM and injecting code across all websites. Triggers high-risk Chrome Web Store review. | **COMPLETELY REMOVED.** Empirically verified in OCS-004 that tab capture works without host permissions. |
| **`tabs`** | Persistent broad access to tab URLs, titles, and browsing history across all windows. | **REJECTED.** Replaced with `activeTab`, which provides the target tab ID only upon direct user interaction. |
| **`scripting`** | Dynamic script and style injection into web pages. | **REJECTED.** Video and audio capture operate entirely via browser media stream streams; no page DOM manipulation is needed. |
| **`webRequest` / `webRequestBlocking`** | Interception and modification of user network traffic. | **REJECTED.** Extension performs no network interception or monitoring. |
| **`cookies`** | Access to authentication session cookies across origins. | **REJECTED.** No cookie access or user session tracking. |
| **`history` / `bookmarks`** | Access to personal user browsing history and bookmarks. | **REJECTED.** Zero access required or permitted. |
| **`management`** | Inspecting or altering other installed extensions. | **REJECTED.** Isolated strictly to own extension sandbox. |
| **`declarativeNetRequest`** | Network rule filtering. | **REJECTED.** No network modification. |

---

## 3. Trust Boundaries & Threat Model

```
+--------------------------------------------------------------------------+
|                            UNTRUSTED ZONE                                |
|   External Web Pages (e.g., https://example.com, http://127.0.0.1:3456)   |
|   - NO access to chrome.runtime.sendMessage                              |
|   - NO access to extension storage or DOM                                |
|   - externally_connectable is NOT configured (browser-level block)        |
+------------------------------------+-------------------------------------+
                                     |
               [User Gesture: click / action / shortcut]
                                     |
+------------------------------------v-------------------------------------+
|                         EXTENSION ORIGIN BOUNDARY                        |
|                                                                          |
|  +--------------------------------------------------------------------+  |
|  |                      UI Layer (Popup / Options)                   |  |
|  |  - Enforces UI state machine (IDLE, RECORDING, PAUSED, STOPPED)   |  |
|  |  - Sanitizes all display text (no innerHTML, strict React JSX)     |  |
|  +---------------------------------+----------------------------------+  |
|                                    |                                     |
|                       Typed Runtime Messages (Validated)                 |
|                                    |                                     |
|  +---------------------------------v----------------------------------+  |
|  |                 MV3 Service Worker (Coordinator)                   |  |
|  |  - Validates sender: sender.id === chrome.runtime.id              |  |
|  |  - Validates schema: action string, typed payload                 |  |
|  |  - Acquires ephemeral stream ID: tabCapture.getMediaStreamId      |  |
|  |  - Controls offscreen document lifecycle                          |  |
|  +---------------------------------+----------------------------------+  |
|                                    |                                     |
|                       Single-Use Ephemeral Stream ID                     |
|                                    |                                     |
|  +---------------------------------v----------------------------------+  |
|  |                  Offscreen Document (Media Sandbox)               |  |
|  |  - Consumes stream ID once via navigator.mediaDevices.getUserMedia|  |
|  |  - Web Audio Graph: Tab audio routed to speakers (Monitor)       |  |
|  |  - Web Audio Graph: Mic audio routed ONLY to recorder (No echo)   |  |
|  |  - MediaRecorder encodes WebM (VP9/VP8/H.264 + Opus)              |  |
|  |  - Persists chunks incrementally to OPFS / IndexedDB              |  |
|  +---------------------------------+----------------------------------+  |
|                                    |                                     |
|  +---------------------------------v----------------------------------+  |
|  |                  Local Storage Sandbox (OPFS / IDB)                |  |
|  |  - Origin-isolated local storage                                 |  |
|  |  - Zero network telemetry / Zero cloud uploads                     |  |
|  +--------------------------------------------------------------------+  |
+--------------------------------------------------------------------------+
```

### 3.1 Untrusted Web Page Boundary
- Web pages loaded in browser tabs cannot communicate with the extension.
- Chrome's `externally_connectable` is not declared. Attempts by web pages to invoke `chrome.runtime.sendMessage(extensionId, ...)` fail at the browser sandbox level.
- Attack simulation in OCS-004 test suite confirmed web origin isolation.

### 3.2 Service Worker Message Validation
- All messages handled by `chrome.runtime.onMessage` must pass two mandatory checks:
  1. **Origin Verification:** `sender.id === chrome.runtime.id`. Unauthorized origins receive `{ success: false, errorCode: 'E_ACCESS_DENIED' }`.
  2. **Schema Verification:** Payload must be a non-null object with a valid `action` string. Malformed structures receive `{ success: false, errorCode: 'E_INVALID_MESSAGE' }`.

### 3.3 Ephemeral Media Stream IDs
- Stream IDs obtained via `chrome.tabCapture.getMediaStreamId({ targetTabId })` are 24-character cryptographic tokens.
- Tokens expire within seconds if unused.
- Tokens can be consumed only once by `navigator.mediaDevices.getUserMedia`.
- Scoped strictly to `targetTabId` validated against active tab state.

### 3.4 Audio Routing & Acoustic Privacy
- Tab audio captured by Chrome is automatically suppressed from speakers. The offscreen host explicitly routes tab audio to `AudioContext.destination` so the user can continue hearing the page.
- **Hardware Microphone Isolation:** Microphone audio track is connected **exclusively** to the recording mixer destination (`audioContext.createMediaStreamDestination()`). Microphone audio is **NEVER** routed to `audioContext.destination` (speakers). This completely eliminates acoustic feedback loops and prevents accidental room eavesdropping amplification.

### 3.5 Content Security Policy (CSP)
- Extension pages and offscreen host are protected by a strict CSP:
  ```json
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self';"
  }
  ```
- Evaluated scripts (`eval()`), `new Function()`, and remote scripts are strictly prohibited.

---

## 4. Privacy & Regulatory Compliance

1. **No External Network Calls:** OpenCapture Studio performs zero analytics, telemetry, or remote crash reporting.
2. **Local Data Ownership:** All recordings and session metadata remain on the user's local disk (OPFS, IndexedDB, local downloads).
3. **Recording Law Disclosure:** The UI presents clear disclosures that the user is responsible for obtaining consent from meeting participants in accordance with applicable local, state, and international wiretapping/recording laws.
4. **DRM / Protected Content:** Widevine/FairPlay protected streams that fail to capture are handled with graceful error reporting (`E_CAPTURE_DENIED`), without attempting circumventive injection.

---

## 5. Security QA Checklist Verification

- [x] **No CVE rated high/critical unresolved:** Clean npm dependency footprint (`puppeteer-core`).
- [x] **Manifest includes only justified permissions:** `"tabCapture"`, `"offscreen"`, `"activeTab"`, `"storage"`. Zero `<all_urls>`.
- [x] **No external network call initiated:** Verified in network tests.
- [x] **Untrusted web page messages rejected:** Verified via automated attack simulation.
- [x] **Malformed runtime messages rejected with `E_INVALID_MESSAGE`:** Verified by automated suite.
- [x] **Strict Content Security Policy enforced:** Tested in static manifest audit.
- [x] **Mic track isolated from monitor route:** Verified in Web Audio graph audit.

