/**
 * MediPulse persistence layer.
 *
 * Two interchangeable adapters behind one interface:
 *  - FirestoreAdapter: Cloud Firestore (supplied project) + Firebase Auth identity.
 *  - DemoAdapter: localStorage-backed store, CLEARLY labelled as demo data in the UI.
 *
 * Why an interface: every screen must honestly report its data source, and
 * unverified/failed Firebase operations must surface as errors rather than
 * fabricated success — components render `connectionState` so both dashboards
 * show exactly what they are looking at.
 *
 * Schema (live mode):
 *   users/{uid}                          → UserProfile
 *   patients/{patientId}                 → registry document (name, caregiver info)
 *   patients/{patientId}/readings/{rId}  → Reading
 *   patients/{patientId}/alerts/{aId}    → Alert
 *   doctors/{uid}/assignments/{pid}      → doctor–patient authorisation links
 *
 * All timestamps are ms-since-epoch numbers. Missing values are null, never 0.
 */
import {
  addDoc, collection, disableNetwork, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, updateDoc, where, type Unsubscribe, type DocumentData,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { EcgSimulator } from "./ecgSignal";
import type { Alert, PatientRegistryEntry, Reading, UserProfile } from "./schema";

export type DataMode = "firebase" | "demo";

/** Connection/state chip values used across the shell and dashboards. */
export type ConnectionState = "connecting" | "live" | "demo" | "error";

export interface DataLayer {
  readonly mode: DataMode;
  lastError: string | null;
  getUserProfile(uid: string): Promise<UserProfile | null>;
  saveUserProfile(profile: UserProfile): Promise<void>;
  listPatients(): Promise<PatientRegistryEntry[]>;
  listAssignedPatients(doctorId: string): Promise<PatientRegistryEntry[]>;
  /** Single registry lookup (rules allow it only for the patient themselves or an assigned doctor). */
  getPatient(patientId: string): Promise<PatientRegistryEntry | null>;
  assignPatient(doctorId: string, patientId: string): Promise<void>;
  saveReading(patientId: string, reading: Omit<Reading, "id">): Promise<string>;
  listReadings(patientId: string, max?: number): Promise<Reading[]>;
  subscribeReadings(patientId: string, onValues: (r: Reading[]) => void, max?: number): Unsubscribe | null;
  saveAlert(alert: Omit<Alert, "id">): Promise<string>;
  subscribeAlerts(patientId: string, onValues: (a: Alert[]) => void, max?: number): Unsubscribe | null;
  updateAlertStatus(alertId: string, patientId: string, status: Alert["status"], actor?: string): Promise<void>;
  /** Developed for the demo adapter; firebase mode can also set an override. */
  listOfPatientsForDemo?(): PatientRegistryEntry[];
}

// ---------------- Firestore adapter ----------------

function docToReading(id: string, d: DocumentData): Reading {
  return {
    id,
    patientId: String(d.patientId ?? ""),
    timestamp: typeof d.timestamp === "number" ? d.timestamp : d.timestamp?.toMillis?.() ?? Date.now(),
    bpm: d.bpm ?? null,
    ecgSamples: d.ecgSamples,
    samplingRate: d.samplingRate,
    source: d.source ?? "manual",
    signalQuality: d.signalQuality ?? "unknown",
    modelClass: d.modelClass ?? null,
    confidence: d.confidence ?? null,
    riskScore: d.riskScore ?? null,
    trend: d.trend ?? "unknown",
    conditionLevel: d.conditionLevel ?? null,
    movement: d.movement ?? null,
  };
}

function docToAlert(id: string, d: DocumentData): Alert {
  return {
    id,
    patientId: String(d.patientId ?? ""),
    kind: d.kind ?? "arrhythmia",
    message: String(d.message ?? ""),
    timestamp: typeof d.timestamp === "number" ? d.timestamp : d.timestamp?.toMillis?.() ?? Date.now(),
    status: d.status ?? "created",
    ackedBy: d.ackedBy ?? null,
    ackedAt: d.ackedAt ?? null,
    resolvedAt: d.resolvedAt ?? null,
    readingId: d.readingId ?? null,
    sourceKind: d.sourceKind ?? "manual",
    deliveryConfirmed: !!d.deliveryConfirmed,
  };
}

export class FirestoreAdapter implements DataLayer {
  readonly mode: DataMode = "firebase";
  lastError: string | null = null;

  private fail(err: unknown): never {
    this.lastError = err instanceof Error ? err.message : String(err);
    console.error("[MediPulse dataLayer]", err);
    throw err;
  }

  async getUserProfile(uid: string): Promise<UserProfile | null> {
    try {
      const db = getDb()!;
      const snap = await getDoc(doc(db, "users", uid));
      if (!snap.exists()) return null;
      const d = snap.data();
      return { id: snap.id, name: d.name ?? "", email: d.email ?? "", role: d.role === "doctor" ? "doctor" : "patient", createdAt: d.createdAt?.toMillis?.() ?? 0, demo: false };
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      console.error("[MediPulse dataLayer] getUserProfile", err);
      return null;
    }
  }

  async saveUserProfile(profile: UserProfile): Promise<void> {
    try {
      const db = getDb()!;
      await setDoc(doc(db, "users", profile.id), {
        ...profile,
        createdAt: profile.createdAt || (serverTimestamp() as unknown as number),
      }, { merge: true });
    } catch (err) {
      this.fail(err);
    }
  }

  /** Profile include (id + display fields). Access must be enforced by Firestore rules. */
  async listPatients(): Promise<PatientRegistryEntry[]> {
    try {
      const db = getDb()!;
      const snap = await getDocs(query(collection(db, "users"), where("role", "==", "patient")));
      const res: PatientRegistryEntry[] = [];
      snap.forEach((d) => {
        const v = d.data();
        res.push({ patientId: d.id, name: v.name ?? "Unnamed patient", lastReadingAt: null, unresolvedAlerts: 0, latestBpm: null });
      });
      return res;
    } catch (err) {
      this.fail(err);
    }
  }

  async listAssignedPatients(doctorId: string): Promise<PatientRegistryEntry[]> {
    try {
      const db = getDb()!;
      const ids: string[] = [];
      const snap = await getDocs(collection(db, "doctors", doctorId, "assignments"));
      snap.forEach((d) => ids.push(d.id));
      const out: PatientRegistryEntry[] = [];
      for (const pid of ids) {
        try {
          const docSnap = await getDoc(doc(db, "users", pid));
          if (docSnap.exists()) {
            const v = docSnap.data();
            out.push({ patientId: docSnap.id, name: v.name ?? "Unnamed patient", lastReadingAt: null, unresolvedAlerts: 0, latestBpm: null });
          }
        } catch (err) {
          // Deny/skip individually — one blocked patient must not kill the roster.
          this.lastError = err instanceof Error ? err.message : String(err);
        }
      }
      return out;
    } catch (err) {
      this.fail(err);
    }
  }

  async getPatient(patientId: string): Promise<PatientRegistryEntry | null> {
    try {
      const db = getDb()!;
      const snap = await getDoc(doc(db, "users", patientId));
      if (!snap.exists()) return null;
      const v = snap.data();
      return { patientId: snap.id, name: v.name ?? "Unnamed patient", lastReadingAt: null, unresolvedAlerts: 0, latestBpm: null };
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      console.error("[MediPulse dataLayer] getPatient", err);
      return null;
    }
  }

  async assignPatient(doctorId: string, patientId: string): Promise<void> {
    try {
      const db = getDb()!;
      await setDoc(doc(db, "doctors", doctorId, "assignments", patientId), { assignedAt: Date.now() }, { merge: true });
    } catch (err) {
      this.fail(err);
    }
  }

  async saveReading(patientId: string, reading: Omit<Reading, "id">): Promise<string> {
    try {
      const db = getDb()!;
      const bounded: { [k: string]: unknown } = {
        patientId,
        timestamp: reading.timestamp ?? Date.now(),
        bpm: reading.bpm,
        source: reading.source,
        signalQuality: reading.signalQuality,
        modelClass: reading.modelClass,
        confidence: reading.confidence,
        riskScore: reading.riskScore,
        trend: reading.trend,
        conditionLevel: reading.conditionLevel,
        movement: reading.movement ?? null,
      };
      // Raw samples are stored compressed as base64 to preserve real data without
      // landing a per-sample sub-collection per sample (see docs/firebase-setup.md).
      if (reading.ecgSamples && reading.samplingRate) {
        const raw = decodeStoredSamples(reading.ecgSamples);
        if (raw.length) {
          bounded.ecgSamples = compressSamples(raw);
          bounded.samplingRate = reading.samplingRate;
        }
      }
      const ref = await addDoc(collection(db, "patients", patientId, "readings"), bounded);
      return ref.id;
    } catch (err) {
      this.fail(err);
    }
  }

  async listReadings(patientId: string, max = 200): Promise<Reading[]> {
    try {
      const db = getDb()!;
      const snap = await getDocs(query(collection(db, "patients", patientId, "readings"), orderBy("timestamp", "desc"), limit(max)));
      const out: Reading[] = [];
      snap.forEach((d) => out.push(docToReading(d.id, d.data())));
      return out.reverse(); // oldest-first like the rest of the UI expects
    } catch (err) {
      this.fail(err);
    }
  }

  subscribeReadings(patientId: string, onValues: (r: Reading[]) => void, max = 50): Unsubscribe | null {
    try {
      const db = getDb()!;
      const q = query(collection(db, "patients", patientId, "readings"), orderBy("timestamp", "desc"), limit(max));
      return onSnapshot(q, (snap) => {
        const out: Reading[] = [];
        snap.forEach((d) => out.push(docToReading(d.id, d.data())));
        onValues(out.reverse());
      }, (err) => {
        this.lastError = err.message;
        console.error("[MediPulse dataLayer] subscribeReadings", err);
      });
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      console.error("[MediPulse dataLayer] subscribeReadings", err);
      return null;
    }
  }

  async saveAlert(alert: Omit<Alert, "id">): Promise<string> {
    try {
      const db = getDb()!;
      const ref = await addDoc(collection(db, "patients", alert.patientId, "alerts"), { ...alert });
      return ref.id;
    } catch (err) {
      this.fail(err);
    }
  }

  subscribeAlerts(patientId: string, onValues: (a: Alert[]) => void, max = 100): Unsubscribe | null {
    try {
      const db = getDb()!;
      const q = query(collection(db, "patients", patientId, "alerts"), orderBy("timestamp", "desc"), limit(max));
      return onSnapshot(q, (snap) => {
        const out: Alert[] = [];
        snap.forEach((d) => out.push(docToAlert(d.id, d.data())));
        onValues(out);
      }, (err) => {
        this.lastError = err.message;
        console.error("[MediPulse dataLayer] subscribeAlerts", err);
      });
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      console.error("[MediPulse dataLayer] subscribeAlerts", err);
      return null;
    }
  }

  async updateAlertStatus(alertId: string, patientId: string, status: Alert["status"], actor?: string): Promise<void> {
    try {
      const db = getDb()!;
      const patch: Record<string, unknown> = { status };
      if (status === "acknowledged") { patch.ackedBy = actor ?? null; patch.ackedAt = Date.now(); }
      if (status === "resolved") patch.resolvedAt = Date.now();
      await updateDoc(doc(db, "patients", patientId, "alerts", alertId), patch);
    } catch (err) {
      this.fail(err);
    }
  }
}

// ---------------- Demo adapter (local, labelled) ----------------

interface DemoStore {
  users: Record<string, UserProfile>;
  patients: PatientRegistryEntry[];
  readings: Record<string, Reading[]>;
  alerts: Record<string, Alert[]>;
}

const DEMO_KEY = "medipulse-demo-store-v3"; // v3: richer seed (waveform strips, alerts, 48 h history; coherent classes)

/**
 * Seed the demo store with a small, clearly-synthetic cohort so BOTH dashboards
 * demonstrate a multi-patient world before any device is connected. Every record is
 * tagged source/demo and the UI banner says the store is simulated — these are NOT
 * production statistics and are never written to Firebase.
 */
export function ensureDemoSeed() {
  const store = loadDemoStore();
  if (store.patients.some((p) => p.patientId.startsWith("demo_patient_"))) return store;
  const cohort: Array<{ id: string; name: string; base: number; drift: number; abnormal: boolean }> = [
    { id: "demo_patient_lena", name: "Lena Hoffmann (demo)", base: 71, drift: 6, abnormal: false },
    { id: "demo_patient_marcus", name: "Marcus Oyelaran (demo)", base: 88, drift: 11, abnormal: true },
    { id: "demo_patient_priya", name: "Priya Raman (demo)", base: 63, drift: 4, abnormal: false },
  ];
  for (const c of cohort) {
    seedHistoryFor(store, c.id, { name: c.name, base: c.base, drift: c.drift, abnormal: c.abnormal, count: 44, intervalMs: 30 * 60_000 });
  }
  saveDemoStore(store);
  return store;
}

/**
 * Give a demo patient a believable history: $count$ readings at $intervalMs$ spacing,
 * each carrying a short compressed ECG strip so the history/doctor views can render
 * waveform previews. All values are synthetic; ids are stable so reseeding never
 * duplicates after reload.
 */
export function seedHistoryFor(
  store: DemoStore,
  patientId: string,
  opts: { base: number; drift: number; abnormal: boolean; count: number; intervalMs: number; name?: string },
) {
  if ((store.readings[patientId]?.length ?? 0) > 0) return; // already seeded
  const sim = new EcgSimulator(opts.base);
  const now = Date.now();
  const readings: Reading[] = [];
  for (let i = opts.count; i >= 0; i--) {
    const wave = Math.sin(i / 2.2) * opts.drift;
    const bpm = Math.round(opts.base + wave + (i % 3 === 0 ? 2 : 0));
    const abnormal = opts.abnormal && i < 3;
    sim.reset(bpm);
    sim.setArrhythmia(abnormal);
    const strip = sim.next(480, 250); // ~1.9 s preview strip @ 250 Hz
    readings.push({
      id: `seed_${patientId}_${i}`,
      patientId,
      timestamp: now - i * opts.intervalMs,
      bpm,
      source: "demo",
      signalQuality: i % 7 === 0 ? "fair" : "good",
      modelClass: abnormal ? "A" : i % 9 === 3 ? "V" : "N", // off-beat readings never land on the newest sample

      confidence: abnormal ? 0.63 + ((i % 4) * 0.04) : 0.9 + ((i % 4) * 0.02),
      riskScore: abnormal ? 52 + (i % 6) : Math.max(0, Math.round(Math.abs(bpm - 75) * 0.8)),
      trend: abnormal ? "worsening" : i % 5 === 0 ? "improving" : "stable",
      conditionLevel: abnormal ? "moderate" : "low",
      movement: null,
      ecgSamples: compressSamples(strip), // base64 delta — keeps the quota light; decodeStoredSamples unpacks it
      samplingRate: 250,
    });
  }
  store.readings[patientId] = readings;
  const last = readings[readings.length - 1];
  store.patients.push({
    patientId,
    name: opts.name ?? patientLabelFor(store, patientId),
    latestBpm: last.bpm,
    lastReadingAt: last.timestamp,
    unresolvedAlerts: opts.abnormal ? 1 : 0,
  });
  store.alerts[patientId] = [];
  if (opts.abnormal) {
    store.alerts[patientId].push({
      id: `seed_alert_open_${patientId}`,
      patientId,
      kind: "tachycardia",
      message: "Elevated heart rate with repeated PVC runs — BPM 104 (synthetic demo alert)",
      timestamp: now - 6 * 60_000,
      status: "created",
      ackedBy: null,
      ackedAt: null,
      resolvedAt: null,
      readingId: readings[readings.length - 1].id,
      sourceKind: "demo",
      deliveryConfirmed: false,
    });
  }
  store.alerts[patientId].push({
    id: `seed_alert_ack_${patientId}`,
    patientId,
    kind: "arrhythmia",
    message: "Brief irregular rhythm detected during overnight capture (synthetic demo alert)",
    timestamp: now - 26 * 60 * 60_000,
    status: "acknowledged",
    ackedBy: "Dr. A. Whitfield (demo)",
    ackedAt: now - 25 * 60 * 60_000,
    resolvedAt: now - 24 * 60 * 60_000,
    readingId: readings[2]?.id ?? null,
    sourceKind: "demo",
    deliveryConfirmed: true,
  });
}

/** Wrapper used at first demo sign-in: personalise + seed a standard 48-h history. */
function seedHistoryForDemoPatient(store: DemoStore, patientId: string, name: string) {
  // patientLabelFor reads store.users — saveUserProfile has already stored the profile.
  seedHistoryFor(store, patientId, { name, base: 73, drift: 5, abnormal: false, count: 42, intervalMs: 60 * 60_000 });
  // seedHistoryFor adds the registry entry under the label fallback; align the name.
  const entry = store.patients.find((p) => p.patientId === patientId);
  if (entry) entry.name = name;}

function patientLabelFor(store: DemoStore, patientId: string): string {
  const existing = store.users[patientId];
  const fallback = store.patients.find((p) => p.patientId === patientId)?.name;
  return existing?.name ?? fallback ?? "Demo patient";
}

function loadDemoStore(): DemoStore {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    if (raw) return JSON.parse(raw) as DemoStore;
  } catch (err) {
    console.warn("[MediPulse demo] store unreadable — starting clean", err);
  }
  return { users: {}, patients: [], readings: {}, alerts: {} };
}

function saveDemoStore(store: DemoStore) {
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(store)); } catch { /* quota */ }
}

export class DemoAdapter implements DataLayer {
  readonly mode: DataMode = "demo";
  lastError: string | null = null;
  private store = ensureDemoSeed();
  /** Bumped on every mutation so poll-based subscriptions can detect changes (incl. status updates). */
  private version = 0;
  private listeners = new Set<() => void>();

  private persist() {
    this.version++;
    saveDemoStore(this.store);
    this.listeners.forEach((fn) => fn());
  }

  async getUserProfile(uid: string): Promise<UserProfile | null> {
    return this.store.users[uid] ?? null;
  }

  async saveUserProfile(profile: UserProfile): Promise<void> {
    this.store.users[profile.id] = profile;
    if (profile.role === "patient") {
      const pid = profile.id;
      const known = this.store.patients.find((p) => p.patientId === pid);
      if (known) {
        // Reloaded sessions seed under a generic label first — align to the real name.
        if (profile.name.trim() && known.name !== profile.name) known.name = profile.name;
      } else {
        this.store.patients.push({ patientId: pid, name: profile.name, lastReadingAt: null, unresolvedAlerts: 0, latestBpm: null });
        // First demo sign-in: seed two days of believable history so every dashboard
        // renders live-looking data immediately (clearly labelled as demo).
        seedHistoryForDemoPatient(this.store, pid, profile.name);
      }
    }
    this.persist();
  }

  async listPatients(): Promise<PatientRegistryEntry[]> {
    return this.store.patients.slice();
  }

  async listAssignedPatients(doctorId: string): Promise<PatientRegistryEntry[]> {
    // Demo: all demo patients are assigned to the demo doctor (still demo data, labelled).
    return this.store.patients.slice();
  }

  async getPatient(patientId: string): Promise<PatientRegistryEntry | null> {
    return this.store.patients.find((p) => p.patientId === patientId) ?? null;
  }

  async assignPatient(_doctorId: string, _patientId: string): Promise<void> { /* demo: all access granted */ }

  /**
   * Sessions can be restored without a fresh sign-in (reload keeps the auth
   * session), so `saveUserProfile` never runs again. Seed on first data touch instead:
   * idempotent because seedHistoryFor no-ops once readings exist.
   */
  private ensurePatientSeeded(patientId: string) {
    if (!patientId.startsWith("demo_")) return;
    const user = this.store.users[patientId];
    if (user && user.role !== "patient") return;
    if ((this.store.readings[patientId]?.length ?? 0) > 0) return;
    seedHistoryFor(this.store, patientId, { name: user?.name, base: 73, drift: 5, abnormal: false, count: 42, intervalMs: 60 * 60_000 });
    const entry = this.store.patients.find((p) => p.patientId === patientId);
    if (entry && user) entry.name = user.name;
    saveDemoStore(this.store);
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  async saveReading(patientId: string, reading: Omit<Reading, "id">): Promise<string> {
    const id = `demo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const full: Reading = { id, ...reading, patientId };
    const arr = (this.store.readings[patientId] ||= []);
    arr.push(full);
    if (arr.length > 400) arr.splice(0, arr.length - 400); // bound the demo store
    const p = this.store.patients.find((x) => x.patientId === patientId);
    if (p) { p.lastReadingAt = full.timestamp; if (full.bpm != null) p.latestBpm = full.bpm; }
    this.persist();
    return id;
  }

  async listReadings(patientId: string, max = 200): Promise<Reading[]> {
    this.ensurePatientSeeded(patientId);
    const arr = this.store.readings[patientId] ?? [];
    return arr.slice(-max);
  }

  subscribeReadings(patientId: string, onValues: (r: Reading[]) => void, max = 50): Unsubscribe | null {
    this.ensurePatientSeeded(patientId);
    // Deliver the current snapshot immediately — a subscriber that mounts after data
    // exists must not wait for the next mutation.
    let lastVersion = this.version;
    const emit = () => onValues((this.store.readings[patientId] ?? []).slice(-max));
    emit();
    const timer = setInterval(() => {
      if (this.version !== lastVersion) { lastVersion = this.version; emit(); }
    }, 800);
    return () => clearInterval(timer);
  }

  async saveAlert(alert: Omit<Alert, "id">): Promise<string> {
    const id = `demo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const full: Alert = { id, ...alert, patientId: alert.patientId };
    (this.store.alerts[alert.patientId] ||= []).push(full);
    // apply registry badges
    const p = this.store.patients.find((x) => x.patientId === alert.patientId);
    if (p && alert.status !== "acknowledged" && alert.status !== "resolved") p.unresolvedAlerts = (p.unresolvedAlerts || 0) + 1;
    this.persist();
    return id;
  }

  subscribeAlerts(patientId: string, onValues: (a: Alert[]) => void, _max = 100): Unsubscribe | null {
    let lastVersion = this.version;
    const emit = () => onValues((this.store.alerts[patientId] ?? []).slice().reverse());
    emit();
    const timer = setInterval(() => {
      if (this.version !== lastVersion) { lastVersion = this.version; emit(); }
    }, 800);
    return () => clearInterval(timer);
  }

  async updateAlertStatus(alertId: string, patientId: string, status: Alert["status"], actor?: string): Promise<void> {
    const arr = this.store.alerts[patientId] ?? [];
    const a = arr.find((x) => x.id === alertId);
    if (!a) return;
    a.status = status;
    if (status === "acknowledged") { a.ackedBy = actor ?? null; a.ackedAt = Date.now(); }
    if (status === "resolved") a.resolvedAt = Date.now();
    const p = this.store.patients.find((x) => x.patientId === patientId);
    if (p) p.unresolvedAlerts = Math.max(0, (p.unresolvedAlerts || 0) - (status === "acknowledged" || status === "resolved" ? 1 : 0));
    this.persist();
  }

  demoPatients(): PatientRegistryEntry[] { return this.store.patients; }
}

/** Delta-compress ECG samples for storage (deltas quantised, then base64). */
export function compressSamples(samples: number[]): string {
  let prev = 0;
  const bytes: number[] = [];
  for (const s of samples) {
    const delta = Math.max(-127, Math.min(127, Math.round(s * 100) - prev));
    bytes.push(delta + 128);
    prev = Math.round(s * 100);
  }
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function decompressSamples(encoded: string): number[] {
  try {
    const raw = atob(encoded);
    let v = 0;
    const out: number[] = [];
    for (let i = 0; i < raw.length; i++) {
      v += raw.charCodeAt(i) - 128;
      out.push(v / 100);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Decode a stored waveform batch regardless of adapter: the demo store keeps raw
 * arrays, Firestore keeps the base64 delta string from `compressSamples`.
 */
export function decodeStoredSamples(v: unknown): number[] {
  if (Array.isArray(v)) return v as number[];
  if (typeof v === "string") return decompressSamples(v);
  return [];
}

/** Build the layer based on runtime availability; the app always announces which one is in control. */
export async function chooseAdapter(timeoutMs = 5000): Promise<{ layer: DataLayer; reason: string }> {
  const db = getDb();
  if (!db) {
    return { layer: new DemoAdapter(), reason: "Firebase cannot be initialised — running on labelled demo store" };
  }
  // Probe Firestore with a tiny read the rules would allow for any authed user; if
  // it fails or stalls (offline, rules deny, corporate proxy), fall back to demo
  // and surface the reason in the UI. The probe is bounded so sign-in is never
  // blocked behind an unresponsive network.
  const fb = new FirestoreAdapter();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      getDocs(query(collection(db, "_medipulse_probe"), limit(1))),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`probe timed out after ${timeoutMs} ms`)), timeoutMs); }),
    ]);
    clearTimeout(timer);
    return { layer: fb, reason: "Connected to Cloud Firestore" };
  } catch (err) {
    clearTimeout(timer);
    const reason = err instanceof Error ? err.message : String(err);
    // Stop Firestore's retry/listen churn: we have already fallen back to the demo
    // store, and a silent reconnect loop only burns the user's connection.
    void disableNetwork(db).catch(() => undefined);
    return { layer: new DemoAdapter(), reason: `Cloud Firestore unreachable: ${reason}` };
  }
}
