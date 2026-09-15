import { useEffect, useState } from "react";
import { ESTADOS, FACE_CSS, MIC_SVG, V, cssVars, type FaceState } from "./faces";
import type { AppSettings } from "../types";

type Estilo = AppSettings["hud_style"];

/** El recorrido que ve el usuario. `reposo` se queda fuera: dura un instante y
 *  en una vista previa sólo confunde. */
const TOUR: FaceState[] = ["escuchando", "pensando", "listo", "no-entendi"];
/** Lo que dura cada estado en pantalla. Suficiente para que el gesto de la
 *  carita (bucles de ≤1,4 s) se vea entero al menos una vez. */
const MS_POR_ESTADO = 2600;

/** Barras del estilo clásico, bailando solas: aquí no hay micrófono que las
 *  mueva, así que el vaivén lo pone el CSS. Los desfases imitan la ondulación
 *  real (el centro reacciona primero, las orillas después). */
const BARRAS_CSS = `
  .vp-bar { width: 8px; border-radius: 999px; animation: vpbar 1.1s ease-in-out infinite; }
  @keyframes vpbar { 0%, 100% { height: 8px; } 50% { height: 26px; } }
  .vp-bar-sad { width: 8px; border-radius: 999px; animation: vpdroop 2.4s ease-in-out infinite; }
  @keyframes vpdroop { 0%, 100% { height: 8px; } 15% { height: 13px; } 30%, 90% { height: 6px; } }
`;
const DESFASE = [0.22, 0.11, 0, 0.11, 0.22];

/** El mismo texto que enseña el HUD de verdad en cada estado. */
const CLASSIC_TEXTO: Record<FaceState, string> = {
  escuchando: "Te escucho",
  pensando: "Escribiendo…",
  listo: "Listo, ya lo pegué",
  "no-entendi": "Perdón, no escuché, ¿puedes repetir?",
  reposo: "Dicho",
};

/**
 * Vista previa de los dos estilos de la onda flotante, animándose de verdad y
 * en el mismo momento del recorrido, para poder compararlos de un vistazo.
 *
 * Pinta con los mismos sprites y el mismo CSS que el HUD (`faces.ts`), así que
 * lo que se ve aquí es exactamente lo que saldrá al dictar. A tamaño real y sin
 * escalar a propósito: el pixel-art se deforma en cuanto lo estiras.
 */
export default function VistaPrevia(props: {
  value: Estilo;
  onChange: (v: Estilo) => void;
}) {
  const [dark, setDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [paso, setPaso] = useState(0);
  const [nivel, setNivel] = useState(0.3);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onTheme = (e: MediaQueryListEvent) => setDark(e.matches);
    mql.addEventListener("change", onTheme);
    return () => mql.removeEventListener("change", onTheme);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setPaso((p) => p + 1), MS_POR_ESTADO);
    return () => clearInterval(t);
  }, []);

  // Volumen de mentira para las caritas reactivas (el DJ y el Pac-Man leen
  // --lvl). Sin esto se quedarían congeladas y parecerían rotas.
  useEffect(() => {
    const t = setInterval(() => setNivel(0.15 + Math.random() * 0.75), 140);
    return () => clearInterval(t);
  }, []);

  const estado = TOUR[paso % TOUR.length];
  const meta = ESTADOS.find((e) => e.key === estado)!;
  // Una carita distinta en cada vuelta: el repertorio son 5 por estado y
  // enseñar siempre la misma haría creer que sólo hay una.
  const vuelta = Math.floor(paso / TOUR.length);
  const variante = V[estado][vuelta % V[estado].length];

  const vars = {
    ...cssVars(dark),
    "--lvl": estado === "escuchando" ? nivel.toFixed(2) : "0.12",
  } as React.CSSProperties;

  const tamagotchi = (
    <div className={`tama ${variante.sad ? "sad" : ""}`}>
      <div className="screen">
        <span className="mic-px" dangerouslySetInnerHTML={{ __html: MIC_SVG }} />
        <span className="scene">
          <svg
            viewBox="0 2 48 16"
            dangerouslySetInnerHTML={{ __html: variante.scene }}
          />
        </span>
        <span className="status">{variante.status}</span>
      </div>
    </div>
  );

  const triste = estado === "no-entendi";
  const clasico = (
    <div
      className={`flex h-[64px] w-[336px] items-center gap-3 overflow-hidden rounded-full border px-5 shadow-xl backdrop-blur ${
        triste
          ? "border-orange-200 bg-orange-50/95 text-orange-900 dark:border-orange-400/30 dark:bg-slate-900/90 dark:text-orange-200"
          : "border-slate-200/80 bg-white/95 text-slate-700 dark:border-white/10 dark:bg-slate-900/90 dark:text-slate-200"
      }`}
    >
      {!triste && estado !== "listo" && (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white dark:bg-sky-500">
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
            <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z" />
            <path d="M18 11a6 6 0 0 1-12 0H4a8 8 0 0 0 7 7.94V22h2v-3.06A8 8 0 0 0 20 11h-2Z" />
          </svg>
        </span>
      )}
      {estado === "listo" && (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white dark:bg-sky-500">
          ✓
        </span>
      )}
      <div className={`flex h-8 items-center gap-2.5 ${triste ? "shrink-0 pl-1" : "flex-1 justify-center"}`}>
        {estado !== "listo" &&
          DESFASE.map((d, i) => (
            <span
              key={i}
              className={triste ? "vp-bar-sad" : "vp-bar"}
              style={{
                height: 8,
                animationDelay: `${triste ? i * 0.12 : d}s`,
                backgroundColor: triste
                  ? dark
                    ? "#fb923c"
                    : "#ea7317"
                  : dark
                    ? "#38bdf8"
                    : "#2563eb",
                // Pensando: las barras siguen, pero apagadas y más lentas.
                animationDuration: estado === "pensando" ? "1.9s" : undefined,
                opacity: estado === "pensando" ? 0.5 : 1,
              }}
            />
          ))}
      </div>
      <span
        className={`shrink-0 text-[11px] font-medium ${
          triste ? "" : "text-slate-500 dark:text-slate-400"
        } ${estado === "listo" ? "flex-1 truncate text-left text-sm text-slate-700 dark:text-slate-200" : ""}`}
      >
        {CLASSIC_TEXTO[estado]}
      </span>
    </div>
  );

  const tarjeta = (id: Estilo, titulo: string, pie: string, hijo: React.ReactNode) => {
    const activo = props.value === id;
    return (
      <button
        type="button"
        onClick={() => props.onChange(id)}
        aria-pressed={activo}
        className={`flex w-full flex-col items-center gap-2.5 rounded-2xl border p-4 text-center transition-colors ${
          activo
            ? "border-blue-500 bg-blue-50/60 ring-2 ring-blue-500/20 dark:border-sky-400 dark:bg-sky-950/40 dark:ring-sky-400/20"
            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
        }`}
      >
        <div className="flex w-full items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <span
              className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                activo
                  ? "border-blue-600 dark:border-sky-400"
                  : "border-slate-300 dark:border-slate-600"
              }`}
            >
              {activo && (
                <span className="h-2 w-2 rounded-full bg-blue-600 dark:bg-sky-400" />
              )}
            </span>
            {titulo}
          </span>
          {activo && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-sky-400">
              En uso
            </span>
          )}
        </div>
        <div className="overflow-hidden">{hijo}</div>
        <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
          {pie}
        </p>
      </button>
    );
  };

  return (
    <div style={vars}>
      <style>{FACE_CSS + BARRAS_CSS}</style>

      <div className="mb-3 flex items-center gap-2.5">
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
          {meta.titulo}
        </span>
        <div className="flex gap-1">
          {TOUR.map((e, i) => (
            <span
              key={e}
              className={`h-1.5 rounded-full transition-all ${
                i === paso % TOUR.length
                  ? "w-5 bg-blue-500 dark:bg-sky-400"
                  : "w-1.5 bg-slate-300 dark:bg-slate-700"
              }`}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {tarjeta(
          "tamagotchi",
          "Caritas tamagotchi",
          "26 caritas distintas, 5 por estado, elegidas al azar. Dos se mueven con el volumen real de tu voz.",
          tamagotchi,
        )}
        {tarjeta(
          "classic",
          "Clásico",
          "Una pastilla limpia con cinco barras que crecen con tu voz. Discreta y sin sorpresas.",
          clasico,
        )}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
        {meta.cuando}
      </p>
    </div>
  );
}
