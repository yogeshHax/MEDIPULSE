import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, ArrowUpDown, Users } from "lucide-react";
import { StatusChip, EmptyState } from "../../components/ui";
import type { DataLayer } from "../../lib/dataLayer";
import type { Alert, PatientRegistryEntry, Reading } from "../../lib/schema";

type SortKey = "name" | "bpm" | "lastReadingAt" | "unresolvedAlerts";

export function DoctorPatients({ doctorId, layer }: { doctorId: string; layer: DataLayer }) {
  const navigate = useNavigate();
  const [base, setBase] = useState<PatientRegistryEntry[] | null>(null);
  const [readings, setReadings] = useState<Record<string, Reading[]>>({});
  const [alerts, setAlerts] = useState<Record<string, Alert[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("lastReadingAt");
  const [onlyAlerts, setOnlyAlerts] = useState(false);
  const subsRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    let cancelled = false;
    layer.listAssignedPatients(doctorId).then(async (ps) => {
      if (cancelled) return;
      setBase(ps);
      for (const p of ps) {
        try {
          const readingsList = await layer.listReadings(p.patientId, 30);
          if (cancelled) return;
          setReadings((prev) => ({ ...prev, [p.patientId]: readingsList }));
        } catch (e) {
          if (!cancelled) console.warn(`[MediPulse] readings for ${p.patientId} not accessible`, e);
        }
        const unsubA = layer.subscribeAlerts(p.patientId, (a) => { if (!cancelled) setAlerts((prev) => ({ ...prev, [p.patientId]: a })); }, 40);
        const unsubR = layer.subscribeReadings(p.patientId, (r) => { if (!cancelled) setReadings((prev) => ({ ...prev, [p.patientId]: r })); }, 10);
        subsRef.current.push(unsubA ?? (() => undefined), unsubR ?? (() => undefined));
      }
    }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; subsRef.current.splice(0).forEach((u) => u()); };
  }, [doctorId, layer]);

  const rows = useMemo(() => {
    const withMeta = (base ?? []).map((p) => {
      const list = readings[p.patientId] ?? [];
      const latest = list[list.length - 1];
      const open = (alerts[p.patientId] ?? []).filter((a) => a.status === "created" || a.status === "delivered").length;
      return { ...p, latestBpm: latest?.bpm ?? null, lastReadingAt: latest?.timestamp ?? null, unresolvedAlerts: open, latest: latest ?? null };
    });
    const q = search.trim().toLowerCase();
    return withMeta
      .filter((r) => (q ? r.name.toLowerCase().includes(q) || r.patientId.toLowerCase().includes(q) : true))
      .filter((r) => (onlyAlerts ? r.unresolvedAlerts > 0 : true))
      .sort((a, b) => {
        if (sort === "name") return a.name.localeCompare(b.name);
        if (sort === "bpm") return (b.latestBpm ?? -1) - (a.latestBpm ?? -1);
        if (sort === "unresolvedAlerts") return b.unresolvedAlerts - a.unresolvedAlerts;
        return (b.lastReadingAt ?? 0) - (a.lastReadingAt ?? 0);
      });
  }, [base, readings, alerts, search, sort, onlyAlerts]);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="row" style={{ flexWrap: "wrap", gap: 14 }}>
        <div>
          <h1 className="h-page" style={{ fontSize: 26 }}>Patients <span className="accent">· Roster</span></h1>
          <div className="label-caps" style={{ marginTop: 6 }}>AUTHORISED-SCOPE ONLY · ENFORCED SERVER-SIDE</div>
        </div>
        <span className="grow" />
        <div className="row glass-soft" style={{ padding: "4px 10px 4px 12px", borderRadius: 12 }}>
          <Search size={14} color="var(--ink-4)" />
          <input className="text-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or ID" aria-label="Search patients" style={{ border: "none", background: "transparent", padding: "8px 4px", minWidth: 180 }} />
        </div>
        <button className="btn ghost" onClick={() => setOnlyAlerts(!onlyAlerts)} style={{ fontSize: 13 }}>{onlyAlerts ? "Showing: alerts only" : "Show: all patients"}</button>
        <button className="btn ghost" onClick={() => setSort((s) => (s === "lastReadingAt" ? "name" : s === "name" ? "bpm" : s === "bpm" ? "unresolvedAlerts" : "lastReadingAt"))} style={{ fontSize: 13 }}>
          <ArrowUpDown size={13} /> Sort: {sort === "lastReadingAt" ? "recent" : sort === "name" ? "name" : sort === "bpm" ? "BPM" : "alerts"}
        </button>
      </div>

      {error && <div className="error-note">Roster error: {error}</div>}
      {base != null && base.length === 0 && (
        <section className="glass">
          <EmptyState title="No patients assigned yet" hint={<span>Assignments are stored in <code>doctors/{doctorId}/assignments</code> — use the CLI/seed tool (docs/firebase-setup.md §seeding) or have the patient register and your admin link them.</span>} />
        </section>
      )}

      {rows.length > 0 && (
        <section className="glass" style={{ overflow: "hidden" }}>
          <div style={{ padding: "14px 18px" }} className="row"><Users size={14} color="var(--teal)" /><span className="label-caps">{rows.length} patient{rows.length === 1 ? "" : "s"} in scope</span></div>
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr><th>Patient</th><th>Latest BPM</th><th>Last reading</th><th>Class</th><th>Status</th><th>Open alerts</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.patientId} onClick={() => navigate(`/doctor/patients/${r.patientId}`)}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{r.name}</div>
                      <div style={{ fontSize: 11, color: "var(--ink-4)", fontFamily: "var(--mono)" }}>{r.patientId}</div>
                    </td>
                    <td className="num" style={{ color: r.latestBpm != null && (r.latestBpm > 100 || r.latestBpm < 50) ? "var(--red)" : undefined }}>{r.latestBpm ?? "—"}</td>
                    <td className="num">{r.lastReadingAt ? new Date(r.lastReadingAt).toLocaleString() : "—"}</td>
                    <td>{r.latest?.modelClass ?? <span style={{ color: "var(--ink-4)" }}>—</span>}</td>
                    <td><StatusChip tone={r.latest ? (r.latest.signalQuality === "good" ? "ok" : "warn") : "warn"}>{r.latest ? r.latest.signalQuality : "no data"}</StatusChip></td>
                    <td>{r.unresolvedAlerts > 0 ? <StatusChip tone="bad">{r.unresolvedAlerts} open</StatusChip> : <StatusChip tone="ok">0</StatusChip>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
