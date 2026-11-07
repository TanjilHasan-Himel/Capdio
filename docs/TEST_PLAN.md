# OpenCapture Studio — TEST PLAN

> Companion module to MASTER_SPEC.md. Master specification takes precedence.

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

