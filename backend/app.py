"""MediPulse Flask API + ECG analysis prototype.

What this service owns (see docs/architecture.md §data ownership):
  * ECG feature extraction, prototype classification (N/L/R/A/V) and risk scoring.
  * The alert-rule + cooldown/escalation reference implementation.
  * A local SQLite mirror of readings, alerts and movement events for offline/dev use.

Cloud Firestore remains the web app's primary store for the patient/doctor ecosystem;
this API is the analysis + integration surface the browser calls for inference.

Endpoints (all under /api):
  GET  /api/health                    → liveness, version, model availability (open)
  POST /api/ecg/predict               → classify an ECG window, return risk + trend
  POST /api/readings                  → mirror a reading into SQLite
  GET  /api/readings/<patient_id>     → list mirrored readings
  POST /api/alerts/evaluate           → run rules + cooldown for one reading
  POST /api/alerts                    → store an alert (manual or automatic)
  GET  /api/alerts/<patient_id>       → list alerts
  POST /api/alerts/<alert_id>/ack     → acknowledge an alert
  POST /api/alerts/<alert_id>/resolve → resolve an alert
  POST /api/movement                  → store an MPU6050 movement/fall event
  GET  /api/movement/<patient_id>     → list movement events

Auth: when MEDIPULSE_API_KEY is set, every mutating endpoint (and the read
endpoints for patient data) requires `X-API-Key`. When it is unset the API runs in
local-development mode — which is why the CORS allow-list defaults to localhost.
"""
from __future__ import annotations

import logging
import os
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any

# Allow `py backend/app.py` from the repository root as well as `py app.py` inside backend/.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from flask import Flask, g, jsonify, request  # noqa: E402
from flask_cors import CORS  # noqa: E402

from ecg import classifier, risk  # noqa: E402
from ecg.alerts import CooldownEngine, evaluate_reading  # noqa: E402
from ecg.preprocess import extract_features  # noqa: E402

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("medipulse")

API_VERSION = "1.0.0"
MAX_SAMPLES = 60_000  # ~4 min at 250 Hz — bounds request cost
MIN_SAMPLES = 40

CLASS_NAMES = {
    "N": "Normal beat",
    "L": "Left bundle branch block",
    "R": "Right bundle branch block",
    "A": "Atrial premature beat",
    "V": "Premature ventricular contraction",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS readings (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  bpm REAL,
  model_class TEXT,
  confidence REAL,
  risk_score INTEGER,
  condition_level TEXT,
  trend TEXT,
  signal_quality TEXT,
  source TEXT
);
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  acked_by TEXT,
  acked_at INTEGER,
  resolved_at INTEGER,
  reading_id TEXT
);
CREATE TABLE IF NOT EXISTS movement_events (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  activity_level TEXT,
  magnitude REAL,
  gyro REAL,
  fall_suspected INTEGER NOT NULL DEFAULT 0,
  fall_confirmed INTEGER NOT NULL DEFAULT 0,
  source TEXT
);
CREATE INDEX IF NOT EXISTS readings_patient_ts ON readings(patient_id, timestamp);
CREATE INDEX IF NOT EXISTS alerts_patient_ts ON alerts(patient_id, timestamp);
CREATE INDEX IF NOT EXISTS movement_patient_ts ON movement_events(patient_id, timestamp);
"""


def db_path() -> Path:
    return Path(os.environ.get("MEDIPULSE_SQLITE_PATH", Path(__file__).parent / "medipulse.db"))


def api_key() -> str:
    return os.environ.get("MEDIPULSE_API_KEY", "").strip()


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = sqlite3.connect(db_path(), detect_types=0)
        g.db.row_factory = sqlite3.Row
    return g.db


def _authorized() -> bool:
    """Empty key = local development mode (documented); set key = shared-secret auth."""
    expected = api_key()
    if not expected:
        return True
    return request.headers.get("X-API-Key", "") == expected


def _guard():
    if not _authorized():
        return jsonify({"error": "unauthorized: send a valid X-API-Key header"}), 401
    return None


def _as_number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _as_bool(value: Any) -> bool:
    return bool(value) if isinstance(value, bool) else str(value).lower() in {"1", "true", "yes"}


def _alert_to_json(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "patientId": row["patient_id"],
        "kind": row["kind"],
        "message": row["message"],
        "timestamp": row["timestamp"],
        "status": row["status"],
        "ackedBy": row["acked_by"],
        "ackedAt": row["acked_at"],
        "resolvedAt": row["resolved_at"],
        "readingId": row["reading_id"],
    }


def create_app() -> Flask:
    app = Flask(__name__)
    origins = [o.strip() for o in os.environ.get(
        "MEDIPULSE_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",") if o.strip()]
    CORS(app, origins=origins, allow_headers=["Content-Type", "X-API-Key"])

    with sqlite3.connect(db_path()) as seed:
        seed.executescript(SCHEMA)

    cooldowns: dict[str, CooldownEngine] = {}
    streaks: dict[str, int] = {}

    @app.teardown_appcontext
    def close_db(_exc):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    # ---------------------------------------------------------------- health
    @app.get("/api/health")
    def health():
        model = classifier._try_load_model()
        return jsonify({
            "status": "ok",
            "version": API_VERSION,
            "model": "trained-model" if model else "heuristic-v0",
            "modelPath": os.environ.get("MEDIPULSE_MODEL_PATH", ""),
            "authRequired": bool(api_key()),
            "database": str(db_path()),
            "time": int(time.time() * 1000),
        })

    # --------------------------------------------------------------- predict
    @app.post("/api/ecg/predict")
    def predict():
        denied = _guard()
        if denied:
            return denied
        body = request.get_json(force=True, silent=True) or {}
        samples = body.get("ecgSamples")
        if not isinstance(samples, list) or not samples:
            return jsonify({"error": "ecgSamples must be a non-empty array of millivolt values"}), 400
        if len(samples) > MAX_SAMPLES:
            return jsonify({"error": f"ecgSamples exceeds the {MAX_SAMPLES}-sample limit"}), 413
        if len(samples) < MIN_SAMPLES:
            return jsonify({"error": f"ecgSamples needs at least {MIN_SAMPLES} samples"}), 400
        clean: list[float] = []
        for v in samples:
            n = _as_number(v)
            if n is None:
                return jsonify({"error": "ecgSamples must contain only numbers"}), 400
            if abs(n) > 20:
                return jsonify({"error": "ecgSamples values must be millivolts (|v| <= 20)"}), 400
            clean.append(n)
        sampling_rate = _as_number(body.get("samplingRate") or 250)
        if sampling_rate is None or not (50 <= sampling_rate <= 2000):
            return jsonify({"error": "samplingRate must be a number between 50 and 2000 Hz"}), 400

        try:
            features = extract_features(clean, sampling_rate)
            if features is None or features.get("features") is None:
                return jsonify({
                    "error": "not enough usable signal for a classification",
                    "detail": "provide at least ~2 s of samples with detectable QRS complexes",
                    "beats": (features or {}).get("beats", 0),
                }), 422
            cls_byte, confidence, model_name = classifier.classify(clean, sampling_rate, features)
            patient_id = str((body.get("context") or {}).get("patientId") or "anonymous")
            bpm = features.get("features", {}).get("bpm_mean")
            streak = streaks.get(patient_id, 0) + 1 if cls_byte != "N" else 0
            streaks[patient_id] = streak
            score = risk.risk_score(cls_byte, confidence, bpm, streak)
            prev_risks = [row["risk_score"] for row in get_db().execute(
                "SELECT risk_score FROM readings WHERE patient_id=? ORDER BY timestamp DESC LIMIT 5",
                (patient_id,),
            )]
            return jsonify({
                "modelClass": cls_byte,
                "className": CLASS_NAMES[cls_byte],
                "confidence": round(confidence, 3),
                "riskScore": score,
                "conditionLevel": risk.condition_level(score),
                "trend": risk.trend_from_history(score, prev_risks),
                "bpm": round(bpm, 1) if bpm is not None else None,
                "model": model_name,
                "experimental": True,
            })
        except ValueError as exc:
            return jsonify({"error": f"invalid ECG input: {exc}"}), 400
        except Exception as exc:  # noqa: BLE001 — surface predictable failure, never fake a result
            log.exception("predict failed")
            return jsonify({"error": f"prediction failed: {exc}"}), 500

    # -------------------------------------------------------------- readings
    @app.post("/api/readings")
    def post_reading():
        denied = _guard()
        if denied:
            return denied
        body = request.get_json(force=True, silent=True) or {}
        patient_id = body.get("patientId")
        if not isinstance(patient_id, str) or not patient_id.strip():
            return jsonify({"error": "patientId is required"}), 400
        rid = body.get("id") or f"rd_{int(time.time() * 1000):x}"
        bpm = _as_number(body.get("bpm"))
        if bpm is not None and not (10 <= bpm <= 400):
            return jsonify({"error": "bpm must be between 10 and 400 (omit it when unknown)"}), 400
        db = get_db()
        db.execute(
            "INSERT OR REPLACE INTO readings (id, patient_id, timestamp, bpm, model_class, confidence,"
            " risk_score, condition_level, trend, signal_quality, source)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                rid, patient_id.strip(), int(_as_number(body.get("timestamp")) or time.time() * 1000),
                bpm, body.get("modelClass"), _as_number(body.get("confidence")),
                _as_number(body.get("riskScore")), body.get("conditionLevel"), body.get("trend"),
                body.get("signalQuality"), body.get("source") or "bridge",
            ),
        )
        db.commit()
        return jsonify({"id": rid}), 201

    @app.get("/api/readings/<patient_id>")
    def get_readings(patient_id):
        denied = _guard()
        if denied:
            return denied
        try:
            max_rows = max(1, min(1000, int(request.args.get("max", 200))))
        except ValueError:
            return jsonify({"error": "max must be an integer"}), 400
        rows = get_db().execute(
            "SELECT * FROM readings WHERE patient_id=? ORDER BY timestamp DESC LIMIT ?",
            (patient_id, max_rows),
        ).fetchall()
        out = []
        for r in rows:
            out.append({
                "id": r["id"],
                "patientId": r["patient_id"],
                "timestamp": r["timestamp"],
                "bpm": r["bpm"],
                "modelClass": r["model_class"],
                "confidence": r["confidence"],
                "riskScore": r["risk_score"],
                "conditionLevel": r["condition_level"],
                "trend": r["trend"],
                "signalQuality": r["signal_quality"],
                "source": r["source"],
            })
        return jsonify(out)

    # ---------------------------------------------------------------- alerts
    @app.post("/api/alerts/evaluate")
    def evaluate():
        denied = _guard()
        if denied:
            return denied
        body = request.get_json(force=True, silent=True) or {}
        reading = body.get("reading") or {}
        if not isinstance(reading, dict):
            return jsonify({"error": "reading must be an object"}), 400
        patient_id = reading.get("patientId") or body.get("patientId")
        if not patient_id:
            return jsonify({"error": "patientId is required"}), 400
        prev_streak = streaks.get(patient_id, 0)
        candidates = evaluate_reading(reading, prev_streak)
        engine = cooldowns.setdefault(patient_id, CooldownEngine())
        emitted = engine.filter(candidates, int(time.time() * 1000))
        return jsonify({
            "alerts": [{"kind": c.kind, "message": c.message, "readingId": c.reading_id} for c in emitted],
            "suppressed": len(candidates) - len(emitted),
        })

    @app.post("/api/alerts")
    def post_alert():
        denied = _guard()
        if denied:
            return denied
        body = request.get_json(force=True, silent=True) or {}
        patient_id = body.get("patientId")
        if not isinstance(patient_id, str) or not patient_id.strip():
            return jsonify({"error": "patientId is required"}), 400
        aid = body.get("id") or f"al_{int(time.time() * 1000):x}"
        db = get_db()
        db.execute(
            "INSERT OR REPLACE INTO alerts (id, patient_id, kind, message, timestamp, status, reading_id)"
            " VALUES (?,?,?,?,?,?,?)",
            (
                aid, patient_id.strip(), body.get("kind") or "manual-emergency",
                body.get("message") or "", int(_as_number(body.get("timestamp")) or time.time() * 1000),
                body.get("status") or "created", body.get("readingId"),
            ),
        )
        db.commit()
        return jsonify({"id": aid}), 201

    @app.get("/api/alerts/<patient_id>")
    def get_alerts(patient_id):
        denied = _guard()
        if denied:
            return denied
        rows = get_db().execute(
            "SELECT * FROM alerts WHERE patient_id=? ORDER BY timestamp DESC LIMIT 200", (patient_id,)
        ).fetchall()
        return jsonify([_alert_to_json(r) for r in rows])

    def _set_alert_status(alert_id: str, status: str, actor: str | None):
        db = get_db()
        now = int(time.time() * 1000)
        if status == "acknowledged":
            db.execute("UPDATE alerts SET status=?, acked_by=?, acked_at=? WHERE id=?",
                       (status, actor, now, alert_id))
        else:
            db.execute("UPDATE alerts SET status=?, resolved_at=? WHERE id=?", (status, now, alert_id))
        db.commit()
        row = db.execute("SELECT * FROM alerts WHERE id=?", (alert_id,)).fetchone()
        if row is None:
            return jsonify({"error": f"alert {alert_id} not found"}), 404
        return jsonify(_alert_to_json(row))

    @app.post("/api/alerts/<alert_id>/ack")
    def ack_alert(alert_id):
        denied = _guard()
        if denied:
            return denied
        body = request.get_json(force=True, silent=True) or {}
        return _set_alert_status(alert_id, "acknowledged", body.get("ackedBy"))

    @app.post("/api/alerts/<alert_id>/resolve")
    def resolve_alert(alert_id):
        denied = _guard()
        if denied:
            return denied
        return _set_alert_status(alert_id, "resolved", None)

    # -------------------------------------------------------------- movement
    @app.post("/api/movement")
    def post_movement():
        denied = _guard()
        if denied:
            return denied
        body = request.get_json(force=True, silent=True) or {}
        patient_id = body.get("patientId")
        if not isinstance(patient_id, str) or not patient_id.strip():
            return jsonify({"error": "patientId is required"}), 400
        mid = body.get("id") or f"mv_{int(time.time() * 1000):x}"
        magnitude = _as_number(body.get("magnitude"))
        if magnitude is not None and not (0 <= magnitude <= 40):
            return jsonify({"error": "magnitude must be in g between 0 and 40"}), 400
        db = get_db()
        db.execute(
            "INSERT OR REPLACE INTO movement_events"
            " (id, patient_id, timestamp, activity_level, magnitude, gyro, fall_suspected, fall_confirmed, source)"
            " VALUES (?,?,?,?,?,?,?,?,?)",
            (
                mid, patient_id.strip(), int(_as_number(body.get("timestamp")) or time.time() * 1000),
                body.get("activityLevel"), magnitude, _as_number(body.get("gyro")),
                1 if _as_bool(body.get("fallSuspected")) else 0,
                1 if _as_bool(body.get("fallConfirmed")) else 0,
                body.get("source") or "bridge",
            ),
        )
        db.commit()
        return jsonify({"id": mid}), 201

    @app.get("/api/movement/<patient_id>")
    def get_movement(patient_id):
        denied = _guard()
        if denied:
            return denied
        rows = get_db().execute(
            "SELECT * FROM movement_events WHERE patient_id=? ORDER BY timestamp DESC LIMIT 200",
            (patient_id,),
        ).fetchall()
        return jsonify([
            {
                "id": r["id"],
                "patientId": r["patient_id"],
                "timestamp": r["timestamp"],
                "activityLevel": r["activity_level"],
                "magnitude": r["magnitude"],
                "gyro": r["gyro"],
                "fallSuspected": bool(r["fall_suspected"]),
                "fallConfirmed": bool(r["fall_confirmed"]),
                "source": r["source"],
            }
            for r in rows
        ])

    @app.errorhandler(404)
    def not_found(_e):
        return jsonify({"error": "not found", "hint": "see docs/api.md for the endpoint list"}), 404

    @app.errorhandler(405)
    def bad_method(_e):
        return jsonify({"error": "method not allowed"}), 405

    return app


app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5055))
    host = os.environ.get("MEDIPULSE_HOST", "127.0.0.1")
    log.info("MediPulse API listening on http://%s:%s (auth required: %s)", host, port, bool(api_key()))
    app.run(host=host, port=port)
