"""Heartbeat classification (N / L / R / A / V) — prototype implementation.

IMPORTANT HONESTY NOTE
----------------------
This classifier is a heuristic prototype that stands in until the project's
trained model is supplied. When the environment variable MEDIPULSE_MODEL_PATH
points to a joblib-pickle that implements `.predict_proba(ecg窗口)` /
`predict(...)`, it is loaded and used instead of the heuristic. The heuristic is
NOT a clinically validated model and every response says so (`"model": "heuristic-v0"`).

The five class labels follow the MIT-BIH-style convention:
  N = Normal beat
  L = Left bundle branch block beat
  R = Right bundle branch block beat
  A = Atrial premature beat
  V = Premature ventricular contraction
"""
import os
import numpy as np

_MODEL = None
_MODEL_PATH = os.environ.get("MEDIPULSE_MODEL_PATH", "")


def _try_load_model():
    global _MODEL
    if _MODEL or not _MODEL_PATH:
        return _MODEL
    try:
        import joblib
        _MODEL = joblib.load(_MODEL_PATH)
        import logging
        logging.getLogger("medipulse").info("Loaded model from %s", _MODEL_PATH)
    except Exception as exc:  # model present but broken — surface as "heuristic + warning"
        import logging
        logging.getLogger("medipulse").warning("MEDIPULSE_MODEL_PATH set but unloadable: %s", exc)
        _MODEL = None
    return _MODEL


def classify_with_model(samples, sampling_rate, features):
    model = _try_load_model()
    if model is None or not features:
        return None
    try:
        import numpy as _np
        window = _np.asarray(samples, dtype=float)[-int(sampling_rate * 4):]
        if hasattr(model, "predict_proba"):
            proba = _np.asarray(model.predict_proba(window.reshape(1, -1))[0])
            idx = int(proba.argmax())
            classes = list(getattr(model, "classes_", ["N", "L", "R", "A", "V"]))
            return str(classes[idx]), float(proba[idx]), "trained-model"
    except Exception:
        return None
    return None


def heuristic_features_vector(features):
    f = features.get("features") or {}
    beats = features.get("beats", 0)
    bpm = f.get("bpm_mean") or 0
    hrv = f.get("hrv_rmssd") or 0
    qrs = f.get("qrs_width_ms") or 0
    return np.array([
        min(beats, 30) / 30.0,
        min(bpm, 180) / 180.0,
        min(hrv, 200) / 200.0,
        min(qrs, 200) / 200.0,
        f.get("rr_count", 0) / max(1, beats),
    ])


def classify_heuristic(samples, sampling_rate, features):
    """Prototype heuristic — waveform statistics mapped onto class probabilities.

    Broad-rhythm priors with documented limits; widened QRS emphasises L/R, high
    HRV + short RR emphasises A (atrial premature), wide QR amplitude swings
    lean V, everything else stays N. These are educational priors for the demo
    pipeline, not medical thresholds.
    """
    f = features.get("features") or {}
    beats = features.get("beats", 0)
    bpm = f.get("bpm_mean") or 0
    hrv = f.get("hrv_rmssd") or 0
    qrs = f.get("qrs_width_ms") or 0
    x = np.asarray(samples, dtype=float)
    amplitude = float(x.max() - x.min()) if x.size else 0.0

    p_N, p_L, p_R, p_A, p_V = 0.6, 0.08, 0.08, 0.12, 0.12
    if qrs > 110:
        p_L += 0.25
        p_R += 0.22
        p_N -= 0.4
    if bpm >= 105:
        p_A += 0.18
        p_N -= 0.15
    if hrv > 60:
        p_A += 0.15
        p_V += 0.12
        p_N -= 0.22
    if amplitude >= 2.2:
        p_V += 0.15
        p_N -= 0.1
    if beats < 4:
        p_N = 0.5  # not enough evidence — stay near "normal" with low separation
    probs = np.clip(np.array([p_N, p_L, p_R, p_A, p_V]), 0.02, None)
    probs = probs / probs.sum()
    idx = int(probs.argmax())
    labels = ["N", "L", "R", "A", "V"]
    return labels[idx], float(probs[idx]), "heuristic-v0"


def classify(samples_or, sampling_rate, features):
    """Unified entry: prefers the trained model, else heuristic."""
    result = classify_with_model(samples_or, sampling_rate, features)
    if result is None:
        return classify_heuristic(samples_or, sampling_rate, features)
    return result
