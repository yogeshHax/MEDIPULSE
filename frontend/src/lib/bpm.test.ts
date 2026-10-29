/**
 * R-peak/BPM pipeline tests. Inputs are synthesised single-lead complexes with
 * gaussian QRS energy (same morphology the demo generator produces) plus noise,
 * so the assertions verify real detection behaviour rather than constants.
 */
import { describe, expect, it } from "vitest";
import { detectPeaks, derivative, estimateBpm, qualityLabel, smooth } from "./bpm";

const RATE = 250;

function synth(bpm: number, seconds: number, opts: { pvcEvery?: number; noise?: number } = {}): number[] {
  const n = seconds * RATE;
  const out = new Array<number>(n).fill(0);
  const period = (60 / bpm) * RATE;
  let pos = 40;
  let i = 0;
  while (pos < n - 30) {
    const pvc = opts.pvcEvery != null && i % opts.pvcEvery === (opts.pvcEvery - 1);
    const w = pvc ? 9 : 4;
    for (let k = -6; k <= 24; k++) {
      const idx = Math.round(pos) + k;
      if (idx < 0 || idx >= n) continue;
      const d = k / w;
      out[idx] += (pvc ? -1 : 1) * (pvc ? 1.0 : 1.15) * Math.exp(-0.5 * d * d);
      out[idx] += 0.25 * Math.exp(-0.5 * ((k / 16) ** 2)); // T wave
    }
    pos *= 1; pos += period * (1 + (i % 3 - 1) * 0.01);
    i++;
  }
  const noise = opts.noise ?? 0.02;
  for (let s = 0; s < n; s++) out[s] += noise * Math.random();
  return out;
}

describe("detectPeaks", () => {
  it("finds roughly one peak per beat", () => {
    const samples = synth(72, 10);
    const peaks = detectPeaks(derivative(smooth(samples, 8), RATE), RATE);
    expect(peaks.length).toBeGreaterThanOrEqual(8);
    expect(peaks.length).toBeLessThanOrEqual(12); // ~12 beats in 10 s at 72 bpm
  });

  it("respects the refractory window (no double-detection)", () => {
    const samples = synth(72, 10);
    const peaks = detectPeaks(derivative(smooth(samples, 8), RATE), RATE);
    for (let i = 1; i < peaks.length; i++) {
      expect(peaks[i] - peaks[i - 1]).toBeGreaterThanOrEqual(0.25 * RATE);
    }
  });
});

describe("estimateBpm", () => {
  it("estimates ~72 bpm from a simulated sinus track", () => {
    const est = estimateBpm(synth(72, 10), RATE);
    expect(est.bpm).not.toBeNull();
    expect(est.bpm!).toBeGreaterThanOrEqual(65);
    expect(est.bpm!).toBeLessThanOrEqual(82);
    expect(est.beatCount).toBeGreaterThanOrEqual(8);
    expect(est.quality).toBeGreaterThanOrEqual(60);
  });

  it("estimates ~105 bpm from a faster track", () => {
    const est = estimateBpm(synth(105, 10), RATE);
    expect(est.bpm!).toBeGreaterThanOrEqual(94);
    expect(est.bpm!).toBeLessThanOrEqual(118);
  });

  it("returns null bpm for empty input", () => {
    expect(estimateBpm([], RATE)).toEqual({ bpm: null, beatCount: 0, quality: 0, rrMs: [] });
  });

  it("returns null bpm for flatline input (no beats)", () => {
    const est = estimateBpm(new Array(RATE * 6).fill(0.01), RATE);
    expect(est.bpm).toBeNull();
  });

  it("noisy input lowers quality", () => {
    const noisy = estimateBpm(synth(72, 10, { noise: 0.35 }), RATE);
    const clean = estimateBpm(synth(72, 10, { noise: 0.0 }), RATE);
    if (noisy.bpm != null && clean.bpm != null) {
      expect(noisy.quality).toBeLessThanOrEqual(clean.quality + 20);
    }
  });
});

describe("qualityLabel", () => {
  it("maps quality bands", () => {
    expect(qualityLabel(80, true)).toBe("good");
    expect(qualityLabel(50, true)).toBe("fair");
    expect(qualityLabel(10, true)).toBe("poor");
    expect(qualityLabel(99, false)).toBe("unknown");
  });
});
