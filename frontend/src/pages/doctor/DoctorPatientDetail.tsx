import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, HeartPulse, Bell, Download, Hand } from "lucide-react";
import { EcgChart } from "../../components/EcgChart";
import { EcgBuffer } from "../../lib/monitor";
import { StatusChip, EmptyState } from "../../components/ui";
import { pushToast } from "../../components/ToastHost";
import { exportReadingsCsv, appendStringAsFile } from "../../lib/csv";
import { estimateBpm } from "../../lib/bpm";
import { decodeStoredSamples, type DataLayer } from "../../lib/dataLayer";
import { ECG_CLASS_LABELS } from "../../lib/schema";
import type { Alert, PatientRegistryEntry, Reading } from "../../lib/schema";

export function DoctorPatientDetail({ patientId, layer }: { patientId: string; layer: DataLayer }) {
  const bufRef = useRef(new EcgBuffer(25_000, 250));
  const [profile, setProfile] = useState<PatientRegistryEntry | null>(null);
  const [readings, setReadings] = useState<Reading[] | null>(null);
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    layer.getPatient(patientId)
      .then((p) => { if (!cancelled) setProfile(p ?? { patientId, name: patientId, latestBpm: null, lastReadingAt: null, unresolvedAlerts: 0 }); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    layer.listReadings(patientId, 100).then((rs) => { if (!cancelled) setReadings(rs); }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    const un = layer.subscribeAlerts(patientId, (a) => { if (!cancelled) setAlerts(a); }, 60);
    const unr = layer.subscribeReadings(patientId, (rs) => {
      if (cancelled) return;
      setReadings(rs);
      // reflect freshest stored waveform into the buffer for the big ECG panel
      const withSamples = (rs ?? []).filter((r) => r.ecgSamples);
      const freshest = withSamples[withSamples.length - 1];
      if (freshest) {
        const decoded = decodeStoredSamples(freshest.ecgSamples);
        bufRef.current.clear();
        bufRef.current.push(decoded);
        setTick((t) => t + 1);
      }
    }, 5);
    return () => { cancelled = true; un?.(); unr?.(); };
  }, [layer, patientId]);

  const latest = (readings && readings.length ? readings[readings.length - 1] : null);
  const latestSamples = useMemo(() => decodeStoredSamples(latest?.ecgSamples), [latest]);
  const est = useMemo(
    () => (latestSamples.length > 1 ? estimateBpm(latestSamples, latest?.samplingRate ?? 250) : null),
    [latestSamples, latest?.samplingRate],
  );

  const listenBridge = () => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { ecg?: number[]; samplingRate?: number; bpm?: number | null } | undefined;
      if (!detail) return;
      if (detail.ecg?.length) {
        bufRef.current.push(detail.ecg);
        setTick((t) => t + 1);
      }
      if (detail.bpm != null) {
        pushToast("ok", `Bridge reports BPM ${detail.bpm} for patient ${patientId} (live readings still arrive via the database subscription)`);
      }
    };
    window.addEventListener("hardware-telemetry", handler);
    setListening(true);
    pushToast("ok", "Device bridge listener attached for this patient session");
    return () => window.removeEventListener("hardware-telemetry", handler);
  };

  if (error && !readings) {
    return <div className="error-note">Could not open the patient record: {error}. Access beyond your assigned patients is blocked by Firestore rules (firestore.rules).</div>;
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <Link to="/doctor/patients" className="btn ghost" style={{ padding: "8px 12px" }} aria-label="Back to roster"><ArrowLeft size={15} /></Link>
        <div>
          <h1 className="h-page" style={{ fontSize: 26 }}>{profile?.name ?? patientId}</h1>
          <div className="label-caps" style={{ marginTop: 4 }}>PATIENT {patientId} · CLINICAL VIEW</div>
        </div>
        <span className="grow" />
        {!listening && <button className="btn" onClick={listenBridge}><HeartPulse size={15} /> Attach device bridge</button>}
        <button className="btn" onClick={() => { if (readings?.length) { appendStringAsFile(`medipulse-${patientId}.csv`, exportReadingsCsv(readings)); pushToast("ok", "Patient history exported"); } }}><Download size={14} /> Export</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 260px", gap: 18 }} className="mon-grid">
        <section className="monitor">
          <div style={{ padding: "14px 18px 6px" }} className="row">
            <span className="monitor-label">LEAD II · STORED + BRIDGE STREAM</span>
            <span className="grow" />
            <span className="monitor-label">{est ? `${Math.round(est.bpm ?? 0)} BPM · Q${est.quality}%` : "AWAITING WAVEFORM"}</span>
          </div>
          <EcgChart buffer={bufRef.current} samplesPerSecond={250} active={listening} height={230} gain={130} />
        </section>
        <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
          <section className="glass" style={{ padding: 16, display: "grid", gap: 8 }}>
            <span className="label-caps">Latest stored reading</span>
            {latest ? (
              <>
                <div style={{ fontSize: 26, fontWeight: 800, fontFamily: "var(--mono)" }}>{latest.bpm ?? "—"} <span style={{ fontSize: 12, color: "var(--ink-3)" }}>BPM</span></div>
                <div style={{ fontSize: 12, color: "var(--ink-4)" }}>{new Date(latest.timestamp).toLocaleString()}</div>
                <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                  <StatusChip tone={latest.modelClass === "N" ? "ok" : latest.modelClass ? "warn" : undefined}>{latest.modelClass ? `${latest.modelClass} — ${ECG_CLASS_LABELS[latest.modelClass]}` : "unclassified"}</StatusChip>
                  <StatusChip tone={latest.signalQuality === "good" ? "ok" : latest.signalQuality === "poor" ? "bad" : "warn"}>{latest.signalQuality}</StatusChip>
                  <StatusChip tone={latest.source === "hardware" ? "ok" : "warn"}>{latest.source}</StatusChip>
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-3)" }}>Risk {latest.riskScore ?? "—"}/100 · trend {latest.trend} · confidence {latest.confidence != null ? `${(latest.confidence * 100).toFixed(0)}%` : "—"}</div>
              </>
            ) : <EmptyState title="No readings stored" />}
          </section>
          <section className="glass-soft" style={{ padding: 16, display: "grid", gap: 6 }}>
            <span className="label-caps" style={{ display: "flex", alignItems: "center", gap: 6 }}><Hand size={12} /> Movement / falls</span>
            {latest?.movement ? (
              <div style={{ fontSize: 12.5 }}>{latest.movement.fallConfirmed ? "Fall event recorded (validated)" : latest.movement.fallSuspected ? "Suspected fall — pending validation" : "Activity: " + latest.movement.activityLevel}</div>
            ) : <div style={{ fontSize: 12.5, color: "var(--ink-4)" }}>MPU6050 not connected — no movement data. Cannot be inferred.</div>}
          </section>
        </div>
      </div>

      <section className="glass" style={{ overflow: "hidden" }}>
        <div style={{ padding: "14px 18px" }} className="row"><Bell size={14} color="var(--teal)" /><span className="label-caps">Alert history</span></div>
        {alerts && alerts.length > 0 ? (
          <table className="data-table">
            <thead><tr><th>When</th><th>Kind</th><th>Message</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id} style={{ cursor: "default" }}>
                  <td className="num">{new Date(a.timestamp).toLocaleString()}</td>
                  <td>{a.kind}</td>
                  <td style={{ maxWidth: 360 }}>{a.message}</td>
                  <td><StatusChip tone={a.status === "acknowledged" || a.status === "resolved" ? "ok" : a.status === "failed" ? "bad" : "warn"}>{a.status}</StatusChip></td>
                  <td>
                    {a.status === "created" || a.status === "delivered" ? (
                      <button className="btn ghost" style={{ padding: "6px 10px", fontSize: 12 }} onClick={async () => {
                        try { await layer.updateAlertStatus(a.id, patientId, "acknowledged"); pushToast("ok", "Alert acknowledged"); } catch (err) { pushToast("bad", `Acknowledge failed: ${err instanceof Error ? err.message : String(err)}`); }
                      }}>Acknowledge</button>
                    ) : a.status === "acknowledged" ? (
                      <button className="btn ghost" style={{ padding: "6px 10px", fontSize: 12 }} onClick={async () => {
                        try { await layer.updateAlertStatus(a.id, patientId, "resolved"); pushToast("ok", "Alert resolved"); } catch (err) { pushToast("bad", `Resolve failed: ${err instanceof Error ? err.message : String(err)}`); }
                      }}>Resolve</button>
                    ) : <span style={{ color: "var(--ink-4)" }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <EmptyState title="No alerts recorded" />}
      </section>

      {readings && readings.length > 0 && (
        <section className="glass">
          <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 8 }}><span className="label-caps">Stored waveform batches (freshest replayed above)</span></div>
          <table className="data-table">
            <thead><tr><th>When</th><th>BPM</th><th>Class</th><th>Quality</th><th>Source</th></tr></thead>
            <tbody>
              {readings.slice(-12).reverse().map((r) => (
                <tr key={r.id}>
                  <td className="num">{new Date(r.timestamp).toLocaleString()}</td>
                  <td className="num">{r.bpm ?? "—"}</td>
                  <td>{r.modelClass ?? "—"}</td>
                  <td>{r.signalQuality}</td>
                  <td>{r.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

