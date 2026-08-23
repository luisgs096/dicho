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

/** Carita pixel-art angustiada: cejas preocupadas, ojos temblorosos,
 *  boca en zigzag y gota de sudor. Para cuando no se entendió nada. */
function PixelFace() {
  return (
    <svg
      viewBox="0 0 26 18"
      shapeRendering="crispEdges"
      className="pf-in h-8 w-auto"
    >
      {/* cejas de angustia: suben hacia el centro */}
      <g fill="currentColor">
        <rect x="2.5" y="3.6" width="2.2" height="1.4" />
        <rect x="4.7" y="2.2" width="2.2" height="1.4" />
        <rect x="12.1" y="2.2" width="2.2" height="1.4" />
        <rect x="14.3" y="3.6" width="2.2" height="1.4" />
      </g>
      {/* ojos temblorosos */}
      <g className="pf-tremble" fill="currentColor">
        <rect x="3.6" y="6.2" width="2.6" height="3.6" />
        <rect x="12.8" y="6.2" width="2.6" height="3.6" />
      </g>
      {/* boca en zigzag */}
      <g fill="currentColor">
        <rect x="4" y="13.2" width="2.4" height="1.6" />
        <rect x="6.4" y="14.4" width="2.4" height="1.6" />
        <rect x="8.8" y="13.2" width="2.4" height="1.6" />
        <rect x="11.2" y="14.4" width="2.4" height="1.6" />
        <rect x="13.6" y="13.2" width="2.4" height="1.6" />
      </g>
      {/* gota de sudor */}
      <g className="pf-drop" fill="#38bdf8">
        <rect x="20.4" y="2" width="1.6" height="1.6" />
        <rect x="19.6" y="3.6" width="3.2" height="2.4" />
        <rect x="20.4" y="6" width="1.6" height="1.2" />
      </g>
    </svg>
  );
}

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

  const empty = rec.state === "empty";
  const pill = empty
    ? dark
      ? "border-orange-400/30 bg-slate-900/90 text-orange-200"
      : "border-orange-200 bg-orange-50/95 text-orange-900"
    : dark
      ? "border-white/10 bg-slate-900/90 text-slate-200"
      : "border-slate-200/80 bg-white/95 text-slate-700";

  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <style>{`
        @keyframes hud-shake {
          0%, 100% { transform: translateX(0); }
          15% { transform: translateX(-5px); }
          30% { transform: translateX(4px); }
          45% { transform: translateX(-3px); }
          60% { transform: translateX(2px); }
          75% { transform: translateX(-1px); }
        }
        @keyframes pf-in {
          0% { transform: scale(.5); opacity: 0; }
          60% { transform: scale(1.12); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes pf-tremble {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-.5px); }
          75% { transform: translateX(.5px); }
        }
        @keyframes pf-drop {
          0% { transform: translateY(-1px); opacity: 0; }
          25% { opacity: 1; }
          100% { transform: translateY(2.5px); opacity: 0; }
        }
        .hud-shake { animation: hud-shake .55s ease-in-out; }
        .pf-in { animation: pf-in .4s cubic-bezier(.34, 1.56, .64, 1) both; }
        .pf-tremble { animation: pf-tremble .18s linear infinite; }
        .pf-drop { animation: pf-drop 1.5s ease-in .3s infinite; }
      `}</style>
      <div
        className={`flex h-[64px] w-[336px] items-center gap-3 rounded-full border px-5 shadow-2xl shadow-blue-900/20 backdrop-blur transition-colors ${
          empty ? "hud-shake" : ""
        } ${pill}`}
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

        {rec.state === "empty" && (
          <>
            <span className={dark ? "text-orange-300" : "text-orange-500"}>
              <PixelFace />
            </span>
            <p className="min-w-0 flex-1 text-xs font-medium">
              No escuché nada, lo siento.
            </p>
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
