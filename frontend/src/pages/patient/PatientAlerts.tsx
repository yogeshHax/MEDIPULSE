import { useEffect, useState } from "react";
import { Bell, CircleAlert } from "lucide-react";
import { StatusChip, EmptyState, Modal } from "../../components/ui";
import { pushToast } from "../../components/ToastHost";
import type { DataLayer } from "../../lib/dataLayer";
import type { Alert } from "../../lib/schema";

const KIND_LABELS: Record<Alert["kind"], string> = {
  arrhythmia: "Arrhythmia-pattern alert",
  bradycardia: "Slow heart rate",
  tachycardia: "Elevated heart rate",
  fall: "Fall / impact",
  "manual-emergency": "Manual emergency request",
  "critical-ai": "Repeated abnormal AI classification",
};

export function PatientAlerts({ patientId, layer }: { patientId: string; layer: DataLayer }) {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitted" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    const unsub = layer.subscribeAlerts(patientId, (a) => {
      if (!cancelled) { setAlerts(a); setError(null); }
    }, 60);
    return () => { cancelled = true; unsub?.(); };
  }, [layer, patientId]);

  const sendEmergency = async () => {
    setEmergencyOpen(false);
    try {
      await layer.saveAlert({
        patientId,
        kind: "manual-emergency",
        message: `Manual emergency request from patient view at ${new Date().toLocaleTimeString()}. Written to the monitoring database only — no external notification provider configured.`,
        timestamp: Date.now(),
        status: "created",
        readingId: null,
        sourceKind: "manual",
        deliveryConfirmed: false,
      });
      setStatus("submitted");
      pushToast("ok", "Emergency request recorded — shown to your authorised care console");
    } catch (err) {
      setStatus("error");
      pushToast("bad", `Emergency request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <div>
          <h1 className="h-page" style={{ fontSize: 26 }}>Alerts <span className="accent">& Emergency</span></h1>
          <div className="label-caps" style={{ marginTop: 6 }}>AUTOMATIC ALERTS · MANUAL REQUESTS · ACK STATUS</div>
        </div>
        <span className="grow" />
        <button className="btn danger" onClick={() => setEmergencyOpen(true)}><CircleAlert size={16} /> Manual emergency request</button>
      </div>

      {status === "submitted" && <div className="info-note">Last emergency request submitted — awaiting acknowledgement from your care console. No external notification provider is configured; see docs/architecture.md §Alert delivery.</div>}
      {status === "error" && <div className="error-note">Emergency request failed to store — verify the database connection.</div>}
      {error && <div className="error-note">Could not load alerts: {error}</div>}

      {alerts != null && alerts.length === 0 && (
        <section className="glass"><EmptyState title="No alerts — and that's all we know" hint="Automatic alerts appear here when monitoring rules trigger; thresholds are code-visible monitoring heuristics, not clinical diagnoses" /></section>
      )}

      {alerts && alerts.length > 0 && (
        <section className="glass" style={{ overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 10 }}>
            <Bell size={14} color="var(--teal)" /><span className="label-caps">Alert history · newest first</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead><tr><th>When</th><th>Type</th><th>Message</th><th>Status</th><th>Source</th></tr></thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.id} style={{ cursor: "default" }}>
                    <td className="num">{new Date(a.timestamp).toLocaleString()}</td>
                    <td>{KIND_LABELS[a.kind]}</td>
                    <td style={{ maxWidth: 420 }}>{a.message}</td>
                    <td>
                      {a.status === "created" && <StatusChip tone="warn">Awaiting review</StatusChip>}
                      {a.status === "delivered" && <StatusChip tone="warn">Delivered</StatusChip>}
                      {a.status === "acknowledged" && <StatusChip tone="ok">Acknowledged{a.ackedBy ? ` · ${a.ackedBy}` : ""}</StatusChip>}
                      {a.status === "resolved" && <StatusChip tone="ok">Resolved</StatusChip>}
                      {a.status === "failed" && <StatusChip tone="bad">Failed</StatusChip>}
                    </td>
                    <td><StatusChip tone={a.sourceKind === "hardware" ? "ok" : "warn"}>{a.sourceKind}</StatusChip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Modal open={emergencyOpen} title="Confirm emergency request" onClose={() => setEmergencyOpen(false)}>
        <p style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.55, marginTop: 0 }}>
          Submits a <b>manual emergency request</b> visible to your authorised care console. In this build no
          SMS/telephony/emergency-services integration exists — the status you see reflects database lifecycle only.
        </p>
        <div className="row" style={{ marginTop: 14, justifyContent: "end" }}>
          <button className="btn ghost" onClick={() => setEmergencyOpen(false)}>Cancel</button>
          <button className="btn danger" onClick={sendEmergency}>Submit request</button>
        </div>
      </Modal>
    </div>
  );
}
