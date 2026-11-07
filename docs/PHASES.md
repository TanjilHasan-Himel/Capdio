# OpenCapture Studio — PHASES

> Companion module to MASTER_SPEC.md. Master specification takes precedence.

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

