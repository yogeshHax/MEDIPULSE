import { NavLink, Outlet } from "react-router-dom";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Activity, Bell, Database, HeartPulse, History, Leaf, LogOut, Settings, Stethoscope, Users } from "lucide-react";
import type { ConnectionState } from "../lib/dataLayer";
import type { UserProfile } from "../lib/schema";
import { StatusChip } from "./ui";

export interface ShellNavItem { to: string; icon: LucideIcon; label: string; end?: boolean }

const patientNav: ShellNavItem[] = [
  { to: "/patient", icon: Activity, label: "Overview", end: true },
  { to: "/patient/monitoring", icon: HeartPulse, label: "Live Monitoring" },
  { to: "/patient/history", icon: History, label: "ECG History" },
  { to: "/patient/alerts", icon: Bell, label: "Alerts" },
  { to: "/patient/settings", icon: Settings, label: "Settings" },
];

const doctorNav: ShellNavItem[] = [
  { to: "/doctor", icon: Activity, label: "Overview", end: true },
  { to: "/doctor/patients", icon: Users, label: "Patients" },
  { to: "/doctor/monitoring", icon: HeartPulse, label: "Live Monitoring" },
  { to: "/doctor/alerts", icon: Bell, label: "Critical Alerts" },
  { to: "/doctor/settings", icon: Settings, label: "Settings" },
];

export function AppShell({
  role,
  profile,
  connection,
  onSignOut,
  topRight,
  children,
}: {
  role: "patient" | "doctor";
  profile: UserProfile;
  connection: ConnectionState;
  onSignOut: () => void;
  topRight?: ReactNode;
  children: ReactNode;
}) {
  const nav = role === "doctor" ? doctorNav : patientNav;
  return (
    <div className="app-shell">
      <nav className="nav-rail" aria-label="Primary">
        <div className="nav-logo" title="MediPulse"><HeartPulse size={20} /></div>
        <div className="nav-items">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`} aria-label={item.label}>
              <item.icon size={20} />
              <span className="nav-tip">{item.label}</span>
            </NavLink>
          ))}
        </div>
        <button className="nav-item" title="Sign out" aria-label="Sign out" onClick={onSignOut}><LogOut size={18} /></button>
        <div className="nav-avatar" title={profile.name}>{initials(profile.name)}</div>
      </nav>
      <div className="app-main">
        <header className="row" style={{ gap: 14 }}>
          <div className="grow">
            <div className="row" style={{ gap: 10 }}>
              <span className="label-caps" style={{ letterSpacing: 2.4 }}>MEDIPULSE</span>
              <span className="status-chip">{initials(profile.name)} · {profile.name}</span>
              {profile.demo ? <StatusChip tone="warn">Demo session</StatusChip> : <StatusChip tone="ok">Signed in</StatusChip>}
              <ConnectionChip connection={connection} />
            </div>
          </div>
          {topRight}
        </header>
        {connection === "demo" && <div className="info-note">Demo store is active (Firebase unreachable). All data shown is LOCAL SIMULATED data — not real clinical data.</div>}
        {connection === "error" && <div className="error-note">Database connection error — retry from Monitoring after checking your network and Firebase setup (docs/firebase-setup.md).</div>}
        {children}
      </div>
    </div>
  );
}

export function ConnectionChip({ connection }: { connection: ConnectionState }) {
  if (connection === "live") return <StatusChip tone="ok" pulse>Database live</StatusChip>;
  if (connection === "connecting") return <StatusChip pulse>Connecting…</StatusChip>;
  if (connection === "demo") return <StatusChip tone="warn">Demo store</StatusChip>;
  return <StatusChip tone="bad">Error</StatusChip>;
}

function initials(name: string) {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "MP";
}

export function SettingIcon({ size }: { size: number }) {
  return <Settings size={size} />;
}

export const RoleIcons = { Stethoscope, Leaf, Database };
