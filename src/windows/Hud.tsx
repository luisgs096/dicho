import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { RecordingState } from "../types";

function hudLog(msg: string) {
  invoke("hud_log", { msg }).catch(() => {});
}

/** Historial de niveles de voz que alimenta los puntos. */
const HISTORY = 16;
/** Paleta Dicho: azules → cian, un color por punto. */
const DOT_COLORS = ["#2563eb", "#3b82f6", "#0ea5e9", "#38bdf8", "#22d3ee"];
/** Desfase por punto (centro reacciona primero, orillas después → ondulación). */
const DOT_LAG = [4, 2, 0, 2, 4];

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
  const dotsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const levelsRef = useRef<number[]>(Array(HISTORY).fill(0));
  const displayRef = useRef<number[]>([0.5, 0.5, 0.5, 0.5, 0.5]);
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

  // Puntos estilo Google Assistant: escalan con la voz (grabando) o rebotan
  // en secuencia (procesando). DOM + transform, sin canvas: ligero y fluido.
  // Depende de rec.state porque los puntos solo existen en esos estados.
  useEffect(() => {
    if (rec.state !== "recording" && rec.state !== "processing") return;
    let raf = 0;
    const tick = (t: number) => {
      const levels = levelsRef.current;
      const display = displayRef.current;
      for (let i = 0; i < 5; i++) {
        const el = dotsRef.current[i];
        if (!el) continue;
        let target: number;
        if (recRef.current.state === "recording") {
          const v = levels[levels.length - 1 - DOT_LAG[i]] ?? 0;
          target = 0.5 + v * 2.1;
        } else {
          target = 0.8 + 0.45 * Math.sin(t / 160 - i * 0.9);
        }
        display[i] += (target - display[i]) * 0.3;
        const s = Math.max(0.35, display[i]);
        el.style.transform = `scale(${s.toFixed(3)})`;
        el.style.opacity = `${Math.min(1, 0.55 + s * 0.3).toFixed(3)}`;
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
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-sky-400 text-white">
              <MicIcon className="h-4 w-4" />
            </span>
            <div className="flex h-8 flex-1 items-center justify-center gap-3">
              {DOT_COLORS.map((color, i) => (
                <span
                  key={i}
                  ref={(el) => {
                    dotsRef.current[i] = el;
                  }}
                  className="h-3 w-3 rounded-full will-change-transform"
                  style={{
                    backgroundColor: color,
                    boxShadow: `0 0 10px ${color}55`,
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
