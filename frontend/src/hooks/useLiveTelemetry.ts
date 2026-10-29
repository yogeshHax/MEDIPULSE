import { useCallback, useEffect, useRef, useState } from "react";
import { useMonitor } from "../lib/monitor";
import { evaluateReading, AlertCooldown } from "../lib/alerts";
import { estimateBpm, qualityLabel } from "../lib/bpm";
import { requestPrediction } from "../lib/api";
import type { Alert, MovementEventSummary, Reading, SourceKind } from "../lib/schema";
import { pushToast } from "../components/ToastHost";
import type { DataLayer } from "../lib/dataLayer";

export interface AiOutcome {
  ok: boolean;
  detail: {
    modelClass: string;
    className: string;
    confidence: number;
    riskScore: number;
    conditionLevel: string;
    trend?: string;
  } | null;
  reason?: string;
  model?: string;
}

/**
 * Tie the live buffer to persistence + AI + alerts.
 *
 * Cadence:
 *  - BPM re-estimated by the monitor on each ~200 ms batch (cheap, no React churn per sample).
 *  - A summary Reading is persisted every `persistEveryMs` (default 8 s) — raw waveform
 *    batches are NOT stored per-sample (cost); the freshest 4 s batch is compressed into
 *    the reading document (see docs/firebase-setup.md §schema).
 *  - AI prediction is requested every 12 s when >= 3 s of samples exist.
 *  - Alert rules run on each persisted reading with a shared cooldown engine; the Flask
 *    backend exposes the same rules (backend/ecg/alerts.py) as the documented reference.
 */
export function useLiveTelemetry(patientId: string, layer: DataLayer | null, persistEveryMs = 8000) {
  const monitor = useMonitor();
  const [lastReading, setLastReading] = useState<Reading | null>(null);
  const [recentAlerts, setRecentAlerts] = useState<Alert[]>([]);
  const [predicting, setPredicting] = useState(false);
  const [aiOutcome, setAiOutcome] = useState<AiOutcome>({ ok: false, detail: null });

  const cooldown = useRef(new AlertCooldown());
  const abnormalStreak = useRef(0);
  const lastPersistAt = useRef(0);
  const predictAt = useRef(0);
  const aiRef = useRef<AiOutcome>(aiOutcome);
  const predictingRef = useRef(predicting);
  aiRef.current = aiOutcome;
  predictingRef.current = predicting;

  const saveReading = useCallback(async (
    bpm: number | null,
    quality: ReturnType<typeof qualityLabel>,
    ai: AiOutcome,
    samplesSnapshot: number[],
    rate: number,
    source: SourceKind,
    movement: MovementEventSummary | null,
  ) => {
    if (!layer || !patientId) return null;
    const reading: Omit<Reading, "id"> = {
      patientId,
      timestamp: Date.now(),
      bpm,
      ecgSamples: samplesSnapshot.length ? samplesSnapshot.slice(-Math.min(samplesSnapshot.length, rate * 4)) : undefined,
      samplingRate: samplesSnapshot.length ? rate : undefined,
      source,
      signalQuality: quality,
      modelClass: ai.ok && ai.detail ? (ai.detail.modelClass as Reading["modelClass"]) : null,
      confidence: ai.ok && ai.detail ? ai.detail.confidence : null,
      riskScore: ai.ok && ai.detail ? ai.detail.riskScore : null,
      trend: (ai.ok && ai.detail?.trend as Reading["trend"]) || "stable",
      conditionLevel: ai.ok && ai.detail ? (ai.detail.conditionLevel as Reading["conditionLevel"]) : null,
      movement,
    };
    try {
      const id = await layer.saveReading(patientId, reading);
      const saved: Reading = { ...reading, id };
      setLastReading(saved);
      // Alert evaluation uses the persisted reading (single source of truth).
      const candidates = evaluateReading(saved, abnormalStreak.current);
      const abnormal = saved.modelClass != null && saved.modelClass !== "N";
      abnormalStreak.current = abnormal ? abnormalStreak.current + 1 : 0;
      const filtered = cooldown.current.filter(candidates);
      for (const c of filtered) {
        const payload: Omit<Alert, "id"> = {
          patientId, kind: c.kind, message: c.message, timestamp: Date.now(), status: "created",
          readingId: c.readingId ?? null, sourceKind: source, deliveryConfirmed: false,
        };
        try {
          const alertId = await layer.saveAlert(payload);
          setRecentAlerts((a) => [{ ...payload, id: alertId }, ...a].slice(0, 50));
          pushToast("bad", `Alert: ${c.message}`);
        } catch (err) {
          pushToast("bad", `Alert persistence failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return saved;
    } catch (err) {
      pushToast("bad", `Could not save reading: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }, [layer, patientId]);

  const runPrediction = useCallback(async (samples: number[], rate: number, bpm: number | null, quality: string) => {
    setPredicting(true);
    try {
      const out = await requestPrediction(samples.slice(-rate * 6), rate, { bpm, signalQuality: quality });
      if (out.available) {
        setAiOutcome({
          ok: true,
          model: out.result.model,
          detail: {
            modelClass: out.result.modelClass,
            className: out.result.className,
            confidence: out.result.confidence,
            riskScore: out.result.riskScore,
            conditionLevel: out.result.conditionLevel,
            trend: out.result.trend,
          },
        });
      } else {
        setAiOutcome({ ok: false, detail: null, reason: out.reason });
      }
    } finally {
      setPredicting(false);
    }
  }, []);

  // Single 1 s scheduler drives persistence + periodic analysis.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (monitor.state !== "live") return;
      const buf = monitor.buffer.samples;
      const rate = monitor.buffer.rate;
      const now = Date.now();
      const est = estimateBpm(buf, rate);
      const fresh = buf.length >= rate * 3;
      if (!fresh) return;

      if (now - lastPersistAt.current >= persistEveryMs) {
        lastPersistAt.current = now;
        const mv = monitor.movement;
        void saveReading(
          est.bpm,
          qualityLabel(est.quality, est.bpm != null),
          aiRef.current,
          buf,
          rate,
          monitor.dataSource === "demo" ? "demo" : "hardware",
          mv
            ? { activityLevel: mv.activityLevel, fallSuspected: mv.fallSuspected, fallConfirmed: mv.fallConfirmed }
            : null,
        );
      }
      if (now - predictAt.current >= 12000 && !predictingRef.current) {
        predictAt.current = now;
        void runPrediction(buf, rate, est.bpm, qualityLabel(est.quality, true));
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [monitor.state, monitor.buffer, monitor.dataSource, monitor.movement, persistEveryMs, saveReading, runPrediction]);

  const startMonitoring = useCallback(async (source: "demo" | "hardware") => {
    const now = Date.now();
    lastPersistAt.current = now - 2000; // first persisted reading ~2 s after start
    predictAt.current = now + 8000;
    abnormalStreak.current = 0;
    cooldown.current = new AlertCooldown();
    setAiOutcome({ ok: false, detail: null });
    await monitor.start(source);
  }, [monitor]);

  return { monitor, lastReading, recentAlerts, aiOutcome, predicting, startMonitoring, runPrediction, saveReading };
}
