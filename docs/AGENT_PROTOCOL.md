# OpenCapture Studio — AGENT PROTOCOL

> Companion module to MASTER_SPEC.md. Master specification takes precedence.

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

