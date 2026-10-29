/**
 * R-peak detection and BPM estimation from raw ECG samples.
 *
 * A light pan-Tompkins-style pipeline, sample-rate aware, tuned for single-lead
 * AD8232-style signals:
 *   1. moving-average smoothing to suppress HF noise,
 *   2. derivative to emphasise QRS slopes,
 *   3. adaptive threshold with a fixed 200 ms refractory window,
 *   4. BPM = 60 / median RR interval (robust to missed/ectopic beats).
 *
 * Pure functions — unit tested in bpm.test.ts.
 */

export interface BpmEstimate {
  bpm: number | null;
  beatCount: number;
  /** 0..100 — regularity of detected RR intervals; low values flag noisy/uncertain input. */
  quality: number;
  rrMs: number[];
}

/** Moving-average smoother. */
export function smooth(samples: number[], window: number): number[] {
  if (window <= 1 || samples.length < window) return samples.slice();
  const half = Math.floor(window / 2);
  const out = new Array<number>(samples.length);
  for (let i = 0; i < samples.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(samples.length - 1, i + half); j++) {
      sum += samples[j];
      count++;
    }
    out[i] = sum / count;
  }
  return out;
}

/** First-order derivative |dx/dt| emphasising QRS slopes. */
export function derivative(samples: number[], samplingRate: number): number[] {
  const out = new Array<number>(samples.length);
  for (let i = 1; i < samples.length - 1; i++) {
    out[i] = Math.abs(samples[i + 1] - samples[i - 1]);
  }
  out[0] = out[1] ?? 0;
  out[out.length - 1] = out[out.length - 2] ?? 0;
  return out.map((v) => v * samplingRate);
}

/** Median of an array (no mutation). */
export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const sorted = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Detect R-peak indices on the enhanced (|d/dt|) signal.
 *
 * Multi-peak detection: a 2 s sliding block supplies an adaptive
 * mean+1.35σ threshold; contiguous above-threshold regions within the block are
 * grouped and the maximum of each group is a candidate peak. A global 250 ms
 * refractory window (applied in signal order) prevents re-detecting the same
 * complex in overlapping blocks or riding the T wave.
 */
export function detectPeaks(enhanced: number[], samplingRate: number): number[] {
  if (enhanced.length < samplingRate) return [];
  const refractory = Math.round(0.25 * samplingRate); // 250 ms — max HR 240 bpm
  const block = Math.round(2 * samplingRate);
  const peaks: number[] = [];
  let lastPeak = -refractory;
  for (let start = 0; start + samplingRate <= enhanced.length; start += Math.max(1, Math.floor(block / 2))) {
    const end = Math.min(enhanced.length, start + block);
    let mean = 0;
    for (let i = start; i < end; i++) mean += enhanced[i];
    mean /= end - start;
    let variance = 0;
    for (let i = start; i < end; i++) variance += (enhanced[i] - mean) ** 2;
    variance /= end - start;
    const threshold = mean + 1.35 * Math.sqrt(variance);
    let regionStart = -1;
    for (let i = start; i < end + 1; i++) {
      const above = i < end && enhanced[i] > threshold;
      if (above && regionStart < 0) regionStart = i;
      if ((!above || i === end) && regionStart >= 0) {
        // close region [regionStart, i): take its maximum as the candidate
        let best = regionStart;
        for (let j = regionStart + 1; j < i; j++) if (enhanced[j] > enhanced[best]) best = j;
        if (best < 0) { regionStart = -1; continue; }
        regionStart = -1;
        if (best - lastPeak >= refractory) {
          peaks.push(best);
          lastPeak = best;
        }
      }
    }
  }
  return peaks;
}

export function estimateBpm(samples: number[], samplingRate: number): BpmEstimate {
  const empty: BpmEstimate = { bpm: null, beatCount: 0, quality: 0, rrMs: [] };
  if (!samples.length || samplingRate <= 0) return empty;
  // 5–15 Hz-ish band emphasis: smoothing window ~ 30 ms.
  const smoothed = smooth(samples, Math.max(3, Math.round(0.03 * samplingRate)));
  const enhanced = derivative(smoothed, samplingRate);
  const peaks = detectPeaks(enhanced, samplingRate);
  if (peaks.length < 2) return { ...empty, beatCount: peaks.length };
  const rrMs: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    const rr = ((peaks[i] - peaks[i - 1]) / samplingRate) * 1000;
    // Physiologically plausible RR: 0.33 s (180bpm) .. 2 s (30bpm)
    if (rr >= 330 && rr <= 2000) rrMs.push(rr);
  }
  if (rrMs.length < 2) return { ...empty, beatCount: peaks.length };
  const med = median(rrMs);
  // Filter noise RR values that are far from the median, then recompute BPM on survivors.
  const consistent = rrMs.filter((rr) => rr >= med * 0.75 && rr <= med * 1.25);
  const used = consistent.length >= 2 ? consistent : rrMs;
  const medUsed = median(used);
  const bpm = 60_000 / medUsed;
  const quality = Math.min(100, Math.round((used.length / rrMs.length) * 100));
  // Short windows (a few seconds) carry uncertainty: penalize by number of beats.
  const countPenalty = Math.min(1, peaks.length / 6);
  return {
    bpm: Math.round(bpm * 10) / 10,
    beatCount: peaks.length,
    quality: Math.round(quality * countPenalty),
    rrMs: used,
  };
}

/** Map a BPM estimate + freshness into a coarse signal-quality label. */
export function qualityLabel(quality: number, hasData: boolean): "good" | "fair" | "poor" | "unknown" {
  if (!hasData) return "unknown";
  if (quality >= 70) return "good";
  if (quality >= 40) return "fair";
  return "poor";
}
