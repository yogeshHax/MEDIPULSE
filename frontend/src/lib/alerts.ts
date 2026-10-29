/**
 * Automatic alert rules + cooldown/escalation engine.
 *
 * Rules are code-visible monitoring heuristics, NOT clinically validated thresholds.
 * The same parameterisation exists in the Flask backend (backend/ecg/alerts.py) — keep both in
 * sync, documented in docs/architecture.md.
 */
import { ALERT_RULES, type Alert, type AlertKind, type Reading } from "./schema";

export interface AlertCandidate {
  kind: AlertKind;
  message: string;
  readingId?: string;
}

/** Evaluate the alert rules for one reading. */
export function evaluateReading(r: Reading, previousAbnormalStreak: number): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  if (r.source === "manual") return out;
  if (r.bpm != null) {
    if (r.bpm > ALERT_RULES.criticalBpm) out.push({ kind: "tachycardia", message: `Severe tachycardia — BPM ${r.bpm}`, readingId: r.id });
    else if (r.bpm > ALERT_RULES.tachycardiaBpm) out.push({ kind: "tachycardia", message: `Elevated heart rate — BPM ${r.bpm}`, readingId: r.id });
    if (r.bpm < ALERT_RULES.bradycardiaBpm) out.push({ kind: "bradycardia", message: `Bradycardia — BPM ${r.bpm}`, readingId: r.id });
  }
  if (r.modelClass && r.modelClass !== "N" && r.confidence != null && r.confidence >= 0.6) {
    if (previousAbnormalStreak + 1 >= ALERT_RULES.repeatedAbnormalThreshold) {
      out.push({ kind: "critical-ai", message: `Repeated abnormal classification (${r.modelClass}) × ${previousAbnormalStreak + 1} — confidence ${(r.confidence * 100).toFixed(0)}% (experimental indicator)`, readingId: r.id });
    }
  }
  if (r.movement?.fallSuspected) {
    out.push({ kind: "fall", message: r.movement.fallConfirmed ? "Impact detected — fall event recorded" : "Movement spike flagged as suspected fall (needs user validation)", readingId: r.id });
  }
  return out;
}

/**
 * Cooldown engine: suppress repeated same-kind alerts for the ongoing incident.
 * After ALERT_RULES.escalationAfterN suppressions, allow one through as escalation.
 */
export class AlertCooldown {
  private lastEmitted = new Map<AlertKind, { t: number; suppressed: number }>();

  filter(candidates: AlertCandidate[], now = Date.now()): AlertCandidate[] {
    const out: AlertCandidate[] = [];
    for (const c of candidates) {
      const prev = this.lastEmitted.get(c.kind);
      if (!prev || now - prev.t >= ALERT_RULES.cooldownMs) {
        this.lastEmitted.set(c.kind, { t: now, suppressed: 0 });
        out.push({ ...c, message: prev ? `[escalation] ${c.message}` : c.message });
      } else {
        prev.suppressed++;
        if (prev.suppressed < ALERT_RULES.escalationAfterN) {
          this.lastEmitted.set(c.kind, prev);
          continue; // suppressed
        }
        // escalation: release one alert after the suppression budget is exceeded
        this.lastEmitted.set(c.kind, { t: now, suppressed: 0 });
        out.push({ ...c, message: `[escalation] ${c.message}` });
      }
    }
    return out;
  }
}

export function makeAlert(candidate: AlertCandidate, patientId: string, sourceKind: Alert["sourceKind"]): Alert {
  return {
    id: `al_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    patientId,
    kind: candidate.kind,
    message: candidate.message,
    timestamp: Date.now(),
    status: "created",
    readingId: candidate.readingId ?? null,
    sourceKind,
    deliveryConfirmed: false,
  };
}
