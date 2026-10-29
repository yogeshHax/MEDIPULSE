/**
 * Authentication service.
 *
 * Production path: Firebase Authentication (email/password) with the user's role
 * stored in Cloud Firestore `users/{uid}` — permissions are enforced by
 * `firestore.rules`, never by client checks alone (docs/firebase-setup.md).
 *
 * Demo path: when Firebase is unreachable/denied, a clearly-labelled local demo
 * profile is used; every screen announces `DEMO SESSION` in the UI.
 */
import {
  createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  type User,
} from "firebase/auth";
import { getFirebaseAuth } from "./firebase";
import type { UserProfile } from "./schema";
import type { DataLayer } from "./dataLayer";

const DEMO_SESSION_KEY = "medipulse-demo-user-v1";

export interface AuthIdentity {
  profile: UserProfile;
  demo: boolean;
}

export interface AuthOutcome {
  ok: boolean;
  identity?: AuthIdentity;
  error?: string;
  /** Extra setup guidance when Firestore rules deny access. */
  setupHint?: string;
}

export async function registerLive(
  email: string, password: string, name: string, role: "patient" | "doctor", layer: DataLayer,
): Promise<AuthOutcome> {
  const auth = getFirebaseAuth();
  if (!auth) return { ok: false, error: "Firebase Auth unavailable" };
  try {
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const profile: UserProfile = {
      id: cred.user.uid, name: name.trim(), email: email.trim(), role, createdAt: Date.now(), demo: false,
    };
    try {
      await layer.saveUserProfile(profile);
    } catch (err) {
      return {
        ok: true, identity: { profile, demo: false },
        setupHint: `Signed in with Firebase Auth, but saving the profile failed (${err instanceof Error ? err.message : String(err)}). Deploy the Firestore rules from firestore.rules (docs/firebase-setup.md).`,
      };
    }
    return { ok: true, identity: { profile, demo: false } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function signInLive(
  email: string, password: string, layer: DataLayer,
): Promise<AuthOutcome> {
  const auth = getFirebaseAuth();
  if (!auth) return { ok: false, error: "Firebase Auth unavailable" };
  try {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    let profile = await layer.getUserProfile(cred.user.uid);
    if (!profile) {
      // Authenticated but profile absent — derive a placeholder role until rules let us write one.
      profile = { id: cred.user.uid, name: email.split("@")[0], email: cred.user.email ?? email, role: "patient", createdAt: Date.now(), demo: false };
      return { ok: true, identity: { profile, demo: false }, setupHint: "No user profile found in Firestore — defaulting to patient view. Register a new account to persist a role." };
    }
    return { ok: true, identity: { profile, demo: false } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Demo sign-in — visibly labelled, never presented as a secure session. */
export async function signInDemo(name: string, email: string, role: "patient" | "doctor", _layer: DataLayer): Promise<AuthOutcome> {
  const profile: UserProfile = {
    id: `demo_${email.toLowerCase().replace(/[^a-z0-9]/g, "_") || "user"}`,
    name: name.trim() || (role === "doctor" ? "Demo Clinician" : "Demo Patient"),
    email: email.trim() || "demo@medipulse.local",
    role, createdAt: Date.now(), demo: true,
  };
  try { localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(profile)); } catch { /* ignore */ }
  return { ok: true, identity: { profile, demo: true } };
}

export function loadPersistedDemo(): UserProfile | null {
  try {
    const raw = localStorage.getItem(DEMO_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserProfile;
  } catch { return null; }
}

export function clearPersistedDemo() {
  try { localStorage.removeItem(DEMO_SESSION_KEY); } catch { /* ignore */ }
}

export function subscribeLiveAuth(cb: (u: User | null) => void): (() => void) | null {
  const auth = getFirebaseAuth();
  if (!auth) return null;
  return onAuthStateChanged(auth, cb);
}

export async function signOutAll(): Promise<void> {
  clearPersistedDemo();
  const auth = getFirebaseAuth();
  try { await auth?.signOut(); } catch { /* offline */ }
}
