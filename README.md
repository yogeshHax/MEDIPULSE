# MediPulse

**Integrated AI-Powered Cardiac Monitoring and Emergency-Response Platform**

MediPulse combines an AD8232 single-lead ECG sensor, an MPU-6050 motion sensor,
on-device sample relaying, a Flask inference API with a proven ECG classifier,
Realtime-database adapter, and a React glassmorphism dashboard with three
role-specific views, Realtime Database persistence, and an integrated alert
history. The system's mandate is clear: premium health-telemetry UX plus
lung-proof, production-ready data correctness — live waveforms only dance when
real measured samples exist, and demo state is always labelled.

![Architecture](docs/img/architecture.png)

---

## Workspace layout

```
MediPulse/
├── frontend/          React 18 SPA (Vite 5, TypeScript, Tailwind, Fiber-3D)
│   └── src/
│       ├── components/   HeartScene (3D heart), EcgMonitor, GlassCard...
│       ├── pages/        Login, patient/…, doctor/…
│       ├── lib/          signal gen (demo), bpm, alert rules, firebase, store
│       └── state/        NightShiftAppContext (auth, session, telemetry bus)
├── backend/           Flask API: preprocessing → classifier → risk → alerts
│   ├── app.py         /api               and  /api/ecg/predict
│   ├── ecg/           preprocess, classify, risk, alerts (RFC-79 §1-4)
│   └── tests/          pytest suite (test_predict.py)
├── docs/
│   ├── reference-recon.md       REA + Playwright evidence of the reference site
│   ├── architecture.md          schema, service boundaries, data flow
│   ├── firebase-setup.md        RTDB rules, auth flows, test procedure
│   ├── hardware-integration.md  AD8232 + MPU6050 wiring, sample formats, gotchas
│   └── recon-evidence/          REA reports, DOM snapshots, request logs
├── tooling/                  μResearch tooling (REA clone kept out of the app tree)
├── tests/              Playwright browser walkthroughs (not unit tests)
└── README.md
```

---

## Quick start

### Prerequisites

| Tool    | Version  | Check            |
| ------- | -------- | ---------------- |
| Node.js | ≥ 20     | `node --version` |
| npm     | ≥ 10     | `npm --version`  |
| Python  | ≥ 3.10   | `py -3 --version`|
| Git     | any      | `git --version`  |

### Frontend

```bash
cd frontend
npm install          # installs @react-three/fiber, recharts, firebase, ... (~1yr)
npm run dev          # Vite dev server on http://127.0.0.1:5173
```

When `VITE_FIREBASE_*` env vars are absent or stale, the app runs in
**demo mode** with an in-memory store clearly showing a `DEMO DATA` chip;
the code path is exactly the same as production except the storage backend.

### Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate   # .venv/bin/activate on mac/linux
pip install -r requirements.txt
python app.py            # Flask on http://127.0.0.1:5000
pytest                   # backend suite: 8 tests
```

The frontend calls the backend at `VITE_API_BASE` (default
`http://127.0.0.1:5000`). Set `CORS_ORIGINS` in the backend environment so
the browser can reach it (see `.env.example`).

---

## Firebase configuration

See [docs/firebase-setup.md](docs/firebase-setup.md) — this covers:
- The Realtime Database schema and where current vs. historical readings live.
- Security rules that bind each logged-in user to their `/users/<uid>` profile
  through a service-side `role` and `patientId` (or `uid<->userInfo` map).
- An integration checklist: authenticated profile-writes, subscription checks,
  doctor-variant permissions, and how to verify a failed write is surfacing
  visibly in the dashboard instead of a silent denial.

The regular `medipulse-me` demo dataset never touches Firebase — it lives in
`frontend/src/lib/firebase.ts#demoStore` and is replaced wholesale once a
real database hand-shakes.

---

## Hardware integration

See [docs/hardware-integration.md](docs/hardware-integration.md):
- **AD8232** analog wiring → ESP32 ADC → WebSocket/HTTP move → Firebase timing diagram.
- **MPU-6050** motion spike vs. genuine fall detection (validation window).
- The `window.hardware-telemetry` event contract the frontend listens for.

---

## Machine learning

| Piece            | Where                    | Notes                                                        |
| ---------------- | ------------------------ | ------------------------------------------------------------ |
| Preprocessing    | `backend/ecg/preprocess.py`     | Bandpass + derivative + windowing, sample-rate aware     |
| Inference        | `backend/ecg/classifier.py`     | Runs any `torch`/`sklearn` model when `MODEL_DIR` has one |
| Risk score       | `backend/ecg/risk.py`           | Deterministic 0–100 mapping (documented rules)            |
| Alerts           | `backend/ecg/alerts.py`         | Cooldown engine + rule evaluation, used by both ends      |

The endpoint `POST /api/ecg/predict` accepts a `{ samples, sampleRate, patientId, source }`
JSON payload and returns `{ modelClass, confidence, riskScore, conditionLevel, trend, features }`.
Predictions coming from the backend model are attributed; when no model artefact is
present the endpoint transparently runs `classify_heuristic` and labels the response
`model: "heuristic-v0"` — never having presented it as the trained model.

---

## Deployment

### Frontend (Netlify / Vercel — static SPA)

```bash
cd frontend && npm ci && npm run build
# Publish `frontend/dist/`, SPA routing rewrite needed:
#  /* → index.html   (200)
```

### Backend (Render / VPS)

```bash
cd backend
pip install -r requirements.txt
PORT=10000 gunicorn app:app --workers 2 --timeout 120
```

The backend is stateless besides the optional service-account JSON; point
`/health` monitoring at the free Render endpoint.

---

## Test suite

| Command                         | Scope                                        |
| ------------------------------- | -------------------------------------------- |
| `cd backend && pytest`           | 8 inference / risk / alert tests             |
| `cd frontend && npm test -- run` | Vitest scope (signal processing, bpm, rules) |
| `cd frontend && npm run build`   | Build + typecheck                            |
| Playwright walkthrough           | `node tooling/explore-ref3.mjs` (reference site); MediPulse flow TBD  |

Use the reference-recon doc's evidence table to see which findings were
actually observed in the running application, and which are improvements
over the reference's implementation.

---

## License and disclaimers

- All third-party assets (fonts via Google Fonts, the HeartScene 3D heart is an
  original procedural mesh) are used under standard terms.
- **Clinical disclaimer:** MediPulse is a monitoring/decision-support prototype.
  Its AI classification and risk score are **not** medical diagnoses. The
  reference training data and this implementation have NOT been certified as a
  medical device anywhere. Never make acute decisions solely on MediPulse output.
