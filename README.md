# Capdio — Screen Recorder

<p align="center">
  <strong>Capture everything. Miss nothing.</strong>
</p>

<p align="center">
  <a href="https://github.com/TanjilHasan-Himel/Capdio/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/manifest-MV3-brightgreen.svg" alt="Chrome MV3">
  <img src="https://img.shields.io/badge/gate%20G0-PASSED-success.svg" alt="Gate G0 Passed">
  <img src="https://img.shields.io/badge/privacy-100%25%20local-orange.svg" alt="Privacy: 100% Local">
</p>

---

## 💡 About Capdio

**Capdio** is a privacy-first screen recording workspace built for capturing, managing, and editing high-quality recordings—right from your browser.

Designed for developers, creators, educators, and teams, Capdio delivers studio-grade screen, window, and tab captures up to **4K at 60 FPS** with crystal-clear audio mixing, while guaranteeing that your recordings, browsing data, and microphone streams never leave your machine.

---

## ⚡ Core Capabilities

- **🎥 Ultra HD Recording (Up to 4K 60 FPS):** Capture browser tabs, application windows, or entire displays with crisp visual fidelity using hardware-accelerated VP9, VP8, and H.264 codecs.
- **🎙️ Pro Dual-Audio Mixing:**
  - **Tab Audio Monitoring:** Preserves page audio in your headphones while recording—no accidental tab muting.
  - **Hardware Microphone Integration:** Real-time hardware mic array mixing with acoustic noise suppression and echo cancellation.
  - **Zero Feedback Loop:** Dedicated Web Audio graph isolates microphone input from playback speakers.
- **🔒 True Privacy-First Architecture:**
  - **Zero Broad Host Permissions:** Runs without `<all_urls>` or invasive DOM access.
  - **Offline-First & Zero Telemetry:** No tracking, no external network calls, no telemetry, and no mandatory cloud accounts.
  - **Origin-Isolated Storage:** Chunks and manifests persist locally via OPFS (Origin Private File System) and IndexedDB.
- **📑 Multi-Tab & Video Meeting Track (Experimental):** Roadmap for dual-tab synchronized captures designed for Google Meet, Microsoft Teams, and Zoom Web.
- **✂️ In-Browser Workspace (Capdio Studio):** Instant playback, lossless trim/cut, and direct local WebM/MP4 export.

---

## 📊 Phase 0 Feasibility & Benchmark Verification (Gate G0: PASSED)

Capdio has undergone rigorous empirical validation across all Chrome capture APIs:

| Benchmark / Validation | Target | Measured Empirical Result | Status |
| :--- | :--- | :--- | :--- |
| **API Feasibility Spike (`OCS-002`)** | 1080p/30 Tab Capture | 1920x1080 @ 30fps, valid EBML WebM header | ✅ **PASSED** |
| **60-Second Full Benchmark (`OCS-003`)** | 1080p + Tab + Mic | 20.1 MB output, 2.68 Mbps bitrate, flat 58MB RSS | ✅ **PASSED** |
| **Permission Audit (`OCS-004`)** | Zero `<all_urls>` | 100% least privilege (`tabCapture`, `offscreen`, `activeTab`, `storage`) | ✅ **PASSED** |
| **Trust Boundary Enforcement** | Web Origin Isolation | External page message attacks blocked at browser level | ✅ **PASSED** |

Detailed reports and architectural decisions:
- [Gate G0 Formal Sign-Off Record](docs/G0_SIGNOFF.md)
- [Security & Privacy Architecture Review](docs/SECURITY_ARCHITECTURE_REVIEW.md)
- [60-Second 1080p Benchmark Report](docs/BENCHMARK_OCS-003.md)
- [ADR-001: Capture APIs & Offscreen Architecture](docs/ADR/ADR-001-capture-apis-spike.md)

---

## 🛠️ Project Structure

```text
Capdio/
├── apps/
│   └── extension/          # Production MV3 extension (Vite + TypeScript + React)
├── docs/                   # Architectural specifications, PRD, TDR & ADRs
│   ├── MASTER_SPEC.md      # Master engineering specification
│   ├── SECURITY_ARCHITECTURE_REVIEW.md
│   ├── G0_SIGNOFF.md
│   └── BENCHMARK_OCS-003.md
├── test-harness/           # Automated verification test suites & fixture servers
│   ├── extension/          # Verified MV3 test harness extension
│   ├── test-security-boundaries.js
│   ├── test-action-click.js
│   └── test-60s-harness.js
├── recordings/             # Local test recording output artifacts (git-ignored)
├── LICENSE                 # MIT License
└── package.json
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v20+ recommended)
- Google Chrome or Chrome for Testing

### Installation
```bash
# Clone the repository
git clone https://github.com/TanjilHasan-Himel/Capdio.git
cd Capdio

# Install dependencies
npm install
```

### Running Automated Verification Suites
```bash
# 1. Run security boundaries and permission audit
npm run test:security

# 2. Run capture feasibility spike harness
npm run spike:ocs-002

# 3. Run 60-second 1080p A/V benchmark
npm run benchmark:ocs-003
```

### Loading in Google Chrome
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (toggle in top-right corner).
3. Click **Load unpacked** and select `test-harness/extension` (or `apps/extension/dist` once built).
4. Click the Capdio extension action icon to record the active tab.

---

## 🗺️ Roadmap & Delivery Phases

- **Phase 0 — Discovery & Feasibility (Gate G0):** Completed & Passed ✅
- **Phase 1 — Stable Capture Core (Gate G1):** Production MV3 skeleton, state machine, start/pause/stop UI, and error propagation (In Progress 🔄)
- **Phase 2 — Persistent Storage & Reliability (Gate G2):** OPFS chunk persistence, quota monitoring, crash recovery
- **Phase 3 — Quality, Editor & Usability (Gate G3):** Resolution presets (720p/1080p/4K), audio meters, in/out trim editor
- **Phase 4 — Multi-Tab Experimental Track (Gate G4):** Dual-tab synchronized recording for conference calls
- **Phase 5 — Chrome Web Store Hardening (Gate G5):** Automated QA matrix, store assets, publication
- **Phase 6 — Capdio Studio Ecosystem:** Advanced canvas composition, cursor highlighting, picture-in-picture

---

## 📄 License & Attribution

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for details.

Developed with ❤️ by **[Tanjil Hasan](https://github.com/TanjilHasan-Himel)**.

