# OpenCapture Studio — SECURITY

> Companion module to MASTER_SPEC.md. Master specification takes precedence.

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

