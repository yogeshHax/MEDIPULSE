/**
 * Typed client for the Flask analysis backend (backend/app.py).
 *
 * All calls degrade gracefully: when the backend is offline the UI shows the
 * explicit "AI analysis unavailable" state instead of a fabricated result.
 */

export interface PredictionResult {
  modelClass: "N" | "L" | "R" | "A" | "V";
  className: string;
  confidence: number; // 0..1
  riskScore: number; // 0..100 experimental
  conditionLevel: "low" | "moderate" | "high";
  trend?: "improving" | "stable" | "worsening";
  /** "trained-model" when a real artefact was loaded, "heuristic-v0" otherwise. */
  model?: string;
  experimental?: boolean;
  backendAvailable: true;
}

export type PredictionOutcome =
  | { available: true; result: PredictionResult }
  | { available: false; reason: string };

const BASE = "/api";

async function safeFetch(path: string, init?: RequestInit, timeoutMs = 8000): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + path, { ...init, signal: ctrl.signal });
    return res;
  } catch {
    return null; // backend offline — never invent a result
  } finally {
    clearTimeout(timer);
  }
}

export async function requestHealth(): Promise<{ available: boolean; detail?: unknown }> {
  const res = await safeFetch("/health");
  if (!res || !res.ok) return { available: false };
  try { return { available: true, detail: await res.json() }; } catch { return { available: true }; }
}

export async function requestPrediction(
  ecgSamples: number[],
  samplingRate: number,
  context?: { bpm?: number | null; signalQuality?: string },
): Promise<PredictionOutcome> {
  if (!ecgSamples.length) return { available: false, reason: "No ECG samples to analyse" };
  const res = await safeFetch("/ecg/predict", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ecgSamples, samplingRate, context: context ?? {} }),
  });
  if (!res) return { available: false, reason: "Flask analysis backend unreachable — start it with run_medipulse.bat (or `py backend/app.py`)" };
  if (res.status === 401 || res.status === 403) return { available: false, reason: "Prediction endpoint rejected this client (check MEDIPULSE_API_KEY)" };
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = `HTTP ${res.status}: ${body.error}`;
    } catch { /* non-JSON error body */ }
    return { available: false, reason: `Prediction endpoint failed (${detail})` };
  }
  try {
    const body = (await res.json()) as PredictionResult;
    return { available: true, result: { ...body, backendAvailable: true } };
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
