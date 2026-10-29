"""Backend tests for prediction + preprocessing."""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import numpy as np
import pytest

from ecg.preprocess import extract_features
from ecg import risk
from ecg.alerts import CooldownEngine, evaluate_reading, AlertCandidate


def synthesize(bpm, seconds=8, rate=250, pvc=False):
    rng = np.random.default_rng(42)
    n = int(seconds * rate)
    x = np.zeros(n)
    pos = 50.0
    for i in range(int(bpm * seconds)):
        pos += 60 / bpm * rate * (1 + 0.02 * (rng.random() - 0.5))
        idx = int(pos)
        if idx >= n:
            break
        wide = 8 if (pvc and i % 6 == 5) else 4
        amp = 1.0 if (pvc and i % 6 == 5) else 1.2
        sign = -1.0 if (pvc and i % 6 == 5) else 1.0
        x[idx:idx + 24] += sign * amp * np.exp(-0.5 * ((np.arange(-2, 22) / wide) ** 2))[:24]
        x[idx:idx + 24] += 0.2 * np.exp(-0.5 * ((np.arange(-2, 22) / 18) ** 2))[:24]
    x += 0.04 * rng.standard_normal(n)
    return x


def test_extract_features_detects_beats():
    rate = 250
    x = synthesize(72, 8, rate)
    feats = extract_features(x.tolist(), rate)
    assert feats["beats"] >= 6
    assert feats["features"]["bpm_mean"] is not None
    assert 55 <= feats["features"]["bpm_mean"] <= 95


def test_extract_features_short_input():
    assert extract_features([0, 1, 2], 250) is None or extract_features([0, 1, 2], 250)["features"] is None


def test_heuristic_returns_valid_label():
    from ecg.classifier import classify_heuristic
    rate = 250
    x = synthesize(75, 10, rate)
    feats = extract_features(x.tolist(), rate)
    label, conf, model = classify_heuristic(x.tolist(), rate, feats)
    assert label in {"N", "L", "R", "A", "V"}
    assert 0 <= conf <= 1
    assert model == "heuristic-v0"


def test_risk_score_bands():
    assert risk.risk_score("N", 0.9, 75, 0) == 0
    assert 0 < risk.risk_score("V", 0.9, 75, 0) <= 100
    assert risk.condition_level(90) == "high"
    assert risk.condition_level(50) == "moderate"
    assert risk.condition_level(5) == "low"


def test_trend_directions():
    assert risk.trend_from_history(80, [10, 12]) == "worsening"
    assert risk.trend_from_history(5, [70, 65]) == "improving"
    assert risk.trend_from_history(50, [52, 48]) == "stable"


def test_alert_bradycardia():
    candidates = evaluate_reading({"bpm": 42}, 0)
    assert any(c.kind == "bradycardia" for c in candidates)


def test_cooldown_suppresses_and_escalates():
    engine = CooldownEngine()
    c = AlertCandidate("bradycardia", "Bradycardia — BPM 45")
    t0 = 1_000_000
    out = engine.filter([c], t0)
    assert len(out) == 1 and "[escalation]" not in out[0].message
    out2 = engine.filter([c], t0 + 10_000)  # within 60s cooldown
    assert out2 == []  # suppressed
    escalated = []
    for k in range(1, 4):  # escalate once the 3-suppression cap is breached
        out3 = engine.filter([c], t0 + 10_000 + k * 1000)
        escalated.extend(out3)
    assert any("[escalation]" in o.message for o in escalated)


def test_cooldown_releases_after_period():
    engine = CooldownEngine()
    c = AlertCandidate("bradycardia", "x")
    engine.filter([c], 0)
    out = engine.filter([c], 61_000)
    assert len(out) == 1


@pytest.mark.parametrize("bpm,expected_kind", [
    (130, "tachycardia"),
    (42, "bradycardia"),
])
def test_thresholds(bpm, expected_kind):
    kinds = [c.kind for c in evaluate_reading({"bpm": bpm}, 0)]
    assert expected_kind in kinds
