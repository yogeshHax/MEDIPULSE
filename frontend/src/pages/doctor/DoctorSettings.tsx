import { StatusChip } from "../../components/ui";
import type { DataLayer } from "../../lib/dataLayer";
import type { UserProfile } from "../../lib/schema";

export function DoctorSettings({
  profile, layer, connectionReason, onSignOut,
}: {
  profile: UserProfile;
  layer: DataLayer;
  connectionReason: string | null;
  onSignOut: () => void;
}) {
  return (
    <div style={{ display: "grid", gap: 18, maxWidth: 780 }}>
      <h1 className="h-page" style={{ fontSize: 26 }}>Clinician Settings</h1>
      <section className="glass" style={{ padding: 22, display: "grid", gap: 12 }}>
        <span className="label-caps">Account</span>
        <div style={{ fontWeight: 700 }}>{profile.name} — {profile.role}</div>
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{profile.email}</div>
        <StatusChip tone={profile.demo ? "warn" : "ok"}>{profile.demo ? "Demo session" : "Firebase Auth session"}</StatusChip>
        <button className="btn" style={{ justifySelf: "end" }} onClick={onSignOut}>Sign out</button>
      </section>
      <section className="glass" style={{ padding: 22, display: "grid", gap: 10 }}>
        <span className="label-caps">Deployment details</span>
        <div style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6 }}>
          Mode: <b>{layer.mode === "firebase" ? "Cloud Firestore" : "Local demo store"}</b>
          {connectionReason ? <span style={{ color: "var(--ink-4)" }}> — {connectionReason}</span> : null}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--ink-4)", lineHeight: 1.55 }}>
          Permissions: access is restricted to patients linked in <code>doctors/{profile.id}/assignments</code>;
          enforcement is in <code>firestore.rules</code>, never in the UI alone. See docs/firebase-setup.md.
        </div>
      </section>
    </div>
  );
}
