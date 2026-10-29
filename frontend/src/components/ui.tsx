import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

export function StatusChip({ tone, pulse, children }: { tone?: "ok" | "warn" | "bad" | undefined; pulse?: boolean; children: ReactNode }) {
  return <span className={`status-chip ${tone ?? ""} ${pulse ? "pulse" : ""}`}><span className="dot" aria-hidden />{children}</span>;
}

export function GlassCard({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={`glass ${className ?? ""}`}>{children}</section>;
}

export function EmptyState({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="empty-state">
      <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
      {hint && <div style={{ fontSize: 13, color: "var(--ink-4)", maxWidth: 420 }}>{hint}</div>}
    </div>
  );
}

export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="glass" style={{ maxWidth: 480, width: "100%", padding: 22 }}>
        <div className="row" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }} className="grow">{title}</h3>
          <button className="btn ghost" aria-label="Close dialog" onClick={onClose} style={{ padding: 6, borderRadius: 10 }}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ToastStack({ toasts, onDismiss }: { toasts: { id: number; tone: "ok" | "bad"; text: string }[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`} onClick={() => onDismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function useToasts() {
  const ref = { push: (tone: "ok" | "bad", text: string) => window.dispatchEvent(new CustomEvent("medipulse-toast", { detail: { tone, text } })) };
  return ref;
}

export function TrendBadge({ trend }: { trend: string }) {
  const color = trend === "worsening" ? "var(--red)" : trend === "improving" ? "var(--phosphor)" : "var(--ink-3)";
  return <span style={{ color, fontFamily: "var(--mono)", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 600 }}>{trend}</span>;
}
