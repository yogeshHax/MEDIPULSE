import { StrictMode, useEffect } from "react";
import ReactDOM from "react-dom/client";
import "./styles/global.css";
import { createBrowserRouter, RouterProvider, Navigate, Outlet, useNavigate, useParams } from "react-router-dom";
import { AppProvider, useApp } from "./state/AppContext";
import { signOutAll } from "./lib/auth";
import { LoginPage } from "./pages/Login";
import { AppShell } from "./components/AppShell";
import { ToastHost } from "./components/ToastHost";
import { PatientOverview } from "./pages/patient/PatientOverview";
import { PatientMonitoring } from "./pages/patient/PatientMonitoring";
import { HistoryPage } from "./pages/patient/History";
import { PatientAlerts } from "./pages/patient/PatientAlerts";
import { PatientSettings } from "./pages/patient/PatientSettings";
import { DoctorOverview } from "./pages/doctor/DoctorOverview";
import { DoctorPatients } from "./pages/doctor/DoctorPatients";
import { DoctorPatientDetail } from "./pages/doctor/DoctorPatientDetail";
import { DoctorAlerts } from "./pages/doctor/DoctorAlerts";
import { DoctorSettings } from "./pages/doctor/DoctorSettings";
import { ConnectionChip } from "./components/AppShell";

/**
 * Route guard: unauthenticated users land on /login; role mismatches bounce to the
 * matching dashboard. Authorization for DATA is enforced server-side (Firestore
 * rules) — this guard only routes the UI, per docs/architecture.md.
 */
function ShellLayout({ role }: { role: "patient" | "doctor" }) {
  const { identity, layer, connection, connectionReason } = useApp();
  const navigate = useNavigate();
  useEffect(() => {
    if (!identity) navigate("/login", { replace: true });
    else if (identity.profile.role !== role) navigate(identity.profile.role === "doctor" ? "/doctor" : "/patient", { replace: true });
  }, [identity, role, navigate]);
  if (!identity || !layer || identity.profile.role !== role) return null;
  return (
    <AppShell
      role={role}
      profile={identity.profile}
      connection={connection}
      onSignOut={async () => {
        await signOutAll();
        navigate("/login", { replace: true });
        location.reload();
      }}
      topRight={<TopRight />}
    >
      <Outlet />
      <div style={{ marginTop: 22, fontSize: 10.5, color: "var(--ink-4)", textAlign: "center" }}>
        Data layer: {layer.mode}{connectionReason ? ` — ${connectionReason}` : ""}
      </div>
    </AppShell>
  );
}

function TopRight() {
  const { connection } = useApp();
  return (
    <div className="row" style={{ gap: 10 }}>
      <ConnectionChip connection={connection} />
    </div>
  );
}

/** Patient routing uses the signed-in identity id as the patient tree key (demo + live agree). */
function patientIdOf(profileId: string) {
  return profileId;
}

function Router() {
  const { identity } = useApp();
  const router = createBrowserRouter([
    { path: "/", element: <Navigate to={identity ? (identity.profile.role === "doctor" ? "/doctor" : "/patient") : "/login"} replace /> },
    { path: "/login", element: identity ? <Navigate to={identity.profile.role === "doctor" ? "/doctor" : "/patient"} replace /> : <LoginPage /> },
    {
      path: "/patient",
      element: <ShellLayout role="patient" />,
      children: [
        { index: true, element: <PatientOverviewRoute /> },
        { path: "monitoring", element: <PatientMonitoringRoute /> },
        { path: "history", element: <HistoryRoute /> },
        { path: "alerts", element: <PatientAlertsRoute /> },
        { path: "settings", element: <PatientSettingsRoute /> },
      ],
    },
    {
      path: "/doctor",
      element: <ShellLayout role="doctor" />,
      children: [
        { index: true, element: <DoctorOverviewRoute /> },
        { path: "patients", element: <DoctorPatientsRoute /> },
        { path: "patients/:patientId", element: <DoctorPatientDetailRoute /> },
        { path: "alerts", element: <DoctorAlertsRoute /> },
        { path: "monitoring", element: <Navigate to="/doctor/patients" replace /> },
        { path: "settings", element: <DoctorSettingsRoute /> },
      ],
    },
    { path: "*" , element: <Navigate to="/" replace /> },
  ]);
  return <RouterProvider router={router} />;
}

/* Route wrappers read the context so the router tree stays static. */
function usePatientLayer() {
  const { identity, layer } = useApp();
  if (!identity || !layer) throw new Error("not signed in");
  return { patientId: patientIdOf(identity.profile.id), layer };
}

function PatientOverviewRoute() {
  const { patientId, layer } = usePatientLayer();
  const { identity, connection, connectionReason } = useApp();
  if (!identity) return null;
  return <PatientOverview patientId={patientId} layer={layer} connection={connection} profileName={identity.profile.name} />;
}

function PatientMonitoringRoute() {
  const { patientId, layer } = usePatientLayer();
  return <PatientMonitoring patientId={patientId} layer={layer} />;
}

function HistoryRoute() {
  const { patientId, layer } = usePatientLayer();
  return <HistoryPage patientId={patientId} layer={layer} />;
}

function PatientAlertsRoute() {
  const { patientId, layer } = usePatientLayer();
  return <PatientAlerts patientId={patientId} layer={layer} />;
}

function PatientSettingsRoute() {
  const { layer, identity, connectionReason } = useApp();
  if (!identity || !layer) return null;
  return <PatientSettings profile={identity.profile} layer={layer} connectionReason={connectionReason} onSignOut={async () => { await signOutAll(); location.href = "/login"; }} />;
}

function DoctorOverviewRoute() {
  const { identity, layer } = useApp();
  if (!identity || !layer) return null;
  return <DoctorOverview doctorId={identity.profile.id} layer={layer} />;
}

function DoctorPatientsRoute() {
  const { identity, layer } = useApp();
  if (!identity || !layer) return null;
  return <DoctorPatients doctorId={identity.profile.id} layer={layer} />;
}

function DoctorPatientDetailRoute() {
  const { layer } = useApp();
  const route = useParams();
  if (!layer) return null;
  return <DoctorPatientDetail patientId={route.patientId ?? ""} layer={layer} />;
}

function DoctorAlertsRoute() {
  const { identity, layer } = useApp();
  if (!identity || !layer) return null;
  return <DoctorAlerts doctorId={identity.profile.id} layer={layer} />;
}

function DoctorSettingsRoute() {
  const { identity, layer, connectionReason } = useApp();
  if (!identity || !layer) return null;
  return <DoctorSettings profile={identity.profile} layer={layer} connectionReason={connectionReason} onSignOut={async () => { await signOutAll(); location.href = "/login"; }} />;
}

function Root() {
  return (
    <AppProvider>
      <ToastHost />
      <Router />
    </AppProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
