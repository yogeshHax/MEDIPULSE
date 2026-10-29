import { useEffect, useRef } from "react";
import type { EcgBuffer } from "../lib/monitor";

/**
 * ECG waveform canvas.
 *
 * Performance-critical: drawing runs in a rAF loop reading a shared ring buffer,
 * so React never re-renders per sample. Scrolling rendering with phosphor glow;
 * adaptive sweep speed keeps ~[window] seconds on screen regardless of width.
 */
export function EcgChart({
  buffer,
  samplesPerSecond,
  active,
  height = 220,
  gain = 220,
}: {
  buffer: EcgBuffer | null;
  samplesPerSecond: number;
  active: boolean;
  height?: number;
  gain?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let running = true;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const traceColor = "#46f09b";
    const gridMinor = "rgba(70, 240, 155, 0.055)";
    const gridMajor = "rgba(70, 240, 155, 0.12)";

    let lastMidY = canvas.height / 2;

    const drawGrid = () => {
      const w = canvas.width, h = canvas.height;
      ctx.fillStyle = "#010405";
      ctx.fillRect(0, 0, w, h);
      // minor grid: 20 px cells (CSS px scaled by dpr)
      const cell = Math.max(14, Math.round(0.042 * w));
      ctx.strokeStyle = gridMinor;
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      for (let x = cell; x < w; x += cell) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = cell; y < h; y += cell) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
      ctx.strokeStyle = gridMajor;
      ctx.beginPath();
      for (let x = cell * 5; x < w; x += cell * 5) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = cell * 5; y < h; y += cell * 5) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
      // baseline
      ctx.strokeStyle = "rgba(70, 240, 155, 0.09)";
      ctx.beginPath();
      ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
      ctx.stroke();
    };

    const render = (_t: number) => {
      raf = requestAnimationFrame(render);
      if (!running) return;
      drawGrid();

      const w = canvas.width, h = canvas.height;
      if (!buffer || buffer.samples.length < 2) {
        // idle state — flatline with a beacon
        const now = _t / 400;
        const beacon = w / 2;
        ctx.strokeStyle = traceColor;
        ctx.lineWidth = 1.6 * dpr;
        ctx.shadowColor = "rgba(70, 240, 155, 0.55)";
        ctx.shadowBlur = 9 * dpr;
        ctx.beginPath();
        for (let x = 0; x < w; x += 2) {
          const y = h / 2;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        // sweeping beacon
        const bx = ((now * 90) % (w + 40)) - 20;
        if (active) {
          ctx.strokeStyle = "rgba(70, 240, 155, 0.5)";
          ctx.shadowBlur = 16 * dpr;
          ctx.beginPath();
          ctx.moveTo(bx, h * 0.2); ctx.lineTo(bx, h * 0.8);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
        lastMidY = h / 2;
        return;
      }

      const samples = buffer.samples;
      const n = samples.length;
      const windowMs = buffer.capacityMs;
      const pxPerMs = w / windowMs;
      // use only the last windowMs worth of samples
      const usable = Math.min(n, Math.round(windowMs * samplesPerSecond));
      const startIdx = n - usable;
      let midY = h / 2;
      ctx.lineWidth = 1.8 * dpr;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.strokeStyle = traceColor;
      ctx.shadowColor = "rgba(70, 240, 155, 0.5)";
      ctx.shadowBlur = 8 * dpr;
      ctx.beginPath();
      for (let i = 0; i < usable; i++) {
        const tMs = i / samplesPerSecond * 1000;
        const x = pxPerMs * tMs;
        const v = samples[startIdx + i] ?? 0;
        const y = h / 2 - v * gain * dpr;
        void midY;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      lastMidY = midY;
    };

    raf = requestAnimationFrame(render);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      void lastMidY;
    };
  }, [buffer, gain, height, active]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height, display: "block" }}
      aria-label="ECG waveform (Lead II)"
      role="img"
    />
  );
}
