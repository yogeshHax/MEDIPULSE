/**
 * Firebase initialisation for the MediPulse project (supplied client config).
 * The client config only identifies the web app — real access control comes from
 * Firebase Auth + Security Rules shipped in `firestore.rules` (see docs/firebase-setup.md).
 */
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

export const firebaseConfig = {
  apiKey: "AIzaSyDBMmjNkHeZEEe2iZ_HQQ5hBrD0wUh7KPs",
  authDomain: "medipulse-48c9a.firebaseapp.com",
  projectId: "medipulse-48c9a",
  storageBucket: "medipulse-48c9a.firebasestorage.app",
  messagingSenderId: "203157762699",
  appId: "1:203157762699:web:b5d0f2a21b579f49431a8e",
  measurementId: "G-3CCPG8228B",
};

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let firestore: Firestore | null = null;

/** Environment-based override support: VITE_FIREBASE_* beats the supplied snippet. */
function resolvedConfig() {
  const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env ?? {};
  return {
    apiKey: env.VITE_FIREBASE_API_KEY ?? firebaseConfig.apiKey,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? firebaseConfig.authDomain,
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? firebaseConfig.projectId,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? firebaseConfig.storageBucket,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? firebaseConfig.messagingSenderId,
    appId: env.VITE_FIREBASE_APP_ID ?? firebaseConfig.appId,
  };
}

/** Returns true if Firebase was initialised successfully. */
export function initFirebase(): { app: FirebaseApp; auth: Auth; db: Firestore } | null {
  if (authInstance && firestore && app) return { app, auth: authInstance, db: firestore };
  try {
    const cfg = resolvedConfig();
    app = getApps().length ? getApp() : initializeApp(cfg);
    authInstance = getAuth(app);
    firestore = getFirestore(app);
    return { app, auth: authInstance, db: firestore };
  } catch (err) {
    console.error("[MediPulse] Firebase init failed", err);
    return null;
  }
}

export function getFirebaseAuth(): Auth | null {
  return initFirebase()?.auth ?? null;
}

export function getDb(): Firestore | null {
  return initFirebase()?.db ?? null;
}
