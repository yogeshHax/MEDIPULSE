"""System-defined risk scoring (EXPERIMENTAL indicator, not a diagnosis).

Risk 0..100 blends classification confidence, abnormality repetition and BPM
deviation. The exact formula is deliberately simple and documented here so it
can be replaced by the project's validated model later:

    risk = 40 * (cls != N) * confidence
         + 30 * repeated abnormal streak factor (0..1)
         + 30 * bpm deviation from 60..85 band (0..1)

Trend compares the current risk against the average risk of the previous
readings for the same patient.
"""


def bpm_deviation_factor(bpm):
    if bpm is None:
        return 0.0
    if bpm < 60:
        return min(1.0, (60 - bpm) / 30.0)
    if bpm > 85:
        return min(1.0, (bpm - 85) / 60.0)
    return 0.0


def risk_score(model_class, confidence, bpm, abnormal_streak):
    abnormal = model_class is not None and model_class != "N"
    part1 = 40.0 * (1.0 if abnormal else 0.0) * (confidence or 0.0)
    part2 = 30.0 * min(1.0, max(0, abnormal_streak) / 3.0) if abnormal else 0.0
    part3 = 30.0 * bpm_deviation_factor(bpm)
    return round(part1 + part2 + part3)


def condition_level(risk):
    if risk > 66:
        return "high"
    if risk > 40:
        return "moderate"
    return "low"


def trend_from_history(current_risk, previous_risks):
    prev = [r for r in previous_risks if r is not None][-5:]
    if not prev:
        return "stable"
    avg = sum(prev) / len(prev)
    if current_risk - avg > 8:
        return "worsening"
    if avg - current_risk > 8:
        return "improving"
    return "stable"
