import { useCallback, useMemo, useState } from "react";
import { Heart, Play, Square, Download, Gauge, Sparkles, RadioTower, CircleAlert, HandMetal, PersonStanding } from "lucide-react";
import { EcgChart } from "../../components/EcgChart";
import { StatusChip, Modal } from "../../components/ui";
import { pushToast } from "../../components/ToastHost";
import { useLiveTelemetry } from "../../hooks/useLiveTelemetry";
import type { DataLayer } from "../../lib/dataLayer";
import { ECG_CLASS_LABELS, type EcgClass } from "../../lib/schema";
import { exportReadingsCsv, appendStringAsFile } from "../../lib/csv";

export function PatientMonitoring({ patientId, layer }: { patientId: string; layer: DataLayer }) {
  const { monitor, aiOutcome, predicting, startMonitoring, runPrediction, saveReading } = useLiveTelemetry(patientId, layer);
  const [arrhythmiaDemo, setArrhythmiaDemo] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [emergencyState, setEmergencyState] = useState<"idle" | "submitted" | "error">("idle");
  const [saving, setSaving] = useState(false);

  const buffer = monitor.buffer;
  const est = monitor.lastEstimate;
  const live = monitor.state === "live";
  const movement = monitor.movement;

  const toggleArrhythmia = useCallback(() => {
    const next = !arrhythmiaDemo;
    setArrhythmiaDemo(next);
    monitor.setDemoTarget(78, next);
    pushToast("ok", next ? "Demo arrhythmia (PVC) pattern enabled — synthetic samples only" : "Demo rhythm back to sinus pattern");
  }, [arrhythmiaDemo, monitor]);

  const start = async (source: "demo" | "hardware") => {
    await startMonitoring(source);
    pushToast("ok", source === "demo" ? "Monitoring started — DEMO signal generator" : "Listening for hardware-telemetry events…");
  };
  const stop = () => {
    monitor.stop();
    pushToast("ok", "Monitoring session closed. This does not stop any physical device (see docs/hardware-integration.md).");
  };

  const quickReading = async () => {
    setSaving(true);
    try {
      const quality = est?.bpm == null ? "unknown" : est.quality >= 70 ? "good" : est.quality >= 40 ? "fair" : "poor";
      const saved = await saveReading(
        est?.bpm ?? null,
        quality,
        aiOutcome,
        buffer.samples,
        buffer.rate,
        monitor.dataSource === "demo" ? "demo" : "hardware",
        movement ? { activityLevel: movement.activityLevel, fallSuspected: movement.fallSuspected, fallConfirmed: movement.fallConfirmed } : null,
      );
      pushToast(saved ? "ok" : "bad", saved ? "Single reading saved" : "Reading could not be saved — see the database error");
    } finally {
      setSaving(false);
    }
  };

  const sendEmergency = async () => {
    setEmergencyOpen(false);
    try {
      await layer.saveAlert({
        patientId,
        kind: "manual-emergency",
        message: `Manual emergency request submitted by patient at ${new Date().toLocaleTimeString()}. Database record only — no external notification provider is configured.`,
        timestamp: Date.now(),
        status: "created",
        readingId: null,
        sourceKind: "manual",
        deliveryConfirmed: false,
      });
      setEmergencyState("submitted");
      pushToast("ok", "Emergency request recorded (awaiting acknowledgement — no external notifications configured)");
    } catch (err) {
      setEmergencyState("error");
      pushToast("bad", `Emergency request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const exportCsv = async () => {
    try {
      const rows = await layer.listReadings(patientId, 300);
      if (!rows.length) { pushToast("bad", "No stored readings to export yet"); return; }
      appendStringAsFile(`medipulse-readings-${patientId.slice(0, 8)}.csv`, exportReadingsCsv(rows));
      pushToast("ok", `Exported ${rows.length} readings`);
    } catch (err) {
      pushToast("bad", `Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const stateChip = useMemo(() => {
    switch (monitor.state) {
      case "live":
        return <StatusChip tone="ok" pulse>{monitor.dataSource === "demo" ? "Demo signal — live" : "Hardware — live"}</StatusChip>;
      case "stale":
        return <StatusChip tone="warn" pulse>Stale data · {Math.round((monitor.ageMs ?? 0) / 1000)} s old</StatusChip>;
      case "hardware-disconnected":
        return <StatusChip tone="bad">No device packets</StatusChip>;
      case "stopped":
        return <StatusChip>Session closed</StatusChip>;
      default:
        return <StatusChip tone="warn">Idle</StatusChip>;
    }
  }, [monitor.state, monitor.dataSource, monitor.ageMs]);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
        <div>
          <h1 className="h-page" style={{ fontSize: 26 }}>Live Monitoring <span className="accent">· Lead II</span></h1>
          <div className="label-caps" style={{ marginTop: 6 }}>PHOSPHOR VIEW · 8 s SWEEP · 250 Hz</div>
        </div>
        <span className="grow" />
        {stateChip}
        {!live && (
          <>
            <button className="btn primary" onClick={() => start("demo")}><Play size={15} /> Start demo monitoring</button>
            <button className="btn" onClick={() => start("hardware")}><RadioTower size={15} /> Listen for device</button>
          </>
        )}
        {live && (
          <>
            <button className="btn" onClick={quickReading} disabled={saving}><Download size={15} /> {saving ? "Saving…" : "Save single reading"}</button>
            <button className="btn danger" onClick={stop}><Square size={15} /> Stop session</button>
          </>
        )}
      </div>

      {monitor.error && <div className="error-note">{monitor.error}</div>}
      {monitor.dataSource === "demo" && (live || monitor.state === "stopped") && (
        <div className="warn-note">Waveform is generated by the <b>demo signal generator</b> — synthetic samples, not a real ECG.</div>
      )}
      {monitor.dataSource === "hardware" && (live || monitor.state === "hardware-disconnected") && (
        <div className="info-note">
          Waiting for <code>hardware-telemetry</code> window events (device bridge contract in docs/hardware-integration.md).
          If an ESP32/AD8232 bridge is connected locally its samples appear here; a BPM-only payload shows a “values-only” state and never draws a synthetic waveform.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 18 }} className="mon-grid">
        <section className="monitor" style={{ padding: 0 }}>
          <div style={{ padding: "14px 18px 4px", display: "flex", gap: 12 }}>
            <span className="monitor-label">LEAD II</span>
            <span className="grow" />
            <span className="monitor-label">{buffer.rate} Hz · mV</span>
          </div>
          <div style={{ display: "grid", gridTemplateRows: "168px 96px 96px" }}>
            <div style={{ position: "relative" }}>
              <EcgChart buffer={buffer} samplesPerSecond={buffer.rate} active={live} height={168} />
              <div style={{ position: "absolute", left: 14, top: 10 }} className="monitor-label">ECG · mV</div>
              {buffer.samples.length === 0 && (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
                  <span className="monitor-label" style={{ color: "rgba(70,240,155,0.4)" }}>
                    {monitor.state === "hardware-disconnected" ? "AWAITING DEVICE PACKETS" : "NO WAVEFORM — START A SESSION"}
                  </span>
                </div>
              )}
            </div>
            <div style={{ position: "relative", borderTop: "1px solid rgba(70,240,155,0.08)" }}>
              <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", gap: 4 }}>
                <div className="monitor-label" style={{ color: "rgba(70,240,155,0.35)" }}>RESP — SENSOR NOT CONNECTED</div>
                <div className="monitor-num" style={{ fontSize: 22, color: "rgba(70,240,155,0.26)" }}>--</div>
                <div style={{ fontSize: 10, color: "rgba(70,240,155,0.25)" }}>AD8232 / MPU6050 do not measure respiration</div>
              </div>
            </div>
            <MovementLane
              active={live && monitor.dataSource === "hardware"}
              activity={movement?.activityLevel ?? null}
              magnitude={movement?.magnitude ?? null}
              suspected={movement?.fallSuspected ?? false}
              confirmed={movement?.fallConfirmed ?? false}
            />
          </div>
        </section>

        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <section className="monitor" style={{ padding: 18, display: "grid", gap: 6 }}>
            <div className="row"><span className="monitor-label">HR</span><span className="grow" /><span className="monitor-label">BPM</span></div>
            <div className="monitor-num" data-testid="hr-bpm" style={{ fontSize: 58 }}>{est?.bpm != null ? Math.round(est.bpm) : "—"}<span style={{ fontSize: 16, marginLeft: 8, opacity: 0.7 }}>BPM</span></div>
            <div style={{ display: "flex", gap: 8, fontSize: 11.5, color: "rgba(70,240,155,0.6)", fontFamily: "var(--mono)" }}>
              <span>Q {est?.quality ?? 0}%</span><span>·</span><span>{est?.beatCount ?? 0} beats</span>
              <span>·</span><span>{(buffer.samples.length / buffer.rate).toFixed(1)} s</span>
            </div>
          </section>

          <section className="glass" style={{ padding: 18, display: "grid", gap: 10 }}>
            <div className="row">
              <Sparkles size={14} color="var(--teal)" />
              <span className="label-caps">AI analysis (experimental)</span>
              <span className="grow" />
              {predicting && <StatusChip pulse>Analysing…</StatusChip>}
            </div>
            {aiOutcome.ok && aiOutcome.detail ? (
              <>
                <div style={{ fontWeight: 700 }}>{ECG_CLASS_LABELS[aiOutcome.detail.modelClass as EcgClass] ?? aiOutcome.detail.className}</div>
                <div className="row" style={{ fontSize: 12.5, color: "var(--ink-3)", flexWrap: "wrap", gap: 6 }}>
                  <span>Confidence {(aiOutcome.detail.confidence * 100).toFixed(0)}%</span>
                  <span>·</span>
                  <span>Risk {aiOutcome.detail.riskScore}/100</span>
                  <span>·</span>
                  <span style={{ color: aiOutcome.detail.conditionLevel === "high" ? "var(--red)" : aiOutcome.detail.conditionLevel === "moderate" ? "var(--amber)" : "var(--phosphor)" }}>{aiOutcome.detail.conditionLevel}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--ink-4)", lineHeight: 1.5 }}>
                  Model: <code>{aiOutcome.model ?? "unknown"}</code> · output is an experimental monitoring indicator, not a medical diagnosis.
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{live ? "Awaiting first analysis…" : "Start monitoring to enable analysis"}</div>
                {aiOutcome.reason && (
                  <div style={{ fontSize: 12, color: "var(--red)", lineHeight: 1.45 }} role="status">AI unavailable: {aiOutcome.reason}</div>
                )}
              </>
            )}
            <button
              className="btn"
              style={{ padding: "9px 12px", fontSize: 13 }}
              disabled={!live || predicting || buffer.samples.length < buffer.rate * 2}
              onClick={() => runPrediction(buffer.samples, buffer.rate, est?.bpm ?? null, monitor.signalQuality)}
            >
              <Gauge size={14} /> Run analysis now
            </button>
          </section>

          {monitor.dataSource === "demo" && (
            <section className="glass-soft" style={{ padding: 14, display: "grid", gap: 8 }}>
              <div className="label-caps" style={{ display: "flex", gap: 6, alignItems: "center" }}><HandMetal size={13} /> Demo controls</div>
              <button className={`btn ${arrhythmiaDemo ? "danger" : ""}`} style={{ padding: "9px 12px", fontSize: 13 }} onClick={toggleArrhythmia}>
                {arrhythmiaDemo ? "Disable PVC pattern" : "Inject PVC pattern"}
              </button>
              <div style={{ fontSize: 11, color: "var(--ink-4)" }}>Demo mode has no inertial sensor — the MPU6050 lane stays explicitly unavailable.</div>
            </section>
          )}

          <button className="btn danger" style={{ padding: 16, fontSize: 15, fontWeight: 800, letterSpacing: 0.4 }} onClick={() => setEmergencyOpen(true)}>
            <CircleAlert size={17} /> EMERGENCY
          </button>
          {emergencyState === "submitted" && <div className="info-note">Emergency request submitted (awaiting acknowledgement — no external provider configured)</div>}
          {emergencyState === "error" && <div className="error-note">Emergency request failed — check the database connection</div>}

          <button className="btn ghost" style={{ padding: "9px 12px", fontSize: 13 }} onClick={exportCsv}><Download size={14} /> Export history CSV</button>
        </div>
      </div>

      <Modal open={emergencyOpen} title="Confirm emergency request" onClose={() => setEmergencyOpen(false)}>
        <p style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.55, marginTop: 0 }}>
          This writes a patient-initiated emergency request to the monitoring database and surfaces it to the
          authorised care console. <b>No emergency services or SMS provider are configured in this build</b> — the
          record documents the request and its acknowledgement status only.
        </p>
        <div className="row" style={{ marginTop: 14, justifyContent: "end", gap: 10 }}>
          <button className="btn ghost" onClick={() => setEmergencyOpen(false)}>Cancel</button>
          <button className="btn danger" onClick={sendEmergency}><Heart size={15} /> Submit request</button>
        </div>
      </Modal>
    </div>
  );
}

/** MPU6050 lane: true state of the inertial channel — never a decorative trace. */
function MovementLane({
  active, activity, magnitude, suspected, confirmed,
}: {
  active: boolean;
  activity: "still" | "light" | "active" | null;
  magnitude: number | null;
  suspected: boolean;
  confirmed: boolean;
}) {
  const label = confirmed ? "FALL CONFIRMED (device)" : suspected ? "SUSPECTED FALL — VALIDATE" : activity ? activity.toUpperCase() : null;
  return (
    <div style={{ position: "relative", borderTop: "1px solid rgba(70,240,155,0.08)", display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", padding: "0 18px" }}>
      <div style={{ display: "grid", gap: 4 }}>
        <div className="monitor-label" style={{ display: "flex", alignItems: "center", gap: 6, color: "rgba(70,240,155,0.4)" }}>
          <PersonStanding size={12} /> MPU6050 — MOVEMENT
        </div>
        <div className="monitor-num" style={{ fontSize: 18, color: active ? "rgba(70,240,155,0.75)" : "rgba(70,240,155,0.3)" }}>
          {active && magnitude != null ? `${magnitude.toFixed(2)} g` : "not connected"}
        </div>
        <div style={{ fontSize: 10, color: suspected || confirmed ? "rgba(255,120,130,0.9)" : "rgba(70,240,155,0.28)" }}>
          {active ? (label ?? "waiting for inertial samples") : "Attach a device bridge that emits motion samples"}
        </div>
      </div>
      <div style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 11, color: "rgba(70,240,155,0.35)" }}>
        {active ? `${activity ?? "—"}` : "—"}
      </div>
    </div>
  );
}
