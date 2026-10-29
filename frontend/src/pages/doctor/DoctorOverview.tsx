import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Users, Bell, HeartPulse, ShieldCheck, Activity } from "lucide-react";
import { StatusChip, EmptyState } from "../../components/ui";
import type { DataLayer } from "../../lib/dataLayer";
import type { Alert, PatientRegistryEntry, Reading } from "../../lib/schema";

export function DoctorOverview({ doctorId, layer }: { doctorId: string; layer: DataLayer }) {
  const navigate = useNavigate();
  const [patients, setPatients] = useState<PatientRegistryEntry[] | null>(null);
  const [alertsByPatient, setAlertsByPatient] = useState<Record<string, Alert[]>>({});
  const [readingsHint, setReadingsHint] = useState<Record<string, Reading[]>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    layer.listAssignedPatients(doctorId).then((ps) => {
      if (cancelled) return;
      setPatients(ps);
      for (const p of ps) {
        layer.subscribeAlerts(p.patientId, (alerts) => {
          if (!cancelled) setAlertsByPatient((prev) => ({ ...prev, [p.patientId]: alerts }));
        }, 40);
        layer.subscribeReadings(p.patientId, (rs) => {
          if (!cancelled) setReadingsHint((prev) => ({ ...prev, [p.patientId]: rs }));
        }, 10);
      }
    }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [doctorId, layer]);

  const total = patients?.length ?? 0;
  const recentReadings = (patients ?? []).filter((p) => (readingsHint[p.patientId]?.length ?? 0) > 0).length;
  const openAlerts = Object.values(alertsByPatient).flat().filter((a) => a.status === "created" || a.status === "delivered");
  const criticalRecent = Object.values(alertsByPatient).flat().filter((a) => a.kind === "fall" || a.kind === "critical-ai").slice(0, 5);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div>
        <h1 className="h-page">Clinical Overview <span className="accent">· Care Console</span></h1>
        <p className="sub-line">Population metrics come from the live data layer only — this dashboard never embellishes its counts.</p>
      </div>

      {error && <div className="error-note">Could not load the roster: {error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 16 }} className="doc-stats">
        <Metric label="Assigned patients" value={String(total)} icon={<Users size={15} />} />
        <Metric label="Patients monitored (data received)" value={String(recentReadings)} icon={<HeartPulse size={15} />} />
        <Metric label="Alerts awaiting review" value={String(openAlerts.length)} tone={openAlerts.length ? "bad" : "ok"} icon={<Bell size={15} />} />
        <Metric label="Data layer" value={layer.mode === "firebase" ? "Firestore" : "Demo store"} muted icon={<ShieldCheck size={15} />} />
      </div>

      {criticalRecent.length > 0 ? (
        <section className="glass" style={{ overflow: "hidden" }}>
          <div style={{ padding: "14px 18px" }} className="row"><Activity size={14} color="var(--teal)" /><span className="label-caps">Recent concerning events</span></div>
          <table className="data-table">
            <thead><tr><th>Patient</th><th>Kind</th><th>Message</th><th>When</th></tr></thead>
            <tbody>
              {criticalRecent.map((a) => {
                const p = patients?.find((x) => x.patientId === a.patientId);
                return (
                  <tr key={a.id} onClick={() => navigate(`/doctor/patients/${a.patientId}`)} title="Open patient record">
                    <td>{p?.name ?? a.patientId}</td>
                    <td>{a.kind}</td>
                    <td style={{ maxWidth: 380 }}>{a.message}</td>
                    <td className="num">{new Date(a.timestamp).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : (
        <section className="glass"><EmptyState title="No concerning events recorded" hint="Fall / repeated-abnormality alerts from your assigned patients will appear here" /></section>
      )}

      {patients && patients.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
          {patients.slice(0, 6).map((p) => {
            const latest = readingsHint[p.patientId]?.slice(-1)[0];
            const open = alertsByPatient[p.patientId]?.filter((a) => a.status === "created" || a.status === "delivered").length ?? 0;
            return (
              <Link key={p.patientId} to={`/doctor/patients/${p.patientId}`} className="glass-soft" style={{ padding: 16, textDecoration: "none", color: "inherit", display: "grid", gap: 8 }}>
                <div className="row">
                  <div className="nav-avatar" style={{ width: 34, height: 34, fontSize: 12 }}>{p.name.slice(0, 1)}</div>
                  <div className="grow">
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{latest ? `BPM ${latest.bpm ?? "—"} · ${new Date(latest.timestamp).toLocaleString()}` : "No readings"}</div>
                  </div>
                  {open > 0 && <StatusChip tone="bad">{open} open</StatusChip>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, icon, tone, muted }: { label: string; value: string; icon: React.ReactNode; tone?: "ok" | "bad"; muted?: boolean }) {
  return (
    <div className="glass" style={{ padding: 18, display: "grid", gap: 7 }}>
      <span className="label-caps" style={{ display: "flex", alignItems: "center", gap: 7 }}>{icon}{label}</span>
      <span style={{ fontSize: 24, fontWeight: 800, fontFamily: "var(--mono)", color: tone === "bad" ? "var(--red)" : tone === "ok" ? "var(--phosphor)" : muted ? "var(--ink-3)" : "var(--ink-1)" }}>{value}</span>
    </div>
  );
}
