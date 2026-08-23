import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { RecordingState } from "../types";

/** Puntos del historial de nivel de voz que alimentan la onda. */
const POINTS = 48;

function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path
        d="M5 11a7 7 0 0 0 14 0M12 18v3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function Hud() {
  const [rec, setRec] = useState<RecordingState>({ state: "idle" });
  const [dark, setDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelsRef = useRef<number[]>(Array(POINTS).fill(0));
  const recRef = useRef(rec);
  recRef.current = rec;

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onTheme = (e: MediaQueryListEvent) => setDark(e.matches);
    mql.addEventListener("change", onTheme);
    return () => mql.removeEventListener("change", onTheme);
  }, []);

  useEffect(() => {
    const unState = listen<RecordingState>("recording-state", (e) => {
      setRec(e.payload);
      if (e.payload.state === "recording") {
        levelsRef.current = Array(POINTS).fill(0);
      }
    });
    const unLevel = listen<{ level: number }>("audio-level", (e) => {
      const v = Math.min(1, Math.pow(e.payload.level * 12, 0.75));
      levelsRef.current = [...levelsRef.current.slice(1), v];
    });
    return () => {
      unState.then((f) => f());
      unLevel.then((f) => f());
    };
  }, []);

  // Onda continua: la amplitud sigue tu voz y la fase fluye en el tiempo.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    let raf = 0;

    const draw = (t: number) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const state = recRef.current.state;
      const cy = h / 2;
      const maxAmp = h / 2 - 4;
      const levels = levelsRef.current;

      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, dark ? "#3b82f6" : "#2563eb");
      grad.addColorStop(1, dark ? "#22d3ee" : "#0ea5e9");

      ctx.beginPath();
      const phase = t / 240;
      for (let x = 0; x <= w; x += 2) {
        const pos = (x / w) * (POINTS - 1);
        const i = Math.floor(pos);
        const frac = pos - i;
        const envRaw =
          (levels[i] ?? 0) * (1 - frac) + (levels[Math.min(i + 1, POINTS - 1)] ?? 0) * frac;
        let amp: number;
        if (state === "recording") {
          amp = 2.5 + envRaw * maxAmp;
        } else if (state === "processing") {
          amp = 4 + Math.sin(t / 300) * 2.5; // respiración suave
        } else {
          amp = 1.5;
        }
        const y = cy + Math.sin(phase + x * 0.09) * amp * Math.sin((x / w) * Math.PI) ** 0.6;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.shadowColor = dark ? "rgba(56,189,248,0.55)" : "rgba(37,99,235,0.35)";
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [dark]);

  const pill = dark
    ? "border-white/10 bg-slate-900/90 text-slate-200"
    : "border-slate-200/80 bg-white/95 text-slate-700";

  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <div
        className={`flex h-[64px] w-[336px] items-center gap-3 rounded-full border px-5 shadow-2xl shadow-blue-900/20 backdrop-blur ${pill}`}
      >
        {(rec.state === "recording" || rec.state === "processing") && (
          <>
            <span className="relative flex h-7 w-7 shrink-0 items-center justify-center">
              <span
                className={`absolute inset-0 rounded-full ${
                  rec.state === "recording" ? "animate-ping bg-blue-500/25" : ""
                }`}
              />
              <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-sky-400 text-white">
                <MicIcon className="h-4 w-4" />
              </span>
            </span>
            <canvas ref={canvasRef} className="h-10 min-w-0 flex-1" />
            <span
              className={`shrink-0 text-[11px] font-medium ${
                dark ? "text-slate-400" : "text-slate-500"
              }`}
            >
              {rec.state === "recording" ? "Te escucho" : "Escribiendo…"}
            </span>
          </>
        )}

        {rec.state === "done" && (
          <>
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-sky-400 text-xs font-bold text-white">
              ✓
            </span>
            <p className="min-w-0 flex-1 truncate text-sm">{rec.text}</p>
          </>
        )}

        {rec.state === "error" && (
          <>
            <span className="shrink-0 text-sm text-amber-500">●</span>
            <p className="min-w-0 flex-1 truncate text-xs">{rec.message}</p>
          </>
        )}

        {rec.state === "idle" && (
          <p
            className={`flex-1 text-center text-xs font-medium tracking-wide ${
              dark ? "text-slate-500" : "text-slate-400"
            }`}
          >
            Dicho
          </p>
        )}
      </div>
    </div>
  );
}
