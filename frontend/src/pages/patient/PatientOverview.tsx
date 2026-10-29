import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, CalendarClock, Radio, Signal, TrendingUp, Video } from "lucide-react";
import { StatusChip } from "../../components/ui";
import { EcgChart } from "../../components/EcgChart";
import { EcgBuffer } from "../../lib/monitor";
import { EcgSimulator } from "../../lib/ecgSignal";
import type { ConnectionState, DataLayer } from "../../lib/dataLayer";
import { ECG_CLASS_LABELS } from "../../lib/schema";
import type { Alert, Reading } from "../../lib/schema";

export function PatientOverview({
  patientId, layer, connection, profileName,
}: {
  patientId: string;
  layer: DataLayer;
  connection: ConnectionState;
  profileName: string;
}) {
  // Lazily import the 3D scene (own chunk) so the dashboard paints before Three.js loads.
  const Heart3D = useMemo(
    () => lazy(() => import("../../components/HeartScene").then((m) => ({ default: m.HeartScene }))),
    [],
  );
  const [readings, setReadings] = useState<Reading[] | null>(null);
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    layer.listReadings(patientId, 50)
      .then((r) => { if (!cancelled) { setReadings(r); setDbError(null); } })
      .catch((e) => { if (!cancelled) setDbError(e instanceof Error ? e.message : String(e)); });
    // Live updates: a new reading from the device/bridge must move this dashboard.
    const unsubReadings = layer.subscribeReadings(patientId, (r) => {
      if (!cancelled) { setReadings(r); setDbError(null); }
    }, 50);
    const unsubAlerts = layer.subscribeAlerts(patientId, (a) => { if (!cancelled) setAlerts(a); }, 20);
    return () => { cancelled = true; unsubReadings?.(); unsubAlerts?.(); };
  }, [layer, patientId]);

  const latest = readings?.length ? readings[readings.length - 1] : null;
  const bpm = latest?.bpm ?? null;
  const cls = latest?.modelClass ?? null;
  const risk = latest?.riskScore ?? null;
  const openAlerts = (alerts ?? []).filter((a) => a.status === "created" || a.status === "delivered");
  const sourceLabel = latest ? (latest.source === "demo" ? "Demo data" : latest.source === "hardware" ? "Live hardware" : "Imported/manual") : "No readings yet";

  const calendar = useMemo(() => {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const offset = first.getDay();
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return { today: now.getDate(), offset, days, label: now.toLocaleString(undefined, { month: "short", year: "numeric" }) };
  }, []);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.35fr) minmax(0,1fr)", gap: 18 }} className="ov-grid">
        <section className="glass" style={{ padding: "26px 30px 18px", position: "relative", overflow: "hidden", minHeight: 470 }}>
          <div style={{ position: "relative", zIndex: 2 }}>
            <h1 className="h-page">Overview<br /><span className="accent">Cardiac Health</span></h1>
            <p className="sub-line">Monitoring {connection === "live" ? "your registered" : "a demo"} profile for <b style={{ color: "var(--ink-1)" }}>{profileName}</b>.</p>
          </div>
          <div style={{ position: "absolute", inset: 0, zIndex: 1, opacity: 0.95 }}>
            <Suspense fallback={<div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}><div className="skeleton" style={{ width: 220, height: 220, borderRadius: "50%" }} /></div>}>
              <Heart3D bpm={bpm} height="100%" />
            </Suspense>
          </div>
          {/* floating chips around the organ */}
          <div style={{ position: "absolute", left: 26, bottom: 88, zIndex: 2 }} className="glass-soft" aria-label="Heart rhythm">
            <div className="label-caps" style={{ padding: "10px 14px 0" }}>Rhythm</div>
            <div style={{ padding: "2px 14px 10px", color: cls === null ? "var(--ink-3)" : cls === "N" ? "var(--phosphor)" : "var(--amber)", fontWeight: 700, fontSize: 15 }}>
              {cls ? ECG_CLASS_LABELS[cls] : "Awaiting classification"}
            </div>
          </div>
          <div style={{ position: "absolute", right: 24, top: 120, zIndex: 2 }} className="glass-soft">
            <div style={{ padding: "10px 14px 10px", display: "grid", gap: 3 }}>
              <span className="label-caps">Risk score</span>
              <span style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 22, color: risk == null ? "var(--ink-3)" : risk > 66 ? "var(--red)" : risk > 40 ? "var(--amber)" : "var(--phosphor)" }}>
                {risk == null ? "—" : risk.toString()}
              </span>
              <span style={{ fontSize: 10.5, color: "var(--ink-4)" }}>Experimental indicator</span>
            </div>
          </div>
          <div style={{ position: "absolute", left: 26, bottom: 20, right: 24, zIndex: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <StatusChip tone={latest?.source === "hardware" ? "ok" : "warn"} pulse={latest?.source === "hardware"}>{sourceLabel}</StatusChip>
            {latest && <StatusChip tone={latest.signalQuality === "good" ? "ok" : latest.signalQuality === "poor" ? "bad" : "warn"}>{latest.signalQuality} signal</StatusChip>}
            {dbError && <StatusChip tone="bad">Database error</StatusChip>}
          </div>
        </section>

        <div style={{ display: "grid", gap: 18, alignContent: "start" }}>
          <section className="glass tile-bpm">
            <div className="row"><span className="label-caps">Current heart rate</span><span className="grow" /><Activity size={15} color="var(--teal)" /></div>
            <div className="bpm-val">{bpm ?? "—"}<span className="unit">BPM</span></div>
            <div style={{ fontSize: 12.5, color: "var(--ink-4)" }}>
              {latest ? `Last reading ${new Date(latest.timestamp).toLocaleTimeString()}` : "Start Live Monitoring to record"} · {sourceLabel}
            </div>
          </section>

          <section className="glass" style={{ padding: 20, display: "grid", gap: 12 }}>
            <div className="row"><span className="label-caps">Connection &amp; data</span><span className="grow" /><Signal size={14} color="var(--teal)" /></div>
            <StatusChip tone={connection === "live" ? "ok" : "warn"}>{connection === "live" ? "Cloud Firestore connected" : "Local demo store"}</StatusChip>
            <StatusChip tone={(latest ?? null) == null ? "warn" : "ok"}>Device status: {latest ? (latest.source === "hardware" ? "ESP32 link" : "simulated sensor") : "no device configured"}</StatusChip>
          </section>

          <section className="glass" style={{ padding: 20 }}>
            <div className="row" style={{ marginBottom: 12 }}>
              <span className="label-caps">{calendar.label}</span><span className="grow" /><CalendarClock size={14} color="var(--teal)" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-4)", marginBottom: 4 }}>
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} style={{ textAlign: "center" }}>{d}</div>)}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
              {Array.from({ length: calendar.offset }).map((_, i) => <div key={`e${i}`} />)}
              {Array.from({ length: calendar.days }).map((_, i) => (
                <div key={i} style={{
                  textAlign: "center", padding: "6px 0", borderRadius: 8,
                  fontFamily: "var(--mono)", fontSize: 11.5,
                  background: i + 1 === calendar.today ? "linear-gradient(135deg, rgba(45,212,191,.25), rgba(45,212,191,.08))" : "rgba(160,195,220,.04)",
                  color: i + 1 === calendar.today ? "var(--ink-1)" : "var(--ink-3)",
                  fontWeight: i + 1 === calendar.today ? 700 : 400,
                }}>{i + 1}</div>
              ))}
            </div>
          </section>

          <section className="glass-soft" style={{ padding: 18, display: "flex", gap: 14, alignItems: "center" }}>
            <div className="nav-avatar" style={{ width: 46, height: 46 }}><Video size={17} /></div>
            <div className="grow">
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>Weekly cardiology review</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-4)" }}>Unconfirmed appointment slot — sample scheduling UI state</div>
            </div>
            <Link to="/patient/alerts" className="btn ghost" style={{ padding: "8px 12px", fontSize: 12.5 }}>Review</Link>
          </section>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 18 }} className="ov-grid">
        <StatCard label="Readings stored" value={String(readings?.length ?? 0)} to="/patient/history" icon={<Radio size={15} />} />
        <StatCard label="Open alerts" value={String(openAlerts.length)} tone={openAlerts.length ? "bad" : "ok"} to="/patient/alerts" icon={<TrendingUp size={15} />} />
        <StatCard label="Data source" value={sourceLabel} icon={<Signal size={15} />} />
      </div>

      <AmbientSweep baseBpm={latest?.bpm ?? null} />
    </div>
  );
}

/**
 * Ambient rhythm preview: a permanently-running phosphor ECG strip driven by the
 * demo signal generator. Never stored as readings — purely visual so the overview
 * feels alive before the user starts a monitored session.
 */
function AmbientSweep({ baseBpm }: { baseBpm: number | null }) {
  const sim = useMemo(() => new EcgSimulator(baseBpm ?? 74), []);
  const buffer = useMemo(() => new EcgBuffer(6000, 250), []);
  const [displayBpm, setDisplayBpm] = useState(baseBpm ?? 74);

  // Re-anchor the sim when a fresh reading arrives (keeps the sweep in step
  // with the patient's recorded HR without re-creating the generator).
  useEffect(() => {
    const anchor = baseBpm ?? 74;
    sim.setBpm(anchor);
    setDisplayBpm(anchor);
  }, [baseBpm, sim]);

  useEffect(() => {
    const push = window.setInterval(() => {
      buffer.push(sim.next(50, 250)); // 250 Hz × 0.2 s per tick
    }, 200);
    // Gentle random walk so the readout breathes like a resting patient.
    const wander = window.setInterval(() => {
      setDisplayBpm((prev) => {
        const next = Math.max(62, Math.min(96, Math.round(prev + (Math.random() - 0.5) * 6)));
        sim.setBpm(next);
        return next;
      });
    }, 4200);
    return () => { window.clearInterval(push); window.clearInterval(wander); };
  }, [sim, buffer]);

  return (
    <section className="glass" style={{ padding: "16px 18px 14px", display: "grid", gap: 10 }}>
      <div className="row">
        <span className="label-caps" style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <Activity size={15} color="var(--teal)" /> Live rhythm preview
        </span>
        <span className="grow" />
        <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-4)" }}>250 Hz · 6 s sweep</span>
        <StatusChip tone="warn" pulse>Demo sweep</StatusChip>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "110px minmax(0,1fr)", gap: 18, alignItems: "center" }} className="sweep-grid">
        <div>
          <div style={{ fontSize: 34, fontWeight: 800, fontFamily: "var(--mono)", color: "var(--phosphor)", lineHeight: 1 }}>
            {displayBpm}<span style={{ fontSize: 11, marginLeft: 6, color: "var(--ink-4)" }}>BPM</span>
          </div>
          <div className="label-caps" style={{ marginTop: 6, color: "var(--ink-4)" }}>Simulated lead II</div>
        </div>
        <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid rgba(70,240,155,0.12)", background: "#010405" }}>
          <EcgChart buffer={buffer} samplesPerSecond={250} active height={92} gain={190} />
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--ink-4)" }}>
        Ambient visualization from the demo signal generator — synthetic samples, never stored as readings.
      </div>
    </section>
  );
}

function StatCard({ label, value, icon, to, tone }: { label: string; value: string; icon: React.ReactNode; to?: string; tone?: "ok" | "bad" }) {
  const inner = (
    <div style={{ display: "grid", gap: 6 }}>
      <span className="label-caps" style={{ display: "flex", alignItems: "center", gap: 7 }}>{icon}{label}</span>
      <span style={{ fontSize: 19, fontWeight: 700, color: tone === "bad" ? "var(--red)" : tone === "ok" ? "var(--phosphor)" : "var(--ink-1)" }}>{value}</span>
    </div>
  );
  return to
    ? <Link to={to} className="glass" style={{ padding: 18, textDecoration: "none", color: "inherit" }}>{inner}</Link>
    : <div className="glass" style={{ padding: 18 }}>{inner}</div>;
}
