"""Automatic alert rules, cooldown and escalation (server-side mirror of frontend/src/lib/alerts.ts).

Defaults are code-visible monitoring heuristics — NOT clinically validated thresholds.
"""
from dataclasses import dataclass, field
from typing import Optional

BRADYCARDIA_BPM = 50
TACHYCARDIA_BPM = 100
CRITICAL_BPM = 120
REPEATED_ABNORMAL_THRESHOLD = 2
COOLDOWN_MS = 60_000
ESCALATION_AFTER_N = 3


@dataclass
class AlertCandidate:
    kind: str
    message: str
    reading_id: Optional[str] = None


@dataclass
class CooldownEngine:
    last_emitted: dict = field(default_factory=dict)

    def filter(self, candidates, now_ms):
        out = []
        for c in candidates:
            prev = self.last_emitted.get(c.kind)
            if prev is None or now_ms - prev[0] >= COOLDOWN_MS:
                self.last_emitted[c.kind] = (now_ms, 0)
                msg = f"[escalation] {c.message}" if prev else c.message
                out.append(AlertCandidate(c.kind, msg, c.reading_id))
            else:
                suppressed = prev[1] + 1
                if suppressed < ESCALATION_AFTER_N:
                    self.last_emitted[c.kind] = (prev[0], suppressed)
                    continue
                self.last_emitted[c.kind] = (now_ms, 0)
                out.append(AlertCandidate(c.kind, f"[escalation] {c.message}", c.reading_id))
        return out


def evaluate_reading(reading, previous_abnormal_streak):
    """reading: dict with bpm, model_class, confidence, movement{fall_suspected}."""
    candidates = []
    bpm = reading.get("bpm")
    if bpm is not None:
        if bpm > CRITICAL_BPM:
            candidates.append(AlertCandidate("tachycardia", f"Severe tachycardia — BPM {bpm}", reading.get("id")))
        elif bpm > TACHYCARDIA_BPM:
            candidates.append(AlertCandidate("tachycardia", f"Elevated heart rate — BPM {bpm}", reading.get("id")))
        if bpm < BRADYCARDIA_BPM:
            candidates.append(AlertCandidate("bradycardia", f"Bradycardia — BPM {bpm}", reading.get("id")))
    cls = reading.get("model_class")
    conf = reading.get("confidence") or 0
    if cls and cls != "N" and conf >= 0.6:
        if previous_abnormal_streak + 1 >= REPEATED_ABNORMAL_THRESHOLD:
            candidates.append(AlertCandidate(
                "critical-ai",
                f"Repeated abnormal classification ({cls}) x{previous_abnormal_streak + 1} — confidence {conf * 100:.0f}% (experimental indicator)",
                reading.get("id"),
            ))
    movement = reading.get("movement") or {}
    if movement.get("fall_suspected"):
        confirmed = bool(movement.get("fall_confirmed"))
        candidates.append(AlertCandidate("fall", "Impact detected — fall event recorded" if confirmed else "Movement spike flagged as suspected fall (needs user validation)", reading.get("id")))
    return candidates
