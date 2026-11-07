# OpenCapture Studio — PRD

> Companion module to MASTER_SPEC.md. Master specification takes precedence.

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

