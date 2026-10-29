import { describe, expect, it } from "vitest";
import { AlertCooldown, evaluateReading, type AlertCandidate } from "./alerts";
import type { Reading } from "./schema";

function reading(over: Partial<Reading> = {}): Reading {
  return {
    id: "r1",
    patientId: "p1",
    timestamp: Date.now(),
    bpm: null,
    modelClass: null,
    confidence: null,
    riskScore: null,
    conditionLevel: null,
    movement: null,
    source: "demo",
    signalQuality: "good",
    trend: "stable",
    ...over,
  };
}

describe("evaluateReading", () => {
  it("flags severe tachycardia above the critical threshold", () => {
    const out = evaluateReading(reading({ bpm: 130 }), 0);
    expect(out.map((c) => c.kind)).toContain("tachycardia");
  });

  it("flags bradycardia below the low threshold", () => {
    const out = evaluateReading(reading({ bpm: 40 }), 0);
    expect(out.map((c) => c.kind)).toContain("bradycardia");
  });

  it("stays silent in the normal band", () => {
    expect(evaluateReading(reading({ bpm: 70 }), 0)).toEqual([]);
  });

  it("uses the elevated band only above the tachycardia threshold", () => {
    const out = evaluateReading(reading({ bpm: 101 }), 0);
    expect(out[0]?.message).toContain("Elevated heart rate");
  });

  it("skips manual-source readings", () => {
    expect(evaluateReading(reading({ bpm: 150, source: "manual" }), 0)).toEqual([]);
  });

  it("fires critical-ai only after repeated abnormal classifications", () => {
    const r = reading({ bpm: 70, modelClass: "V", confidence: 0.9 });
    expect(evaluateReading(r, 0)).toEqual([]);
    const streak = evaluateReading(r, 1);
    expect(streak.map((c) => c.kind)).toContain("critical-ai");
  });

  it("reports fall events and distinguishes confirmed vs suspected", () => {
    const suspected = evaluateReading(reading({ movement: { activityLevel: "still", fallSuspected: true } }), 0);
    expect(suspected[0]?.message).toContain("validation");
    const confirmed = evaluateReading(reading({ movement: { activityLevel: "still", fallSuspected: true, fallConfirmed: true } }), 0);
    expect(confirmed[0]?.message).toContain("Impact detected");
  });

  it("never invents a critical-ai alert for normal classification", () => {
    expect(evaluateReading(reading({ modelClass: "N", confidence: 0.99 }), 5)).toEqual([]);
  });
});

describe("AlertCooldown", () => {
  const cand: AlertCandidate = { kind: "bradycardia", message: "Bradycardia — BPM 45" };

  it("passes the first alert and suppresses repeats within the cooldown", () => {
    const eng = new AlertCooldown();
    const t0 = 1_000_000;
    expect(eng.filter([cand], t0)).toHaveLength(1);
    expect(eng.filter([cand], t0 + 5_000)).toHaveLength(0);
  });

  it("releases an escalation after the suppression budget", () => {
    const eng = new AlertCooldown();
    const t0 = 1_000_000;
    eng.filter([cand], t0);
    // suppressions 1–2 are hidden; suppression 3 releases one escalation alert
    expect(eng.filter([cand], t0 + 1_000)).toHaveLength(0);
    expect(eng.filter([cand], t0 + 2_000)).toHaveLength(0);
    const esc = eng.filter([cand], t0 + 3_000);
    expect(esc).toHaveLength(1);
    expect(esc[0]?.message).toContain("[escalation]");
  });

  it("starts a fresh cooldown window after the period elapses", () => {
    const eng = new AlertCooldown();
    const t0 = 1_000_000;
    expect(eng.filter([cand], t0)).toHaveLength(1);
    expect(eng.filter([cand], t0 + 61_000)).toHaveLength(1);
  });

  it("tracks kinds independently", () => {
    const eng = new AlertCooldown();
    const t0 = 1_000_000;
    expect(eng.filter([cand], t0)).toHaveLength(1);
    expect(eng.filter([{ kind: "tachycardia", message: "x" }], t0 + 1_000)).toHaveLength(1);
  });
});
