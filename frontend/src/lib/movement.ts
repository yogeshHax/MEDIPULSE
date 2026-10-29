/**
 * MPU6050 movement processing.
 *
 * IMPORTANT: an acceleration spike alone is NOT a fall. This module implements a
 * conservative two-stage heuristic (impact → post-impact stillness) and always
 * reports `fallSuspected`, never `fallConfirmed`, unless the device or the patient
 * explicitly confirms the event. Thresholds are documented monitoring heuristics,
 * not clinical or safety-certified logic (docs/hardware-integration.md §4).
 */

export interface RawMotionSample {
  /** Wall-clock ms; optional — the tracker stamps arrival time when absent. */
  t?: number;
  /** Acceleration in g. */
  ax: number; ay: number; az: number;
  /** Angular velocity in deg/s. */
  gx?: number; gy?: number; gz?: number;
  /** Device-side fall assertion (e.g. firmware algorithm). */
  deviceFall?: boolean;
}

export type ActivityLevel = "still" | "light" | "active";

export interface MovementSnapshot {
  t: number;
  /** Acceleration magnitude in g (1 g ≈ at rest). */
  magnitude: number;
  /** Angular velocity magnitude in deg/s (0 when not reported). */
  gyro: number;
  activityLevel: ActivityLevel;
  /** Heuristic: impact followed by stillness. Requires validation. */
  fallSuspected: boolean;
  /** True only when the device/patient confirmed the event. */
  fallConfirmed: boolean;
  /** Timestamp of the last detected impact, if any. */
  lastImpactAt: number | null;
  /** Number of samples in the rolling window (UI can show "no data" when 0). */
  windowSize: number;
}

/** Impact threshold (g). A hard stumble sits around 1.8–2.5 g; falls usually exceed 2.5 g. */
export const IMPACT_THRESHOLD_G = 2.4;
/** Post-impact stillness window (ms) required before flagging a suspected fall. */
export const POST_IMPACT_STILL_MS = 1200;
/** Maximum delay after impact in which stillness still counts (ms). */
export const POST_IMPACT_WINDOW_MS = 6000;
/** "Still" is judged against this deviation from 1 g. */
export const STILL_TOLERANCE_G = 0.12;
/** Minimum time between counted impacts (ms) — avoids counting one event twice. */
export const IMPACT_REFRACTORY_MS = 3000;

export function magnitudeOf(s: { ax: number; ay: number; az: number }): number {
  return Math.sqrt(s.ax * s.ax + s.ay * s.ay + s.az * s.az);
}

export function gyroOf(s: { gx?: number; gy?: number; gz?: number }): number {
  return Math.sqrt((s.gx ?? 0) ** 2 + (s.gy ?? 0) ** 2 + (s.gz ?? 0) ** 2);
}

/** Classify activity from the spread of magnitude over the recent window. */
export function activityFromWindow(magnitudes: number[]): ActivityLevel {
  if (magnitudes.length < 3) return "still";
  const mean = magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length;
  const variance = magnitudes.reduce((a, b) => a + (b - mean) ** 2, 0) / magnitudes.length;
  const sd = Math.sqrt(variance);
  if (sd < 0.045) return "still";
  if (sd < 0.22) return "light";
  return "active";
}

export class MovementTracker {
  private window: number[] = [];
  private lastImpactAt: number | null = null;
  private pendingImpactAt: number | null = null;
  private suspected = false;
  private confirmed = false;

  reset() {
    this.window = [];
    this.lastImpactAt = null;
    this.pendingImpactAt = null;
    this.suspected = false;
    this.confirmed = false;
  }

  ingest(sample: RawMotionSample): MovementSnapshot {
    const t = sample.t ?? Date.now();
    const mag = magnitudeOf(sample);
    const gyro = gyroOf(sample);

    this.window.push(mag);
    if (this.window.length > 40) this.window.splice(0, this.window.length - 40);

    // Stage 1 — impact detection with refractory period.
    const impactNow = mag >= IMPACT_THRESHOLD_G
      && (this.lastImpactAt == null || t - this.lastImpactAt >= IMPACT_REFRACTORY_MS);
    if (impactNow) {
      this.lastImpactAt = t;
      this.pendingImpactAt = t;
      this.suspected = false;
    }

    // Stage 2 — post-impact stillness confirms the *suspicion* (never the fact).
    if (this.pendingImpactAt != null) {
      const elapsed = t - this.pendingImpactAt;
      if (elapsed > POST_IMPACT_WINDOW_MS) {
        this.pendingImpactAt = null;
      } else if (elapsed >= POST_IMPACT_STILL_MS && Math.abs(mag - 1) <= STILL_TOLERANCE_G && gyro < 25) {
        this.suspected = true;
        this.pendingImpactAt = null;
      }
    }

    // Device assertion wins for "confirmed"; a heuristic never self-confirms.
    if (sample.deviceFall) {
      this.confirmed = true;
      this.suspected = true;
    }

    return {
      t,
      magnitude: Math.round(mag * 1000) / 1000,
      gyro: Math.round(gyro),
      activityLevel: activityFromWindow(this.window),
      fallSuspected: this.suspected,
      fallConfirmed: this.confirmed,
      lastImpactAt: this.lastImpactAt,
      windowSize: this.window.length,
    };
  }
}
