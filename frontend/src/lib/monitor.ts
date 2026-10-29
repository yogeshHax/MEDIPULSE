/**
 * Monitoring session model — the heart of the live monitoring feature.
 *
 * Data source contract (docs/hardware-integration.md):
 *  - "hardware": a real device feeds `window` custom events (`hardware-telemetry`),
 *    a local WebSocket bridge, or Web Serial. Batches carry raw ECG samples
 *    (mV), the sampling rate, optional BPM and optional MPU6050 samples.
 *  - "demo": the built-in EcgSimulator, ALWAYS labelled as simulated in the UI.
 *
 * Every state transition is explicit so the UI can render live / stale / offline /
 * poor-signal / demo states truthfully. Sample batches never touch React state —
 * the canvas reads the shared buffer, so a 250 Hz stream does not re-render the page.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_SAMPLING_RATE, type SignalQuality, type SourceKind } from "./schema";
import { estimateBpm, qualityLabel, type BpmEstimate } from "./bpm";
import { EcgSimulator } from "./ecgSignal";
import { MovementTracker, type MovementSnapshot, type RawMotionSample } from "./movement";

export type DataSource = "demo" | "hardware";
export type SessionState = "idle" | "live" | "stale" | "hardware-disconnected" | "stopped";

export interface MonitorFrame {
  samples: number[]; // newest batch
  rate: number;
  t: number; // wall clock ms of batch end
}

/** Shape of the documented `hardware-telemetry` CustomEvent detail. */
export interface HardwareTelemetryDetail {
  ecg?: number[];
  samplingRate?: number;
  bpm?: number | null;
  /** Optional MPU6050 samples; either one snapshot or a short batch. */
  motion?: RawMotionSample | RawMotionSample[];
  /** Explicit device-reported fall flag (kept separate from our own inference). */
  fall?: boolean;
}

export interface MonitorSession {
  state: SessionState;
  dataSource: DataSource;
  /** Rolling buffer of the waveform (bounded) — shared with the EcgChart without re-rendering React per sample. */
  buffer: EcgBuffer;
  lastEstimate: BpmEstimate | null;
  signalQuality: SignalQuality;
  /** Latest MPU6050 snapshot, or null when no inertial sensor is reporting. */
  movement: MovementSnapshot | null;
  lastSampleAt: number | null;
  error: string | null;
  /** Age of the newest batch in ms (re-evaluated on the freshness tick). */
  ageMs: number | null;
}

/** Sample ring buffer managed outside React state (performance requirement). */
export class EcgBuffer {
  private data: number[] = [];
  constructor(public capacityMs: number, public rate: number) {}
  capacity() { return Math.round((this.capacityMs / 1000) * this.rate); }
  get samples(): number[] { return this.data; }
  push(batch: number[]) {
    if (!batch.length) return;
    this.data.push(...batch);
    const cap = this.capacity();
    if (this.data.length > cap) this.data.splice(0, this.data.length - cap);
  }
  clear() { this.data = []; }
}

export interface UseMonitorOptions {
  windowMs?: number;
  onBatch?: (frame: MonitorFrame) => void;
}

export function useMonitor(options: UseMonitorOptions = {}) {
  const { windowMs = 8000, onBatch } = options;
  const buffer = useMemo(() => new EcgBuffer(windowMs, DEFAULT_SAMPLING_RATE), [windowMs]);
  const sim = useMemo(() => new EcgSimulator(72), []);
  const tracker = useMemo(() => new MovementTracker(), []);
  const [state, setState] = useState<SessionState>("idle");
  const [dataSource, setDataSource] = useState<DataSource>("demo");
  const [lastEstimate, setLastEstimate] = useState<BpmEstimate | null>(null);
  const [signalQuality, setSignalQuality] = useState<SignalQuality>("unknown");
  const [movement, setMovement] = useState<MovementSnapshot | null>(null);
  const [lastSampleAt, setLastSampleAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [freshnessTick, setFreshnessTick] = useState(0);

  const refs = useRef({
    sim,
    onBatch,
    lastSampleAt: null as number | null,
    demoBaseBpm: 72,
    demoArrhythmia: false,
    customListener: null as ((ev: Event) => void) | null,
    stopFns: [] as Array<() => void>,
  });
  refs.current.onBatch = onBatch;

  const emitBatch = (samples: number[], rate: number) => {
    const t = Date.now();
    buffer.push(samples);
    refs.current.lastSampleAt = t;
    setLastSampleAt(t);
    refs.current.onBatch?.({ samples, rate, t });
  };

  const ingestMotion = (raw: RawMotionSample | RawMotionSample[] | undefined, deviceFall?: boolean) => {
    if (!raw) return;
    const list = Array.isArray(raw) ? raw : [raw];
    let snap: MovementSnapshot | null = null;
    for (const s of list) snap = tracker.ingest({ ...s, deviceFall: deviceFall ?? s.deviceFall });
    if (snap) setMovement(snap);
  };

  const start = async (source: DataSource) => {
    stopInternal();
    buffer.clear();
    tracker.reset();
    setMovement(null);
    setDataSource(source);
    setError(null);
    setLastEstimate(null);
    setSignalQuality("unknown");
    setLastSampleAt(null);
    refs.current.lastSampleAt = null;

    if (source === "demo") {
      sim.reset(refs.current.demoBaseBpm);
      sim.setBpm(refs.current.demoBaseBpm);
      sim.setArrhythmia(refs.current.demoArrhythmia);
      const rate = DEFAULT_SAMPLING_RATE;
      const batch = Math.round(rate * 0.2); // 200 ms chunks at 250 Hz
      setState("live");
      const timer = window.setInterval(() => {
        try {
          const samples = sim.next(batch, rate);
          emitBatch(samples, rate);
          const est = estimateBpm(buffer.samples, rate);
          setLastEstimate(est);
          setSignalQuality(est.bpm == null ? "poor" : qualityLabel(est.quality, true));
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }, 200);
      refs.current.stopFns.push(() => window.clearInterval(timer));
      return;
    }

    // Hardware path: listen for the documented `hardware-telemetry` window event.
    setState("hardware-disconnected");
    const listener = (ev: Event) => {
      const detail = (ev as CustomEvent<HardwareTelemetryDetail>).detail;
      if (!detail) return;
      const rate = detail.samplingRate ?? DEFAULT_SAMPLING_RATE;
      const samples = detail.ecg ?? [];
      if (samples.length === 0 && detail.bpm == null && !detail.motion) {
        setError("hardware-telemetry event had no ecg samples, bpm or motion data.");
        return;
      }
      setState("live");
      setError(null);
      if (detail.motion) ingestMotion(detail.motion, detail.fall);
      if (samples.length) {
        emitBatch(samples, rate);
        const est = estimateBpm(buffer.samples, rate);
        setLastEstimate(est);
        setSignalQuality(qualityLabel(est.quality, true));
      } else if (detail.bpm != null) {
        // BPM-only bridge: never draw a fake waveform from a BPM number.
        setLastEstimate({ bpm: detail.bpm, beatCount: 0, quality: 0, rrMs: [] });
        setSignalQuality("unknown");
      }
    };
    window.addEventListener("hardware-telemetry", listener);
    refs.current.customListener = listener;

    // Freshness tick: drives live → stale → hardware-disconnected without needing traffic.
    const watchdog = window.setInterval(() => setFreshnessTick((t) => t + 1), 1500);
    refs.current.stopFns.push(() => window.clearInterval(watchdog));
  };

  const stopInternal = () => {
    refs.current.stopFns.splice(0).forEach((fn) => fn());
    if (refs.current.customListener) {
      window.removeEventListener("hardware-telemetry", refs.current.customListener);
      refs.current.customListener = null;
    }
  };

  const stop = () => {
    stopInternal();
    setState("stopped");
    // Stopping a UI session ≠ stopping the sensor: see docs/hardware-integration.md §3.4.
  };

  const setDemoTarget = (bpm: number, arrhythmia: boolean) => {
    refs.current.demoBaseBpm = bpm;
    refs.current.demoArrhythmia = arrhythmia;
    if (dataSource === "demo") { sim.setBpm(bpm); sim.setArrhythmia(arrhythmia); }
  };

  useEffect(() => () => stopInternal(), []);

  const ageMs = lastSampleAt == null ? null : Date.now() - lastSampleAt;
  const derivedState: SessionState = useMemo(() => {
    if (state !== "live") return state;
    if (dataSource !== "hardware") return "live";
    if (ageMs == null) return "hardware-disconnected";
    if (ageMs > 8000) return "hardware-disconnected";
    if (ageMs > 4000) return "stale";
    return "live";
    // freshnessTick forces re-evaluation while the stream is silent.
  }, [state, dataSource, ageMs, freshnessTick]);

  return {
    state: derivedState,
    dataSource,
    buffer,
    lastEstimate,
    signalQuality,
    movement,
    lastSampleAt,
    ageMs,
    error,
    start,
    stop,
    setDemoTarget,
  };
}
