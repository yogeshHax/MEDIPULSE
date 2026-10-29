# Reference Website Recon — MediPulse (`strong-lokum-bfb6dc.netlify.app`)

**Analyst:** Buffy (Codebuff/Freebuff) · **Date:** 2026-10-26
**Tools used:** **REA v6.7.0** (`rea-agents` from the official repo `github.com/morluto/rea`) attached to a dedicated Chrome 156 profile over CDP (`--remote-debugging-port=9222`), plus a documented **fallback walkthrough** with Playwright 1.64.1 (headless Chromium) for the interactive states (clicks, form entry, role switching, viewport changes) because REA is a *passive* CDP observer and cannot drive clicks.

Evidence artifacts live in [`docs/recon-evidence/`](recon-evidence/):

| Artifact | What it is |
| --- | --- |
| `inspect-desktop.json` | REA `inspect-web-page` capture (DOM node inventory, scripts, resources, network/console/storage) |
| `bundle-analysis.err` | REA `analyze-web-bundle` attempt — OOM'd on the 1.38 MB bundle (heap limit); static analysis done on the downloaded bundle instead |
| `ref-bundle.js` (1.38 MB), `ref-bundle.css`, `ref-index.html` | Downloaded site assets used for static analysis |
| `01–08-*.png`, `*-10/11-*.png` | Playwright screenshots: landing, login, patient hub, mobile viewport |
| `*-live.txt`, `*-controls.json`, `09-console-all.log`, `*-requests.log` | Page text dumps, control inventories, console + network logs |

---

## 1. Observed pages and views (directly observed unless noted)

### 1.1 Landing (`/`)
- Full-screen dark hero. Wordmark `MEDIPULSE` with a two-tone treatment (`MEDI` + accent `PULSE`).
- Subheadline (all caps): `PROFESSIONAL IOT CLINICAL BRIDGE.` / `HARDWARE-TO-DOCTOR REALTIME TELEMETRY.`
- Two actions: `INITIALIZE PORTAL` and `CLINICAL WHITEPAPER`. `INITIALIZE PORTAL` navigates to the login state (verified by clicking it).
- Page title: `MediPulse - Professional Clinical IoT`.

### 1.2 Login state (in-app view, no separate URL — SPA state)
- Heading `LOGIN` / `SECURE CLINICAL HANDSHAKE`.
- Form: `Legal Full Name` (text), `Verified Email` (email), role `<select>` with options **Patient Access** and **Medical Officer Command**, submit button `LAUNCH HUB`.
- Note `CLOUD ENCRYPTED SESSION`.
- **No password field** — identity is name + email + role. Submitting creates or looks up a session (observed: a brand-new name/email pair succeeded and created a hub for that identity). This is demo-grade "authentication", not real auth (inferred from code, confirmed by behaviour).

### 1.3 Patient hub (SPA view)
Observed after generic login (the role badge rendered `DOCTOR` even for the patient account we created — the badge reflects the login choice):

- Header: `MEDIPULSE`, user name, role chip, `CLINICAL SYNC ACTIVE` status, `SIGNAL LOST` chip.
- Hardware status block: `ESP32-LINK V1.0`, `HARDWARE DISCONNECTED`.
- Section titled `MEDICAL COMMANDER` with identity card (`name`, sanitized id `E_ROSSI_MEDIPULSE_IO`, `HASH: 0X89E080BB74…`), actions `EDIT PROFILE`, `EHR EXPORT`, `DATA EXPORT`.
- Navigation sections: `SURVEILLANCE`, `FLEET HUB`, `VERIFIED ID`, `PHARMACOLOGY`, `CRITICAL LOG`, `TELEMETRY STREAM`.
- Footer: `© 2024 CLINICAL MONITORING SYSTEMS • REAL-TIME SURVEILLANCE OS V4.2`.
- A doctor-role login is routed through a **hardware calibration → network provisioning wizard** first (`HARDWARE CALIBRATION`, `NETWORK PROVISIONING`, `ESTABLISH HARDWARE LINK`; the wizard asks for Wi-Fi SSID/passphrase — "WiFi Handshake Refused" error on bad credentials).

### 1.4 Views NOT observed
- Live telemetry with an actual device connected (no AD8232/ESP32 hardware was attached).
- The supervised/AI panels' populated states (the Gemini clinical chat uses `gemini-3.1-pro-preview` with an **empty API key** — it can only fail).
- Deeper sections behind the wizard (doctor fleet views) — blocked until hardware provisioning is completed, which we deliberately did not falsify.

## 2. Technology stack (directly observed from assets/network)

| Layer | Finding |
| --- | --- |
| Build | **Vite SPA**, single entry (react `index-C_0LxMl7.js`, 1.38 MB minified; no code splitting, no router library detected — views are internal state) |
| Styling | **Tailwind CSS via `cdn.tailwindcss.com`** (console warning observed; explains the 814-byte shipped CSS), dark `slate` palette, very large radii (`rounded-[2.5rem]`), all-caps micro-labels |
| Font | **Plus Jakarta Sans** (Google Fonts weights 300–800) |
| Icons/Charts | lucide icons, recharts (`AreaChart`, `ComposedChart`), canvas-based ECG sweep |
| Backend | **Firebase Realtime Database** — project `medipulse-af4fa`, `databaseURL: https://medipulse-af4fa-default-rtdb.firebaseio.com`, plus Analytics (`G-VLJ6LZJQYV`) |
| Crypto | **crypto-js AES** over payload objects |
| AI | Google GenAI SDK call for clinical chat (`gemini-3.1-pro-preview`), **apiKey empty → broken in production** |
| Licensing | A gated library throws `Uncaught (in promise) Error: License expired` on every load (observed in console all sessions) |

## 3. Reverse-engineered data layer (strong evidence from the bundle + Firebase console warnings)

- **Encryption**: payload objects are serialized and AES-encrypted with the **patient id (or a fallback secret `MediPulse_Clinical_Secret_v2_918237`) as the key**. This is secrecy theatre (the key ships with the app), not real security.
- **`users/${id}`** (id = sanitized email, e.g. `E_ROSSI_MEDIPULSE_IO`): profile with `encryptedMedicalProfile` (chronic conditions, medications) and `encryptedEmergencyContact`.
- **`health_logs/${patientId}`**: push records `{ id, patientId, timestamp, encryptedPayload: AES({temp, bpm, steps, fall, arrhythmiaDetected, ecgData, location}) }`. Reader sorts by timestamp, keeps **last 100**.
- **`notifications/${userId}`**: list, ordered by `timestamp`, last 50; mark-as-read writes `…/read: true`. Firebase warned about a missing `.indexOn: "timestamp"`.
- **`data`** (root node): a generic subscribe target — hardware bridge channel.
- **Alert rules (in code)**: `arrhythmiaDetected = bpm > 120 || bpm < 50` for storage; UI alert chips `bpm > 100 || bpm < 50`, `temp > 38`, `fall`. On a fall, a **fabricated location** is randomized near 34.0522, −118.2437 (Portland/LA coords) — fake hardware data pattern.
- **Live ink from BPM**: the ECG canvas generates synthetic sweeps from `bpm` (step rate ~bpm/30) with random noise "when arrhythmia" — a **simulated waveform**, not real samples.
- **Hardware bridge**: the app listens for a window CustomEvent **`hardware-telemetry`** with `{ bpm, temp, steps, fall, … }` — i.e. sensors are expected to feed the tab through a companion process/extension, not the browser itself. A control channel (`pLPCommand`) exists for device commands with a handler for unknown commands.
- **Demo identities**: `e.rossi@medipulse.io`, `s.foster@medipulse.io`.

## 4. Design tokens / visual patterns observed

- Near-black background, dark slate surfaces, one accent colour, glowing status chips.
- **All-caps, letter-spaced micro-labels** (`CLINICAL SYNC ACTIVE`, `SIGNAL LOST`).
- Very large border radii, generous padding; monospace-ish identity hash line.
- Status-driven color coding: green "active", red "SIGNAL LOST"/critical red glow (`shadow-[0_0_50px_rgba(239,68,68,0.2)]`).
- Typography hierarchy via extreme weight contrast (Plus Jakarta Sans 300 vs 800).

## 5. Interactive behaviour reproduced

- Landing → login navigation (click).
- Login with new identity → hub created (writes user profile).
- Hardware-disconnected states render; two-second-ish churn of status chips inferred from code timers (`Date.now()-last>5s ⇒ p(!1)` staleness flip).
- Role select changes post-login landing flow (patient → hub; doctor → hardware wizard).

## 6. Limitations / what could not be inspected

1. **REA bundle analysis OOM'd** on the 1.38 MB single bundle (documented in `bundle-analysis.err`); static bundle analysis was performed on the downloaded file instead.
2. No live device → no real ECG/vitals observations; all live-ink behaviour is code-derived (inference flagged above).
3. Gemini chat, EHR export, pharmacology and fleet sections were not exercised (missing model key/hardware, demo database, and wizard gating respectively).
4. The site's own Firebase RTDB `medipulse-af4fa` is public; we limited ourselves to the session the app itself created and did not scrape other users' records.
5. The `License expired` exception breaks parts of the runtime; some states could not be reached.

## 7. Directly observed vs inferred

- **Observed**: everything in §1–§2 and console/network evidence; Firebase paths/rules from bundle code + RTDB warnings.
- **Inferred**: staleness timers, ECG simulation from BPM, location fabrication on falls, notification lifecycle details, "auth" being demo-grade.
- **Unknown**: any server-side components (none detected — it is a pure SPA + Firebase), the original landing "3D" visuals (none present in the DOM beyond CSS effects; the uploaded design references are the user's, not this site's).

## 8. What MediPulse (our build) takes from this

Keep: the medical-device sincerity of the copy and status system, RTDB-style real-time push with patient-scoped trees, per-reading persisted records, alert chips driven by *code-visible thresholds*, ESP32 bridge concept (properly documented), export workflows, role split.
Fix/improve (the reference's weaknesses): no password authentication, AES-with-user-id pseudo-encryption, fabricated vitals/locations from UI, simulated waveform from BPM, no main processing backend, no model, empty Gemini key, no responsive polish — these all fail the task's honesty requirements. Our build implements them properly (real waveform data path, labelled demo mode, Firebase per supplied project `medipulse-48c9a`, real/absent states).
