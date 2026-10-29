import { useEffect, useState } from "react";
import { ToastStack } from "./ui";

let toastId = 0;

export function pushToast(tone: "ok" | "bad", text: string) {
  window.dispatchEvent(new CustomEvent("medipulse-toast", { detail: { tone, text } }));
}

export function ToastHost() {
  const [toasts, setToasts] = useState<{ id: number; tone: "ok" | "bad"; text: string }[]>([]);
  useEffect(() => {
    const on = (ev: Event) => {
      const { tone, text } = (ev as CustomEvent<{ tone: "ok" | "bad"; text: string }>).detail;
      const id = ++toastId;
      setToasts((t) => [...t.slice(-3), { id, tone, text }]);
      window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
    };
    window.addEventListener("medipulse-toast", on);
    return () => window.removeEventListener("medipulse-toast", on);
  }, []);
  return <ToastStack toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />;
}
