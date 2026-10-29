/**
 * MediPulse core data schema (shared types).
 *
 * See docs/architecture.md for the authoritative schema documentation.
 * Missing values are `null` (e.g. BPM unknown), NEVER 0.
 */

export type EcgClass = "N" | "L" | "R" | "A" | "V";

export const ECG_CLASS_LABELS: Record<EcgClass, string> = {
  N: "Normal beat",
  L: "Left bundle branch block",
  R: "Right bundle branch block",
  A: "Atrial premature beat",
  V: "Premature ventricular contraction",
};

export type RiskLevel = "low" | "moderate" | "high";

export type SourceKind = "hardware" | "demo" | "manual" | "bridge";

export type SignalQuality = "good" | "fair" | "poor" | "unknown";

/** One persisted summary reading. */
export interface Reading {
  id: string;
  patientId: string;
  timestamp: number; // ms since epoch (server-authoritative when available)
  bpm: number | null;
  /**
   * ECG sample batch (values in mV) stored with the reading when available.
   * Raw `number[]` in the demo store; a base64 delta string at rest in Firestore.
   * Always decode with `decodeStoredSamples()` from lib/dataLayer.
   */
  ecgSamples?: number[] | string;
  samplingRate?: number;
  source: SourceKind;
  signalQuality: SignalQuality;
  modelClass: EcgClass | null;
  confidence: number | null; // 0..1
  riskScore: number | null; // 0..100 experimental
  trend: "improving" | "stable" | "worsening" | "unknown";
  conditionLevel: RiskLevel | null;
  movement?: MovementEventSummary | null;
}

export interface MovementEventSummary {
  activityLevel: "still" | "light" | "active";
  fallSuspected: boolean;
  fallConfirmed?: boolean;
}

export type AlertKind = "arrhythmia" | "bradycardia" | "tachycardia" | "fall" | "manual-emergency" | "critical-ai";

export type AlertStatus = "created" | "delivered" | "acknowledged" | "resolved" | "failed";

export interface Alert {
  id: string;
  patientId: string;
  kind: AlertKind;
  message: string;
  timestamp: number;
  status: AlertStatus;
  ackedBy?: string | null;
  ackedAt?: number | null;
  resolvedAt?: number | null;
  readingId?: string | null;
  /** True when generated locally from rules with no backend confirms; false when backend/pipeline confirmed. */
  sourceKind: SourceKind;
  deliveryConfirmed: boolean; // only true when a real notification provider confirmed delivery
}

export interface MovementSample {
  t: number; // ms
  ax: number; ay: number; az: number; // g
  gx: number; gy: number; gz: number; // deg/s
}

export interface UserProfile {
  id: string; // firebase uid in live mode, demo id in demo mode
  name: string;
  email: string;
  role: "patient" | "doctor";
  createdAt: number;
  demo: boolean;
}

/** Doctor-roster summary entry (registry projection of a patient). */
export interface PatientRegistryEntry {
  patientId: string;
  name: string;
  latestBpm: number | null;
  lastReadingAt: number | null;
  unresolvedAlerts: number;
}

export const DEFAULT_SAMPLING_RATE = 250; // Hz, documented device contract (see docs/hardware-integration.md)

export const ALERT_RULES = {
  bradycardiaBpm: 50,
  tachycardiaBpm: 100,
  criticalBpm: 120,
  feverTempC: 38,
  repeatedAbnormalThreshold: 2, // consecutive abnormal predictions before "critical-ai"
  cooldownMs: 60_000, // same-kind cooldown for a single ongoing incident
  escalationAfterN: 3, // after N suppressed same-kind alerts, escalate as new alert
} as const;
