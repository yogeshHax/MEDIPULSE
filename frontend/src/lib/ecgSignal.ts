/**
 * Demo-mode ECG signal generation and device telemetry simulation.
 *
 * IMPORTANT: these signals are clearly-labelled SIMULATED data used when no
 * hardware is connected. They are never labelled as a real patient's ECG in the
 * UI. The generator produces gaussian R energy at the requested BPM with
 * physiological relative amplitudes and an arrhythmia "PVC" perturbation mode
 * so the monitor visuals and the alert pipeline can be exercised end to end.
 */

export interface EcgFrame {
  t: number; // sample index
  value: number; // mV
}

interface SimState {
  nextBeatIdx: number;
  bpm: number;
  arrhythmiaMode: boolean;
  beatCount: number;
}

export class EcgSimulator {
  private state: SimState;
  private phase = 0;
  /** gaussian envelope generator producing one beat's morphology in samples */
  private beatShape(samplesPerBeat: number): number[] {
    const n = samplesPerBeat;
    const g = (center: number, width: number, amp: number, neg = false) => {
      const arr = new Array<number>(n).fill(0);
      for (let i = 0; i < n; i++) {
        const d = (i - center) / width;
        arr[i] += (neg ? -1 : 1) * amp * Math.exp(-0.5 * d * d);
      }
      return arr;
    };
    const out = new Array<number>(n).fill(0);
    const add = (a: number[]) => out.forEach((_, i) => (out[i] += a[i]));
    // P wave, QRS complex, T wave — relative amplitudes similar to lead-II
    add(g(0.2 * n, 0.045 * n, 0.12));
    add(g(0.4 * n, 0.012 * n, -0.16));
    add(g(0.425 * n, 0.02 * n, 1.05));
    add(g(0.455 * n, 0.014 * n, -0.22));
    add(g(0.62 * n, 0.075 * n, 0.28));
    return out;
  }

  constructor(bpm = 72) {
    this.state = { nextBeatIdx: 0, bpm, arrhythmiaMode: false, beatCount: 0 };
  }

  setBpm(bpm: number) {
    this.state.bpm = Math.max(35, Math.min(180, bpm));
  }
  setArrhythmia(on: boolean) {
    this.state.arrhythmiaMode = on;
  }

  /** Generate `count` samples at `rate` Hz continuing the internal stream. */
  next(count: number, rate: number): number[] {
    const out = new Array<number>(count);
    const beatDur = 60 / this.state.bpm; // seconds
    const samplesPerBeat = beatDur * rate;
    for (let i = 0; i < count; i++) {
      out[i] = this.sampleOne(rate, samplesPerBeat, i, count);
    }
    return out;
  }

  private beatCache: { start: number; shape: number[] } | null = null;

  private nextBeatInfo(rate: number): { start: number; shape: number[] } {
    const beatDur = 60 / this.state.bpm;
    // variability: ±3% jitter for realism
    const jitter = 1 + (Math.random() - 0.5) * 0.06;
    const dur = beatDur * jitter;
    const spb = Math.round(dur * rate);
    const shape = this.beatShape(Math.max(24, spb));
    return { start: this.phase, shape };
  }

  private sampleOne(rate: number, _spb: number, i: number, count: number): number {
    if (!this.beatCache || this.phase >= this.beatCache.start + this.beatCache.shape.length) {
      this.beatCache = this.nextBeatInfo(rate);
      this.state.beatCount++;
      // PVC: occasionally replace a beat with a wide inverted complex
      if (this.state.arrhythmiaMode && this.state.beatCount % 6 === 5) {
        this.beatCache.shape = this.beatCache.shape.map((v, j, arr) => {
          // widen & invert the QRS region
          const n = arr.length;
          const qrsCenter = 0.43 * n;
          const d = Math.abs(j - qrsCenter) / (0.1 * n);
          return j % 2 === 0 ? v : -1.3 * Math.exp(-0.5 * d * d) + 0.1 * v;
        });
      }
    }
    const { start, shape } = this.beatCache;
    const off = this.phase - start;
    let v = off >= 0 && off < shape.length ? shape[off] : 0;
    // baseline wander + measurement noise
    v += 0.03 * Math.sin((this.phase / rate) * 0.9) + 0.012 * (Math.random() - 0.5);
    this.phase += 1;
    void i;
    void count;
    return v;
  }

  /** Reset stream (e.g. on monitoring start). */
  reset(bpm?: number) {
    this.phase = 0;
    this.beatCache = null;
    this.state.beatCount = 0;
    if (bpm != null) this.setBpm(bpm);
  }
}

/** Build a `hardware-telemetry`-style payload from an ECG frame batch (documents the bridge format). */
export function batchToTelemetry(samples: number[], rate: number, bpm: number | null, fall: boolean) {
  return {
    ecg: samples,
    samplingRate: rate,
    bpm,
    fall,
    timestamp: Date.now(),
  };
}
