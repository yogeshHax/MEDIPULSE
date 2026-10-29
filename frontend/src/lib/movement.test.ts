import { describe, expect, it } from "vitest";
import { MovementTracker, activityFromWindow, magnitudeOf } from "./movement";

const rest = (t: number) => ({ t, ax: 0.02, ay: 0.03, az: 0.999 });
const impact = (t: number) => ({ t, ax: 1.2, ay: 2.3, az: 0.6, gx: 180, gy: 90, gz: 40 });
const shake = (t: number) => ({ t, ax: 0.5, ay: -0.4, az: 0.8, gx: 120, gy: 60, gz: 30 });

describe("movement processing", () => {
  it("computes acceleration magnitude", () => {
    expect(magnitudeOf({ ax: 3, ay: 4, az: 0 })).toBeCloseTo(5);
  });

  it("classifies activity from the magnitude spread", () => {
    expect(activityFromWindow([1, 1.001, 0.999, 1.0005, 1.0])).toBe("still");
    expect(activityFromWindow([1, 1.1, 0.9, 1.05, 0.95])).toBe("light");
    expect(activityFromWindow([1, 1.8, 0.4, 1.6, 0.5, 1.9])).toBe("active");
    expect(activityFromWindow([1])).toBe("still");
  });

  it("does not flag a fall from a spike alone", () => {
    const t = new MovementTracker();
    const snap = t.ingest(impact(1000));
    expect(snap.fallSuspected).toBe(false);
    expect(snap.lastImpactAt).toBe(1000);
  });

  it("flags a SUSPECTED fall after impact + post-impact stillness", () => {
    const t = new MovementTracker();
    t.ingest(impact(1000));
    t.ingest({ ...rest(2300) });
    const snap = t.ingest(rest(3000));
    expect(snap.fallSuspected).toBe(true);
    expect(snap.fallConfirmed).toBe(false);
  });

  it("does not flag when the subject keeps moving after the impact", () => {
    const t = new MovementTracker();
    t.ingest(impact(1000));
    for (let i = 1; i <= 6; i++) t.ingest(shake(1000 + i * 400));
    const snap = t.ingest(shake(4000));
    expect(snap.fallSuspected).toBe(false);
  });

  it("only confirms when the device asserts the fall", () => {
    const t = new MovementTracker();
    const snap = t.ingest({ ...impact(1000), deviceFall: true });
    expect(snap.fallSuspected).toBe(true);
    expect(snap.fallConfirmed).toBe(true);
  });

  it("ignores duplicate impacts inside the refractory window", () => {
    const t = new MovementTracker();
    t.ingest(impact(1000));
    const snap = t.ingest(impact(1500));
    expect(snap.lastImpactAt).toBe(1000);
  });

  it("tracks window size and resets cleanly", () => {
    const t = new MovementTracker();
    for (let i = 0; i < 5; i++) t.ingest(rest(i * 100));
    expect(t.ingest(rest(600)).windowSize).toBe(6);
    t.reset();
    expect(t.ingest(rest(700)).windowSize).toBe(1);
  });
});
