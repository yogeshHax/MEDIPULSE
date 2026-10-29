import { useEffect, useMemo, useRef, useState } from "react";
import { Download, TrendingUp, Waves, X } from "lucide-react";
import { StatusChip, EmptyState } from "../../components/ui";
import { EcgChart } from "../../components/EcgChart";
import { pushToast } from "../../components/ToastHost";
import { exportReadingsCsv, appendStringAsFile } from "../../lib/csv";
import { decodeStoredSamples, type DataLayer } from "../../lib/dataLayer";
import { EcgBuffer } from "../../lib/monitor";
import { ECG_CLASS_LABELS } from "../../lib/schema";
import type { Reading } from "../../lib/schema";

const CHART_W = 100;
const CHART_H = 38;

export function HistoryPage({ patientId, layer }: { patientId: string; layer: DataLayer }) {
  const [readings, setReadings] = useState<Reading[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "abnormal">("all");
  const [selected, setSelected] = useState<Reading | null>(null);

  useEffect(() => {
    let cancelled = false;
    layer.listReadings(patientId, 200)
      .then((r) => { if (!cancelled) { setReadings(r); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    const unsub = layer.subscribeReadings(patientId, (r) => { if (!cancelled) setReadings(r); }, 200);
    return () => { cancelled = true; unsub?.(); };
  }, [layer, patientId]);

  const isAbnormal = (r: Reading) =>
    (r.modelClass != null && r.modelClass !== "N") || (r.bpm != null && (r.bpm > 100 || r.bpm < 50));

  const shown = useMemo(
    () => (readings ?? []).filter((r) => (filter === "all" ? true : isAbnormal(r))),
    [readings, filter],
  );

  /** BPM chart model: viewBox points + reference lines, all derived from stored data. */
  const chart = useMemo(() => {
    const rows = (readings ?? []).filter((r) => r.bpm != null).slice(-70);
    if (rows.length < 2) return null;
    const values = rows.map((r) => r.bpm as number);
    const lo = Math.min(45, ...values);
    const hi = Math.max(115, ...values);
    const span = hi - lo || 1;
    const x = (i: number) => (i / (rows.length - 1)) * CHART_W;
    const y = (v: number) => CHART_H - ((v - lo) / span) * CHART_H;
    const line = rows.map((r, i) => `${x(i).toFixed(2)},${y(r.bpm as number).toFixed(2)}`).join(" ");
    return {
      line,
      area: `0,${CHART_H} ${line} ${CHART_W},${CHART_H}`,
      guides: [60, 100].filter((g) => g >= lo && g <= hi).map((g) => ({ v: g, y: y(g) })),
      lo,
      hi,
      count: rows.length,
      from: rows[0].timestamp,
      to: rows[rows.length - 1].timestamp,
    };
  }, [readings]);

  const doExport = () => {
    if (!readings?.length) { pushToast("bad", "No readings to export"); return; }
    appendStringAsFile(`medipulse-history-${patientId.slice(0, 8)}.csv`, exportReadingsCsv(shown.length ? shown : readings));
    pushToast("ok", `Exported ${(shown.length ? shown : readings).length} readings to CSV`);
  };

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
        <div>
          <h1 className="h-page" style={{ fontSize: 26 }}>ECG History <span className="accent">&amp; Trends</span></h1>
          <div className="label-caps" style={{ marginTop: 6 }}>STORED READINGS · SOURCE-ATTRIBUTED · EXPORTABLE</div>
        </div>
        <span className="grow" />
        <button className="btn ghost" onClick={() => setFilter(filter === "all" ? "abnormal" : "all")} style={{ fontSize: 13 }} aria-pressed={filter === "abnormal"}>
          {filter === "all" ? "Filter: all readings" : "Filter: abnormal only"}
        </button>
        <button className="btn" onClick={doExport}><Download size={15} /> Export CSV</button>
      </div>

      {error && <div className="error-note">Could not load history: {error}</div>}
      {readings == null && !error && (
        <section className="glass" style={{ padding: 20 }}><div className="skeleton" style={{ height: 120 }} /></section>
      )}
      {readings != null && readings.length === 0 && (
        <section className="glass"><EmptyState title="No stored readings yet" hint="Start a monitoring session — summary readings persist automatically every few seconds" /></section>
      )}

      {chart && (
        <section className="glass" style={{ padding: 20 }}>
          <div className="row" style={{ marginBottom: 12 }}>
            <TrendingUp size={14} color="var(--teal)" />
            <span className="label-caps">BPM trend · last {chart.count} readings</span>
            <span className="grow" />
            <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{chart.lo}–{chart.hi} BPM scale</span>
          </div>
          <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" style={{ width: "100%", height: 130, display: "block" }} role="img" aria-label={`BPM trend across ${chart.count} stored readings`}>
            <defs>
              <linearGradient id="tgrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#46f09b" stopOpacity="0.38" />
                <stop offset="100%" stopColor="#46f09b" stopOpacity="0" />
              </linearGradient>
            </defs>
            {chart.guides.map((g) => (
              <g key={g.v}>
                <line x1="0" x2={CHART_W} y1={g.y} y2={g.y} stroke="rgba(251,90,102,0.22)" strokeDasharray="1.2 1.6" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
                <text x={CHART_W - 1} y={Math.max(3, g.y - 1.2)} textAnchor="end" fontSize="2.2" fill="rgba(251,90,102,0.55)">{g.v}</text>
              </g>
            ))}
            <polygon fill="url(#tgrad)" points={chart.area} />
            <polyline fill="none" stroke="#46f09b" strokeWidth="1.4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" points={chart.line} style={{ filter: "drop-shadow(0 0 2px rgba(70,240,155,0.65))" }} />
          </svg>
          <div className="row" style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 6 }}>
            <span>{new Date(chart.from).toLocaleString()}</span>
            <span className="grow" />
            <span>{new Date(chart.to).toLocaleString()}</span>
          </div>
        </section>
      )}

      {shown.length > 0 && (
        <section className="glass" style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr><th>Time</th><th>BPM</th><th>Class</th><th>Conf.</th><th>Risk</th><th>Signal</th><th>Source</th><th>Waveform</th></tr>
              </thead>
              <tbody>
                {shown.slice().reverse().map((r) => (
                  <tr key={r.id}>
                    <td className="num">{new Date(r.timestamp).toLocaleString()}</td>
                    <td className="num" style={{ color: r.bpm != null && (r.bpm > 100 || r.bpm < 50) ? "var(--red)" : undefined }}>{r.bpm ?? "—"}</td>
                    <td>{r.modelClass ? <span>{r.modelClass} · {ECG_CLASS_LABELS[r.modelClass]}</span> : <span style={{ color: "var(--ink-4)" }}>—</span>}</td>
                    <td className="num">{r.confidence != null ? `${(r.confidence * 100).toFixed(0)}%` : "—"}</td>
                    <td className="num" style={{ color: (r.riskScore ?? 0) > 66 ? "var(--red)" : (r.riskScore ?? 0) > 40 ? "var(--amber)" : undefined }}>{r.riskScore ?? "—"}</td>
                    <td><StatusChip tone={r.signalQuality === "good" ? "ok" : r.signalQuality === "poor" ? "bad" : "warn"}>{r.signalQuality}</StatusChip></td>
                    <td><StatusChip tone={r.source === "hardware" ? "ok" : "warn"}>{r.source}</StatusChip></td>
                    <td>
                      {decodeStoredSamples(r.ecgSamples).length > 1
                        ? <button className="btn ghost" style={{ padding: "5px 9px", fontSize: 12 }} onClick={() => setSelected(r)}><Waves size={13} /> View</button>
                        : <span style={{ color: "var(--ink-4)", fontSize: 12 }}>none</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {selected && <StoredWaveform reading={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/** Replays a stored waveform batch (real stored samples, never synthesised here). */
function StoredWaveform({ reading, onClose }: { reading: Reading; onClose: () => void }) {
  const samples = useMemo(() => decodeStoredSamples(reading.ecgSamples), [reading]);
  const rate = reading.samplingRate ?? 250;
  const buffer = useRef(new EcgBuffer(Math.max(1000, (samples.length / rate) * 1000), rate));
  useEffect(() => {
    buffer.current.clear();
    buffer.current.push(samples);
  }, [samples, rate]);

  return (
    <section aria-label="Stored ECG waveform" style={{ display: "grid", gap: 10 }}>
      <div className="row" style={{ gap: 10 }}>
        <Waves size={15} color="var(--phosphor)" />
        <span className="label-caps">Stored waveform · {new Date(reading.timestamp).toLocaleString()} · {(samples.length / rate).toFixed(1)} s @ {rate} Hz</span>
        <span className="grow" />
        <button className="btn ghost" style={{ padding: 6 }} onClick={onClose} aria-label="Close waveform"><X size={15} /></button>
      </div>
      <div className="monitor" style={{ padding: 0 }}>
        <EcgChart buffer={buffer.current} samplesPerSecond={rate} active={false} height={200} />
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink-4)" }}>
        Replayed from the stored sample batch ({samples.length} samples, source <b>{reading.source}</b>).
        {reading.bpm != null ? ` Reading BPM at save time: ${reading.bpm}.` : " No BPM stored for this reading."}
      </div>
    </section>
  );
}
