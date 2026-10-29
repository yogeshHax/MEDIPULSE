import type { Reading } from "./schema";
import { ECG_CLASS_LABELS } from "./schema";

/** Serialise readings to a clean CSV (no injections — numbers/timestamps/labels only + sanity-quoting). */
export function exportReadingsCsv(rows: Reading[]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const head = ["timestamp_iso", "timestamp_ms", "bpm", "ecg_class", "class_label", "confidence", "risk_score", "condition_level", "trend", "signal_quality", "source"];
  const lines = rows.map((r) => [
    new Date(r.timestamp).toISOString(),
    String(r.timestamp),
    r.bpm == null ? "" : String(r.bpm),
    r.modelClass ?? "",
    r.modelClass ? ECG_CLASS_LABELS[r.modelClass] : "",
    r.confidence == null ? "" : (r.confidence * 100).toFixed(1),
    r.riskScore == null ? "" : String(r.riskScore),
    r.conditionLevel ?? "",
    r.trend ?? "",
    r.signalQuality ?? "",
    r.source ?? "",
  ].map(esc).join(","));
  return [head.join(","), ...lines].join("\n");
}

export function appendStringAsFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
