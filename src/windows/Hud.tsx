import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { RecordingState } from "../types";

function hudLog(msg: string) {
  invoke("hud_log", { msg }).catch(() => {});
}

/** Historial de niveles de voz que alimenta las barras. */
const HISTORY = 16;
/** Desfase por barra (centro reacciona primero, orillas después → ondulación). */
const BAR_LAG = [4, 2, 0, 2, 4];
/** Ganancia por barra: arco simétrico, el centro sube más que las orillas. */
const BAR_GAIN = [0.72, 0.9, 1, 0.9, 0.72];
/** Altura de las barras en px (reposo → pico). */
const BAR_MIN = 8;
const BAR_MAX = 30;

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
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const levelsRef = useRef<number[]>(Array(HISTORY).fill(0));
  const displayRef = useRef<number[]>(Array(5).fill(BAR_MIN));
  const recRef = useRef(rec);
  recRef.current = rec;

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onTheme = (e: MediaQueryListEvent) => setDark(e.matches);
    mql.addEventListener("change", onTheme);
    return () => mql.removeEventListener("change", onTheme);
  }, []);

  useEffect(() => {
    hudLog(`montado: ${window.innerWidth}x${window.innerHeight}`);
    const unState = listen<RecordingState>("recording-state", (e) => {
      setRec(e.payload);
      hudLog(`evento ${e.payload.state}`);
      if (e.payload.state === "recording") {
        levelsRef.current = Array(HISTORY).fill(0);
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

  // Barras tipo ecualizador: suben y bajan con la voz (grabando) o ondulan
  // en secuencia (procesando). Solo hay RMS, no espectro, así que la
  // "frecuencia" se simula: desfase + ganancia por barra + vaivén senoidal.
  // DOM + height, sin canvas: 5 elementos a 60 fps es despreciable.
  // Depende de rec.state porque las barras solo existen en esos estados.
  useEffect(() => {
    if (rec.state !== "recording" && rec.state !== "processing") return;
    let raf = 0;
    const tick = (t: number) => {
      const levels = levelsRef.current;
      const display = displayRef.current;
      for (let i = 0; i < 5; i++) {
        const el = barsRef.current[i];
        if (!el) continue;
        let target: number;
        if (recRef.current.state === "recording") {
          const v = levels[levels.length - 1 - BAR_LAG[i]] ?? 0;
          const wobble = 1 + 0.25 * Math.sin(t / 90 + i * 2.1);
          target =
            BAR_MIN + (BAR_MAX - BAR_MIN) * Math.min(1, v * BAR_GAIN[i] * wobble);
        } else {
          target = 12 + 7 * (1 + Math.sin(t / 160 - i * 0.9));
        }
        display[i] += (target - display[i]) * 0.35;
        el.style.height = `${display[i].toFixed(1)}px`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rec.state]);

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
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white dark:bg-sky-500">
              <MicIcon className="h-4 w-4" />
            </span>
            <div className="flex h-8 flex-1 items-center justify-center gap-2.5">
              {BAR_LAG.map((_, i) => (
                <span
                  key={i}
                  ref={(el) => {
                    barsRef.current[i] = el;
                  }}
                  className="w-2 rounded-full will-change-[height]"
                  style={{
                    height: BAR_MIN,
                    backgroundColor: dark ? "#38bdf8" : "#2563eb",
                  }}
                />
              ))}
            </div>
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
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white dark:bg-sky-500">
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
