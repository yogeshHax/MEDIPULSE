import { useEffect, useState } from "react";
import { StatusChip } from "../../components/ui";
import type { DataLayer } from "../../lib/dataLayer";
import type { UserProfile } from "../../lib/schema";

export function PatientSettings({
  profile, layer, connectionReason, onSignOut,
}: {
  profile: UserProfile;
  layer: DataLayer;
  connectionReason: string | null;
  onSignOut: () => void;
}) {
  const [stored, setStored] = useState<number | null>(null);
  useEffect(() => {
    if (layer.mode === "demo") {
      const key = "medipulse-demo-store-v1";
      try {
        const raw = localStorage.getItem(key);
        setStored(raw ? new Blob([raw]).size : 0);
      } catch { setStored(null); }
    }
  }, [layer]);

  return (
    <div style={{ display: "grid", gap: 18, maxWidth: 780 }}>
      <h1 className="h-page" style={{ fontSize: 26 }}>Settings <span className="accent">& Data</span></h1>

      <section className="glass" style={{ padding: 22, display: "grid", gap: 12 }}>
        <span className="label-caps" style={{ display: "flex", alignItems: "center", gap: 7 }}>Profile</span>
        <div style={{ display: "flex", gap: 14 }} className="row">
          <div className="nav-avatar" style={{ width: 48, height: 48 }}>{profile.name.slice(0, 1).toUpperCase()}</div>
          <div>
            <div style={{ fontWeight: 700 }}>{profile.name}</div>
            <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{profile.email} · {profile.role}</div>
          </div>
        </div>
        <StatusChip tone={profile.demo ? "warn" : "ok"}>{profile.demo ? "Demo session (local)" : "Firebase Auth session"}</StatusChip>
        <button className="btn" style={{ justifySelf: "end" }} onClick={onSignOut}>Sign out</button>
      </section>

      <section className="glass" style={{ padding: 22, display: "grid", gap: 10 }}>
        <span className="label-caps">Data source</span>
        <div style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
          <div>Mode: <b>{layer.mode === "firebase" ? "Cloud Firestore (supplied project)" : "Local demo store"}</b></div>
          {connectionReason && <div style={{ color: "var(--ink-4)", marginTop: 4 }}>{connectionReason}</div>}
          {stored != null && <div style={{ color: "var(--ink-4)", marginTop: 4 }}>Local store size: {(stored / 1024).toFixed(1)} KB (demo data only — safely deletable from browser storage)</div>}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--ink-4)", lineHeight: 1.55 }}>
          Live-mode configuration guide, schema and security rules: <code>docs/firebase-setup.md</code>.
        </div>
      </section>

      <section className="glass" style={{ padding: 22, display: "grid", gap: 10 }}>
        <span className="label-caps">Hardware device</span>
        <div style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6 }}>
          Expected device: <b>AD8232 single-lead ECG</b> (via ESP32-class bridge) with optional <b>MPU6050</b> movement.
          The app consumes `hardware-telemetry` window events with raw samples at 250 Hz; see
          <code> docs/hardware-integration.md</code> for the publish contract.
        </div>
        <StatusChip tone="warn">No device detected in this session</StatusChip>
      </section>
    </div>
  );
}
