# Contributing to Capdio

Thank you for contributing to Capdio!

## Development Principles
1. **Local-First & Privacy-Focused:** Capdio performs capture and processing locally on the user's machine. Zero external network telemetry or silent uploads.
2. **Minimal Permissions:** Never expand manifest permissions without an approved Architectural Decision Record (ADR) and explicit security review. Broad permissions like `<all_urls>` or `tabs` are strictly prohibited.
3. **Empirical Verification:** Every pull request and ticket must be accompanied by empirical test evidence. Do not claim tests ran if they did not.
4. **Single-Ticket Protocol:** Follow `docs/AGENT_PROTOCOL.md`. Deliver small, focused diffs with automated checks.

## Development Setup
```bash
# Clone the repository
git clone https://github.com/TanjilHasan-Himel/Capdio.git
cd Capdio

# Install dependencies
npm install

# Run automated security boundary audit
npm run test:security

# Run capture feasibility spike harness
npm run spike:ocs-002

# Run 60-second 1080p benchmark
npm run benchmark:ocs-003
```


