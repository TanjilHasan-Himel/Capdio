# OpenCapture Studio — Master Product & Technical Delivery Specification

**Document ID:** OCS-MASTER-001  
**Version:** 1.0 | **Date:** 2026-11-07 | **Status:** Build baseline / not implementation proof  
**Product working name:** OpenCapture Studio (rename before publishing; trademark/domain checks required)  
**Audience:** Owner, AI coding agents, engineers, QA, security reviewers, Chrome Web Store release owner  
**Delivery principle:** Personal-use-first, genuinely publishable, local-first, free core; commercial options later.

> **NON-NEGOTIABLE:** An agent must never claim the product is secure, 4K capable, multi-tab capable, privacy compliant, or Chrome Web Store approved without collecting the specific evidence stated in this document. Features not verified on target Chrome/OS/hardware must be labeled Experimental or Unsupported.

## 00. Executive Decision Record

### Problem
People need a reliable browser recorder for tutorials, product walkthroughs, meetings they are authorized to record, and independent browser-tab captures. Existing recorders can be feature-heavy or cloud-first, and a multi-source session with clearly separated tracks is difficult to manage. The owner and their users need a functional tool now, not a hypothetical future SaaS.

### Product promise
Record user-selected browser tab or display with understandable quality and audio controls; save locally with recovery protections; edit basic clips; export usable files. Add independently controllable multi-tab sources only if browser permissions and performance tests substantiate it.

### Release tiers
- **P0 / Stable Public V1:** single active tab capture, selectable screen/window capture, tab audio where provided, optional mic, pause/resume/stop, quality presets, recording status, chunked persistence, local library, playback, download/export, basic trim, onboarding and privacy surfaces.
- **P1 / Candidate:** picture-in-picture camera, drawing and cursor effects, auto-stop timer, advanced audio routing, upload import, MP4 where supported, optional more sophisticated editing.
- **P2 / Experiment:** two or more independently recorded tabs, capture coordinator, separate audio/video per source, synchronized session timeline, meeting-friendly presets; release only after explicit feasibility gate.
- **P3 / Future:** cloud collaboration, links, accounts, AI transcript, SaaS payments. Not needed for initial publication.

### Explicit exclusions
No hidden recording; no silent capturing of non-selected tabs; no bypass of user permission, content protection, DRM, platform access controls, or conferencing-service policies; no claim of remote participant-isolated streams from a standard mixed meeting tab; no covert monitoring, surveillance or keylogging; no forced cloud upload or account; no arbitrary remote code.

### Exit definition for 'market ready'
Published extension is not automatically market ready. Market ready means reliable actual use, honest store listing, reviewed security/privacy, user-facing docs, feasible performance, and satisfied release acceptance gates. Store approval cannot be guaranteed in advance.

---

# 01. PRD — Product Requirements Document

## 1.1 User segments and jobs-to-be-done
| Persona | Need | Success signal |
|---|---|---|
| Student / educator | Capture lectures, tutorials, walkthroughs | Saved playable lesson without losing audio |
| Developer / product owner | Explain bugs, demos, support steps | Fast record → review → export |
| Remote collaborator | Record authorized web meetings | Visible recording indication, audio, usable file |
| Power user | Record multiple selected tabs separately | Distinct, correctly attributed files and sync metadata when supported |

## 1.2 Core user journeys
**UJ-01 / Tab demo:** User opens extension → chooses current tab → chooses Balanced 1080p/30 → confirms mic/audio → clicks Start → visible indicator and timer → pause/resume → Stop → preview → save/download.

**UJ-02 / Screen capture:** User requests screen/window → Chrome chooser grants access → recording starts only after selection → Stop or track-ended event finalizes safely.

**UJ-03 / Meeting:** User selects conference tab and confirms recording is permitted → audio test meter → records tab mixed playback and optionally own microphone as separate logical track → visible notice → review and export. No platform-specific participant isolation claim.

**UJ-04 / Interruption:** During recording user closes popup, navigates tab, loses stream, runs low on storage, or browser crashes → persistent chunk/session manifest → when possible partial playback and recovery with explicit status and data integrity assessment.

**UJ-05 / Multi-tab research experiment:** User explicitly activates each source via permitted gesture or chooser → two source tracks start under a session coordinator → each source can stop independently → session metadata stores offsets → separate exports and optional combined timeline. If impossible under documented permissions, UX must show limitation, not circumvent it.

## 1.3 Requirements catalog
Priority: MUST = public V1 gate; SHOULD = post-V1; EXP = feasibility-gated.

| ID | Priority | Requirement | Acceptance test |
|---|---|---|---|
| FR-001 | MUST | User-selected tab video capture | Reproducible user gesture; successful recorded frames |
| FR-002 | MUST | Screen/window chooser mode | Chrome selection respected; denial handled |
| FR-003 | MUST | Captured tab audio when available | Audible playback and independent audio enable toggle |
| FR-004 | MUST | Optional microphone | Permission request on demand; no mic capture if off |
| FR-005 | MUST | Pause/resume/stop | UI and output reflect states; no duplicate start |
| FR-006 | MUST | Quality presets: 720p,1080p,1440p,4K request | Labels distinguish requested from actual capture/output resolution |
| FR-007 | MUST | FPS presets 24/30/60 request | Measured actual FPS reported; stable fallback if unsupported |
| FR-008 | MUST | Chunked writes + session metadata | Interruption can recover all intact chunks |
| FR-009 | MUST | Local session library, preview, rename, delete | No network required; permissioned file access |
| FR-010 | MUST | WebM save/download | Valid playable recording; no corrupted final chunks |
| FR-011 | MUST | Clear elapsed timer + always-visible capture status | Stop control reachable during all active recording states |
| FR-012 | MUST | Storage exhaustion handling | Warnings, safe stop, partial recovery without unbounded memory |
| FR-013 | MUST | Restricted permission model + consent | Permission audit passes; no hidden capture |
| FR-014 | MUST | Basic trim: set in/out, output file | Valid duration and A/V sync within tolerance |
| FR-015 | MUST | Responsive clean extension UI | Keyboard navigation and contrast/manual QA |
| FR-016 | SHOULD | Camera picture-in-picture | Explicit webcam consent and composited output |
| FR-017 | SHOULD | Cursor marker/draw/blur | Explicit on/off; no false promise for all surface types |
| FR-018 | SHOULD | Optional MP4 export | Feature-detected and tested codecs/container |
| FR-019 | SHOULD | Auto-stop timer | Stop completes even if popup closed |
| FR-020 | EXP | Two simultaneously captured tab sources | Permissioned workflow on fresh Chrome profile, independently playable |
| FR-021 | EXP | Per-tab independent audio capture | No cross-contamination on isolated test sounds |
| FR-022 | EXP | Multi-tab synchronized export | Offset bounded and measured; independent source controls |
| FR-023 | EXP | Meeting recording mode | Verified per conferencing site; no remote per-speaker claims |

## 1.4 Settings and recording profiles
Presets must describe **requested** configuration, not guarantee actual source/encoding.

| Preset | Requested output | Requested FPS | Suggested starting video bitrate* |
|---|---|---|---|
| Economy | 1280×720 | 24/30 | 2–4 Mbps |
| Balanced | 1920×1080 | 30 | 4–8 Mbps |
| High | 2560×1440 | 30/60 | 8–16 Mbps |
| Ultra | 3840×2160 | 30/60 | 16–35 Mbps |

*Planning estimates only; codec, scene complexity, capture size, encoding APIs and hardware change results. Implement feature detection and adaptive warnings. Default Balanced, do not select 4K automatically.

Settings: requested resolution; FPS; format (WebM by default); video bitrate target; include tab audio; mic device; optional separate own-mic track (where export supports it); monitoring/mute audio; countdown; auto stop; local file location through user-friendly export; auto-delete disabled by default; diagnostics opt-in only.

## 1.5 UX inventory
- **Popup:** quick record choices + source state + Start/Stop.
- **Side panel / dashboard:** sessions, source cards, toggles, timer, per-source state, recording health.
- **Onboarding:** purpose, permissions at point of use, disclosure, test recording.
- **Recording overlay:** status, pause, stop; do not obscure sensitive information or rely solely on popup.
- **Recovery center:** interrupted sessions, available chunks, failure reasons, restore/export/delete actions.
- **Local library:** cards/list, filter, playback, metadata, rename, trim, download, delete.
- **Settings:** quality, input devices, storage diagnostics, privacy, about, troubleshooting.
- **Release pages:** privacy policy, help/support, changelog, optional terms, accessibility note.

## 1.6 Success metrics (non-invasive)
Engineering: record start success ≥ 98% in controlled compatibility suite; stop/finalization success ≥ 99%; no high-severity security findings; no silent off-device transfer. Quality: A/V sync target |offset| ≤ 150 ms on 10-minute standardized tests; dropped-frame rate measured and disclosed, not a false universal promise. Reliability: single 30-minute 1080p/30 recording completes on owner hardware; recover intact chunks after forced termination. Product: first successful exported recording ≤ 3 min for new tester under normal conditions. Thresholds are internal targets, not verified claims.

---

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

# 03. Security, Privacy, Abuse-Prevention & Compliance

## 3.1 Threat model and trust boundaries
Assets: recordings, browser tab content, microphone audio, session metadata, local storage. Threats: over-broad permissions, inadvertent capture, malicious message senders, compromised dependencies, XSS in video titles, exposed local files, cross-tab mixing, unwanted uploads, arbitrary code, corrupt chunks, secret leakage, extension supply-chain compromise. Trust boundaries: web page vs isolated extension; popup ↔ SW ↔ offscreen; local storage vs exported files; optional cloud not present in V1.

## 3.2 Mandatory security controls
1. Minimum permissions, feature-by-feature justification and documented user gestures; avoid `<all_urls>` and persistent host permissions by default.
2. Visible recording indicator, explicit Start and immediate Stop; recording may never start when the browser launches.
3. Per-source consent/authorization; permission denial cannot trigger alternative hidden capture.
4. No credential capture, scraping, DOM monitoring, browsing history collection, or sensitive form extraction.
5. Strong CSP and MV3 packaging; no remotely hosted executable code, eval or dynamic untrusted script injection.
6. Type-safe runtime message schema and sender/origin checks; reject unexpected actions, double starts and stale sessions.
7. Sanitize every rendered string and exported filename; no untrusted HTML injection; avoid DOM `innerHTML`.
8. No default analytics, telemetry or external logging; local diagnostics opt-in and scrubbed if introduced later.
9. Dependabot or equivalent automated audit, lockfile, pinned versions and supply-chain review; create SBOM/release dependency snapshot.
10. No silent cloud transfer. Optional future upload: distinct informed opt-in, HTTPS, authorization/access control and deletion policy.
11. User-accessible local delete and simple retention settings; do not silently keep copies of deleted sessions.
12. Clear recording-law notice (user responsible for obtaining consent where required); no implication of universal legal permission.
13. DRM/protected content failure handled gracefully; no bypass guidance or implementation.
14. Security-sensitive settings and capture events covered by unit/integration tests.
15. Secrets absent from git, dist and frontend bundles. Future backend credentials only server side.

## 3.3 Chrome Web Store readiness
- One clear primary purpose: user-initiated screen/tab recording and local editing.
- Accurate store description/screenshots/permission explanations/privacy-practices declarations; no claims like 'always 4K' or 'record every tab' unless demonstrated.
- Privacy policy reachable from the product and listing, describing data processed locally, access permission, microphone/recordings, optional analytics (none by default), third parties (none by default), deletion and contact channel.
- Review extension program policy and user-data requirements at time of submission; approval is external decision.
- Respect content protection and service terms, avoid copying another project's proprietary UI/assets/code. Open-source code use requires license compliance.

## 3.4 Security QA checklist
[ ] No CVE rated high/critical unresolved without documented approved mitigation.  
[ ] Manifest includes only justified permissions.  
[ ] No external network call initiated during recording in default mode (verify devtools/network tests).  
[ ] Browser restart and popup close do not trigger unauthorized restart.  
[ ] Webpage-origin messages cannot start, stop, or steal recording data.  
[ ] UI title strings with HTML payload do not execute scripts.  
[ ] Download filename traversal/control characters neutralized.  
[ ] Device permissions revoked → capture stops/updates UI.  
[ ] All actual extension bundle JS comes from packaged code.  
[ ] User content never appears in crash-report telemetry by default.  
[ ] Security review signoff is attached to release notes.

---

# 04. Delivery Phases — Agent Work Breakdown

## Agent rules (apply to EVERY ticket)
- Work one ticket at a time. Read master spec and relevant code before editing.
- First output: exact files to change, assumptions, test strategy and risk. Then implement small focused diff.
- No unrelated refactors, dependency churn or permission expansion; seek owner approval for scope change.
- After implementation: run lint, type-check, unit tests, relevant E2E/manual checklist. Log failures; do not claim tests ran if they did not.
- Add/adjust tests for each behavior. Update architecture/README/change log only where necessary.
- Produce a handoff note: files changed, screenshots if UI, test commands/results, residual risks, next ticket.
- Another agent/reviewer must perform security+code review before merging permission/media/storage critical changes.
- Mark a ticket DONE only when its acceptance criteria are actually demonstrated; use BLOCKED with reproduction if browser restriction occurs.

## Phase 0 — Discovery & feasibility | Gate G0
**OCS-001** repository bootstrap, MIT/Apache license decision for original work, code owners, CONTRIBUTING, issue templates, CI baseline.  
**OCS-002** API feasibility spike: Chrome stable version, `tabCapture`, `getDisplayMedia`, offscreen creation, permissions and short-lived stream IDs; document differences.  
**OCS-003** 1080p test harness: record 60 seconds on target laptop with video+tab sound+mic; measure encoder and resource use.  
**OCS-004** security/privacy architecture review and permission matrix.  
**G0 pass:** a real local playable capture exists; permission architecture documented; capture uncertainty list signed off.

## Phase 1 — Stable capture core | Gate G1
**OCS-101** MV3 app skeleton + typed message bus, safe CSP and minimal manifest.  
**OCS-102** state machine and source session registry.  
**OCS-103** user-initiated single-tab capture through offscreen host.  
**OCS-104** Chrome native screen/window selector flow, permission refusal UI.  
**OCS-105** MediaRecorder MIME/codec feature detection + settings fallback.  
**OCS-106** tab audio playback-monitor routing and optional microphone.  
**OCS-107** start/pause/resume/stop controls, persistent recording indicator.  
**OCS-108** test source closure and popup closure; safe error propagation.  
**G1 pass:** 10/30-minute 1080p recordings on target laptop; valid audio, timer, tested denials and finalization.

## Phase 2 — Persistent storage & reliability | Gate G2
**OCS-201** schema-versioned session manifest and migration strategy.  
**OCS-202** chunk persistence in IndexedDB/OPFS with bounded memory.  
**OCS-203** quota monitoring and safe low-storage stop.  
**OCS-204** interruption handler + crash recovery UX with partial recording export.  
**OCS-205** local library, playback, rename, delete and file export.  
**OCS-206** session integrity and storage migration regression tests.  
**G2 pass:** forced shutdown tests preserve recoverable chunks; no silent loss after ordinary popup close; memory does not grow linearly with entire recording.

## Phase 3 — Quality, editor & usability | Gate G3
**OCS-301** quality presets and actual measured resolution/FPS display.  
**OCS-302** device selection, audio health meter, A/V sync suite.  
**OCS-303** basic in/out trim and export progress/error states.  
**OCS-304** onboarding/settings/help and accessible keyboard UX.  
**OCS-305** extension UI polish, empty/loading/error states.  
**OCS-306** documentation for limitations, troubleshooting, tested compatibility matrix.  
**G3 pass:** nontechnical tester can record and export without developer help; profiles degrade safely; trim doesn't damage media.

## Phase 4 — Multi-tab & meeting experimental track | Gate G4
**OCS-401** explicit two-tab user-authorization interaction prototype.  
**OCS-402** two capture streams managed with independent source IDs.  
**OCS-403** independent audio isolation test using different tone/video fixtures.  
**OCS-404** capture sync metadata and independent pause/stop behavior.  
**OCS-405** Meet/Teams/Zoom Web compatibility and consent copy.  
**OCS-406** resource/load tests and GO/NO-GO report.  
**G4 pass:** proof of authorization + 2 distinct 10-min playable streams with acceptable A/V sync/performance. Otherwise ship V1 without multi-tab and record a decision (no hidden fallback).

## Phase 5 — Security hardening and publication | Gate G5
**OCS-501** threat-model review, permissions minimization, CSP/supply-chain scans.  
**OCS-502** independent code review for data handling, messages, export, XSS and permission flow.  
**OCS-503** automated QA matrix + manual Chrome stable smoke tests.  
**OCS-504** privacy policy, help, support process, store copy/screenshots and permission explanations.  
**OCS-505** package audit (no secrets, sourcemaps decisions, licenses, file sizes), reproducible release.  
**OCS-506** staged test with real users; block publication on P0/P1 defects.  
**OCS-507** publish Chrome Web Store package; record approval status; test installed-store version after approval.  
**G5 pass:** documented QA/security signoff and complete submission package. External approval only after actual store decision.

## Phase 6 — Post-release stewardship (ongoing, not blocking V1)
**OCS-601** bugs/feedback triage and release cadence.  
**OCS-602** opt-in advanced editor experiments (cursor focus, blur, annotation).  
**OCS-603** optional MP4, camera picture-in-picture, configurable timers after benchmarking.  
**OCS-604** optional cloud/business model RFC only after user demand; free local functionality stays available.

---

# 05. Verification Plan & Test Matrix

## Tests required by category
- Unit: state transitions, message validation, preset fallback, manifest schema, filename sanitization, delete, error mapping.
- Integration: SW/offscreen message flow, capture tracks lifecycle, chunk writes/recovery, audio graph, export.
- Manual with actual browser: permission prompts, active tab changes, minimize/browser close, mic removal, no-audio tab, conference tab, secondary displays, 720p/1080p/4K request.
- Performance: 60s / 10min / 30min runs; observe resident memory, peak CPU, dropped frames, recording size, audio drift, storage failures.
- Adversarial: untrusted page sends spoofed messages, HTML-bearing titles, invalid chunk metadata, malicious filename, permission revoked, storage quota reached, corrupt blob.

## Target matrix
| Test ID | Context | Expected |
|---|---|---|
| QA-001 | Tab 1080p/30 with audio | Playable WebM, measured settings captured |
| QA-002 | Deny mic | Continues without mic if user agrees; UI honest |
| QA-003 | Deny display chooser | No recording; clear recovery action |
| QA-004 | Popup closes mid-recording | Capture continues or stops safely per documented model |
| QA-005 | Navigate captured tab | Continues/ends per documented browser behavior; no wrong-tab capture |
| QA-006 | Source tab closes | User notified; chunks recoverable |
| QA-007 | Low disk/quota | Safe stop, warning, no silent data loss |
| QA-008 | Browser terminated | Recovered recording clearly marked partial |
| QA-009 | 4K source / capable hardware | Actual dimensions/frames verified; fails gracefully otherwise |
| QA-010 | Meeting with separate mic | Mixed tab audio vs own mic labeled correctly |
| QA-011 | Two-tab experimental capture | Separate permissioned outputs or documented NO-GO |
| QA-012 | No internet | V1 recording/edit/export still works |
| QA-013 | Website with adversarial title | No script execution |
| QA-014 | Fresh Chrome profile | Install/onboarding/start/stop works |
| QA-015 | Store package inspection | Minimum permissions, policy links, no secret keys |

## Severity and blocking
- **P0:** covert capture, user data leak, unauthorized upload, broken Stop, corruption in ordinary path, RCE/script injection → release block.
- **P1:** frequent failed capture, audio missing on advertised supported flows, critical permission/consent UX failure, repeated crash → release block.
- **P2:** recoverable UI errors, codec fallback issue for niche hardware → release decision after disclosure and workaround.
- **P3:** cosmetic/rare convenience issues → backlog.

---

# 06. Repository Shape & Documentation Contracts

```text
opencapture-studio/
  apps/extension/
    public/manifest.json
    src/background/          # MV3 service worker, commands, FSM
    src/offscreen/           # stream acquisition, audio, recorder
    src/popup/               # quick controls
    src/sidepanel/           # session UX
    src/options/             # settings/privacy
    src/library/             # local recordings and editor
    src/shared/              # schemas, types, permissions
  packages/capture-core/     # recording abstraction
  packages/storage/          # IndexedDB/OPFS, recovery
  packages/ui/               # accessible components
  tests/unit/
  tests/integration/
  tests/manual/              # manual evidence templates
  docs/
    PRD.md
    TDR.md
    SECURITY.md
    PHASES.md
    TEST_PLAN.md
    RELEASE_CHECKLIST.md
    ADR/
  .github/workflows/
  README.md
  CHANGELOG.md
  LICENSE
```

**Engineering conventions:** npm/pnpm lockfile; TypeScript strict + ESLint + formatting; conventional commits optional; feature branches `feat/OCS-###`; PR must link ticket, tests, manual evidence (if media), permission changes, risk notes and rollback plan. Preserve design decisions in `docs/ADR/ADR-###.md`.

---

# 07. Agent Execution Protocol

## 7.1 Single-ticket prompt template
```text
You are the implementation agent for OpenCapture Studio.
Read docs/PRD.md, docs/TDR.md, docs/SECURITY.md, docs/PHASES.md, and the related code.
Implement ONLY ticket [OCS-###]. Do not claim unsupported browser capabilities.
Before coding, output (1) scope, (2) files touched, (3) security/permission impact,
(4) test plan, (5) unknowns. Then implement, add tests and run checks.
After coding, report exact command results, manual browser evidence needed,
limitations and a concise PR description. Do not mark DONE without evidence.
```

## 7.2 Mandatory handoff template
```text
Ticket: OCS-###
Status: DONE / BLOCKED / NEEDS_REVIEW
Scope implemented:
Changed files:
Permissions changed (yes/no; why):
Tests run (commands + pass/fail):
Manual Chrome version/OS/hardware evidence:
Security/privacy review:
Known limitations:
Acceptance criteria satisfied (itemized):
Next recommended ticket:
```

## 7.3 Roles and approval
- **Architect agent:** APIs, interface contracts, ADR, feasibility gates.
- **Implementation agent:** code changes restricted to one ticket.
- **QA agent:** independently reproduce acceptance criteria and negative paths.
- **Security agent:** permissions, user data, attack surface and supply chain.
- **Reviewer/release agent:** validates evidence, merges, release notes, release gate.
- **Human owner:** approves new permissions, external data processing, risky features, and store publication.

## 7.4 Token-efficient work practice
Do not run large autonomous rewrite loops. One ticket → focused context → smallest viable implementation → automated checks → manual proof → review → next ticket. Reserve demanding agent sessions for G0/G4 browser feasibility and security gates. Use recorded test artifacts rather than re-discovering completed decisions.

---

# 08. Release Checklist (Must be completed before submitting)

### Functionality
- [ ] FR-001 through FR-015 proven on Chrome stable with explicit evidence.
- [ ] Record, pause, resume, stop, preview, download and delete all work on fresh install.
- [ ] Actual quality and audio limitations documented. No unverified 4K/60 FPS claims.
- [ ] 30-minute sample and crash recovery proof attached.
- [ ] Multi-tab and meeting claims removed from public copy if G4 NO-GO.

### Security & Privacy
- [ ] Minimal permission manifest; each permission explained to reviewers/users.
- [ ] Security audit and supply-chain scan clean or approved remediation.
- [ ] No covert operation, unnecessary data collection or upload.
- [ ] Privacy policy accurate for the shipped code; user deletion tested.
- [ ] Recording notice and consent/legal reminder in relevant flows.

### Store submission
- [ ] Verified unique name/logo and no infringement on competitors.
- [ ] Listing description, screenshots, icon and version complete.
- [ ] Chrome Web Store privacy fields align with privacy policy and extension behavior.
- [ ] Support contact/channel, public privacy URL and release notes exist.
- [ ] Package reviewed, version tagged, artifacts checksummed and archived.
- [ ] Browser store approval status recorded; no approval assumed.

### Post-install QA
- [ ] Test extension installed from actual store listing after approval.
- [ ] Confirm permissions, start/stop, download and update path.
- [ ] Create rollback/hotfix process and user-facing known issues.

---

# 09. Risk Register & Decisions

| Risk | Likelihood / Impact | Mitigation / owner |
|---|---|---|
| Multi-tab permissions not feasible as desired | High / High | Prototype in phase 0/4; gated launch; architect |
| Browser capture loses tab audio | Medium / High | Audio monitor graph and regression; media engineer |
| 4K × multiple sources overwhelm laptop | High / High | Adaptive presets, benchmark, cap sources; QA |
| Browser crash leaves incomplete file | Medium / High | Chunk persistence/recovery; storage engineer |
| Chrome store rejection due to broad permissions | Medium / High | Minimum permissions and honest listing; release owner |
| Privacy harm or unnoticed recording | Medium / Critical | Explicit consent, visible indicator, immediate stop; security |
| External packages inject unsafe code | Medium / Critical | Lockfile, audits, CSP, peer review; security |
| Uncontrolled AI agent changes scope | High / Medium | One ticket per PR, explicit gate signoff; owner |

## Immediate next action
Start with **OCS-002** (capture API permission spike) and **OCS-003** (real local 1080p recording harness). Do not design full cloud infrastructure or promise synchronized multi-tab recording before these tests pass. Build P0 stable recorder, then decide on G4 experiments.

---

# 10. Sources, standards & maintenance
- Chrome `tabCapture` API: https://developer.chrome.com/docs/extensions/reference/api/tabCapture
- Chrome recording/offscreen guide: https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture
- Chrome Web Store program policies: https://developer.chrome.com/docs/webstore/program-policies/policies/
- Chrome Web Store disclosure requirements: https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements/
- MDN MediaRecorder: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder
- MDN getDisplayMedia: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia
- Chrome Extension Manifest V3: https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3

**Maintenance:** Verify API and store-policy details again before implementation and before release; Chrome versions/policies change. This specification describes target design, not completed implementation or audited security.
