import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { StatusChip, EmptyState } from "../../components/ui";
import { pushToast } from "../../components/ToastHost";
import type { DataLayer } from "../../lib/dataLayer";
import type { Alert } from "../../lib/schema";

export function DoctorAlerts({ doctorId, layer }: { doctorId: string; layer: DataLayer }) {
  const navigate = useNavigate();
  const [patients, setPatients] = useState<{ patientId: string; name: string }[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const subsRef = useRef<Array<() => void>>([]);
  const [statusFilter, setStatusFilter] = useState<"open" | "all">("open");

  useEffect(() => {
    let cancelled = false;
    layer.listAssignedPatients(doctorId).then((ps) => {
      if (cancelled) return;
      setPatients(ps.map((p) => ({ patientId: p.patientId, name: p.name })));
      for (const p of ps) {
        const un = layer.subscribeAlerts(p.patientId, (a) => {
          if (cancelled) return;
          setAlerts((prev) => [...prev.filter((x) => x.patientId !== p.patientId), ...a]);
        }, 80);
        subsRef.current.push(un ?? (() => undefined));
      }
    }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; subsRef.current.splice(0).forEach((u) => u()); };
  }, [doctorId, layer]);

  const nameOf = (pid: string) => patients.find((p) => p.patientId === pid)?.name ?? pid;
  const shown = alerts.filter((a) => statusFilter === "all" ? true : a.status === "created" || a.status === "delivered");
  const openCount = alerts.filter((a) => a.status === "created" || a.status === "delivered").length;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <div>
          <h1 className="h-page" style={{ fontSize: 26 }}>Critical Alerts <span className="accent">Console</span></h1>
          <div className="label-caps" style={{ marginTop: 4 }}>CONSOLIDATED · ACKNOWLEDGE / RESOLVE LIFECYCLE</div>
        </div>
        <span className="grow" />
        <button className="btn ghost" style={{ fontSize: 13 }} onClick={() => setStatusFilter(statusFilter === "open" ? "all" : "open")}>
          {statusFilter === "open" ? `Showing ${openCount} open` : "Showing all statuses"}
        </button>
      </div>

      {error && <div className="error-note">Alert console error: {error}</div>}

      {alerts.length === 0 ? (
        <section className="glass"><EmptyState title="No alerts across your assigned patients" hint="Generated alerts are consolidated here with their supporting reading reference" /></section>
      ) : (
        <section className="glass" style={{ overflow: "hidden" }}>
          <table className="data-table">
            <thead><tr><th>Patient</th><th>Type</th><th>When</th><th>Message</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {shown.sort((a, b) => b.timestamp - a.timestamp).map((a) => (
                <tr key={a.id}>
                  <td onClick={() => navigate(`/doctor/patients/${a.patientId}`)} style={{ fontWeight: 700 }}>{nameOf(a.patientId)}</td>
                  <td>{a.kind}</td>
                  <td className="num">{new Date(a.timestamp).toLocaleString()}</td>
                  <td style={{ maxWidth: 340 }}>{a.message}</td>
                  <td><StatusChip tone={a.status === "acknowledged" || a.status === "resolved" ? "ok" : a.status === "failed" ? "bad" : "warn"}>{a.status}</StatusChip></td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      {(a.status === "created" || a.status === "delivered") && (
                        <button className="btn ghost" style={{ padding: "6px 10px", fontSize: 12 }} onClick={async () => {
                          try {
                            await layer.updateAlertStatus(a.id, a.patientId, "acknowledged");
                            pushToast("ok", "Alert acknowledged — it moves out of the open queue into history");
                          } catch (err) { pushToast("bad", `Acknowledge failed: ${err instanceof Error ? err.message : String(err)}`); }
                        }}>Acknowledge</button>
                      )}
                      {a.status === "acknowledged" && (
                        <button className="btn ghost" style={{ padding: "6px 10px", fontSize: 12 }} onClick={async () => {
                          try {
                            await layer.updateAlertStatus(a.id, a.patientId, "resolved");
                            pushToast("ok", "Alert resolved");
                          } catch (err) { pushToast("bad", `Resolve failed: ${err instanceof Error ? err.message : String(err)}`); }
                        }}>Resolve</button>
                      )}
                      <button className="btn ghost" style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => navigate(`/doctor/patients/${a.patientId}`)}>Open record</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

