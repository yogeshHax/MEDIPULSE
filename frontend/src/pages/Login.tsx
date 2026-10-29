import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { HeartPulse, Activity, Stethoscope, ShieldCheck, TriangleAlert } from "lucide-react";
import { signInDemo, signInLive, registerLive } from "../lib/auth";
import { useApp } from "../state/AppContext";

export function LoginPage() {
  const { layer, connection, connectionReason, setIdentity } = useApp();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "register" | "demo">("demo");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"patient" | "doctor">("patient");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const proceed = (path: string) => {
    navigate(path, { replace: true });
  };

  const finish = (identity: NonNullable<import("../lib/auth").AuthIdentity>, path: string) => {
    setIdentity(identity);
    localStorage.setItem("medipulse-connection-reason", connectionReason ?? "");
    proceed(path);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (!layer) return;
      if (mode === "demo") {
        const out = await signInDemo(name, email, role, layer);
        if (out.ok && out.identity) {
          await layer.saveUserProfile({ ...out.identity.profile, demo: true }).catch(() => undefined);
          finish({ profile: out.identity.profile, demo: true }, role === "doctor" ? "/doctor" : "/patient");
        } else setError(out.error ?? "Demo sign-in failed");
      } else if (mode === "register") {
        if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
        const out = await registerLive(email, password, name, role, layer);
        if (out.ok && out.identity) finish({ profile: out.identity.profile, demo: false }, role === "doctor" ? "/doctor" : "/patient");
        else setError(out.error ?? "Registration failed");
      } else {
        const out = await signInLive(email, password, layer);
        if (out.ok && out.identity) {
          const path = out.identity.profile.role === "doctor" ? "/doctor" : "/patient";
          finish({ profile: out.identity.profile, demo: false }, path);
        } else setError(out.error ?? "Sign-in failed");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, position: "relative", zIndex: 1 }}>
      <div className="glass" style={{ maxWidth: 460, width: "100%", padding: "34px 34px 30px" }}>
        <div className="row" style={{ gap: 12, marginBottom: 6 }}>
          <div className="nav-logo"><HeartPulse size={20} /></div>
          <div>
            <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: -0.3 }}>MediPulse</div>
            <div className="label-caps">Cardiac Monitoring &amp; Emergency Response</div>
          </div>
        </div>

        <div role="tablist" aria-label="Sign-in mode" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, margin: "18px 0 16px" }}>
          {([["demo", "Demo"], ["signin", "Sign in"], ["register", "Register"]] as const).map(([m, label]) => (
            <button key={m} role="tab" aria-selected={mode === m} className={`btn ${mode === m ? "primary" : "ghost"}`} style={{ padding: "8px 6px", fontSize: 13 }} onClick={() => setMode(m)}>
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
          {mode === "demo" && (
            <div className="warn-note" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <TriangleAlert size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>Demo mode uses a <b>local, clearly-labelled simulated data store</b>. Use it only for evaluating the interface; nothing here is real clinical data.</span>
            </div>
          )}
          {mode === "register" && (
            <label className="label-caps" htmlFor="mp-name">
              Full name
              <input id="mp-name" className="text-input" style={{ marginTop: 6 }} required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Elena Rossi" autoComplete="name" />
            </label>
          )}
          <label className="label-caps" htmlFor="mp-email">
            Email
            <input id="mp-email" className="text-input" style={{ marginTop: 6 }} type="email" required={mode !== "demo"} value={email} onChange={(e) => setEmail(e.target.value)} placeholder={mode === "demo" ? "optional in demo mode" : "you@example.com"} autoComplete="email" />
          </label>
          {mode !== "demo" && (
            <label className="label-caps" htmlFor="mp-pass">
              Password
              <input id="mp-pass" className="text-input" style={{ marginTop: 6 }} type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete={mode === "register" ? "new-password" : "current-password"} />
            </label>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button type="button" onClick={() => setRole("patient")} className={`btn ${role === "patient" ? "primary" : "ghost"}`} style={{ padding: "10px 8px" }}>
              <Activity size={16} /> Patient
            </button>
            <button type="button" onClick={() => setRole("doctor")} className={`btn ${role === "doctor" ? "primary" : "ghost"}`} style={{ padding: "10px 8px" }}>
              <Stethoscope size={16} /> Clinician
            </button>
          </div>
          {error && <div className="error-note" role="alert">{error}</div>}
          {!layer && <div className="info-note" role="status">Still connecting to the data layer — you can sign in the moment it resolves (or times out to demo store).</div>}
          <button className="btn primary" style={{ padding: 14 }} disabled={busy || !layer} type="submit">
            <ShieldCheck size={17} />
            {mode === "demo" ? "Enter demo dashboard" : mode === "register" ? "Create account" : "Sign in"}
          </button>
        </form>

        <div style={{ marginTop: 16, fontSize: 12, color: "var(--ink-4)", lineHeight: 1.5 }}>
          {connection === "live"
            ? "Firebase project connected. Accounts authenticate with Firebase Auth; data access is governed by firestore.rules."
            : connection === "connecting"
              ? "Checking Firebase connectivity…"
              : <span>Firebase not reachable ({connectionReason ?? "offline"}). You can still explore in demo mode — instructions to enable live data are in <code>docs/firebase-setup.md</code>.</span>}
        </div>
      </div>
    </div>
  );
}
