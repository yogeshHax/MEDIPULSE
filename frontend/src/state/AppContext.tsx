import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { chooseAdapter, type ConnectionState, type DataLayer } from "../lib/dataLayer";
import { loadPersistedDemo, signOutAll, type AuthIdentity } from "../lib/auth";
import type { UserProfile } from "../lib/schema";

interface AppState {
  identity: AuthIdentity | null;
  layer: DataLayer | null;
  connection: ConnectionState;
  connectionReason: string | null;
  setIdentity: (i: AuthIdentity | null) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [layer, setLayer] = useState<DataLayer | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [connectionReason, setReason] = useState<string | null>(null);
  const [identity, setIdentity] = useState<AuthIdentity | null>(() => {
    const demo = loadPersistedDemo();
    return demo ? { profile: demo, demo: true } : null;
  });

  useEffect(() => {
    let cancelled = false;
    chooseAdapter().then(({ layer: l, reason }) => {
      if (cancelled) return;
      setLayer(l);
      setConnection(l.mode === "firebase" ? "live" : "demo");
      setReason(reason);
      // If the app booted with a persisted demo profile but Firebase works, keep the demo
      // identity until they sign in properly — the UI still labels it.
    });
    return () => { cancelled = true; };
  }, []);

  // A page reload restores a demo session without re-sign-in, so signInDemo never
  // registered the profile in the demo store. (Re)saving is idempotent, registers
  // the user, and lets the demo layer seed a labelled history on first data touch.
  useEffect(() => {
    if (!layer || !identity?.demo) return;
    layer.saveUserProfile(identity.profile).catch(() => undefined);
  }, [layer, identity]);

  // The persisted demo profile is cleared on explicit sign-out (lib/auth.signOutAll),
  // not on mount — a page refresh must not silently end the session.

  const value = useMemo<AppState>(() => ({ identity, layer, connection, connectionReason, setIdentity }), [identity, layer, connection, connectionReason]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside provider");
  return v;
}

export async function handleSignOut(setIdentity: (p: UserProfile | null) => void) {
  await signOutAll();
  setIdentity(null);
}
