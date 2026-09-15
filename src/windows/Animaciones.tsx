import { useEffect, useState } from "react";
import { ESTADOS, FACE_CSS, MAREO, MIC_SVG, V, cssVars, type Variant } from "./faces";

/** Se cuenta sola: añadir una carita a faces.ts actualiza este número. */
const TOTAL = Object.values(V).reduce((n, l) => n + l.length, 0);

/**
 * Catálogo de las caritas del HUD. Pinta exactamente los mismos sprites y el
 * mismo CSS que la onda flotante (`faces.ts`), así que nunca se desincroniza
 * de lo que el usuario ve al dictar.
 */
export default function Animaciones({ onClose }: { onClose: () => void }) {
  const [dark, setDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [nivel, setNivel] = useState(0.4);
  const [doble, setDoble] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onTheme = (e: MediaQueryListEvent) => setDark(e.matches);
    mql.addEventListener("change", onTheme);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      mql.removeEventListener("change", onTheme);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const vars = {
    ...cssVars(dark),
    "--lvl": nivel.toFixed(2),
  } as React.CSSProperties;

  const pill = (v: Variant) => (
    <div className={`tama ${v.sad ? "sad" : ""}`}>
      <div className="screen">
        <span className="mic-px" dangerouslySetInnerHTML={{ __html: MIC_SVG }} />
        <span className="scene">
          <svg viewBox="0 2 48 16" dangerouslySetInnerHTML={{ __html: v.scene }} />
        </span>
        <span className="status">{v.status}</span>
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <style>{FACE_CSS}</style>

        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
              Las caritas de Dicho
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {TOTAL} en total: cinco por estado más el eructo, que sólo sale
              detrás de la comilona. En cada dictado toca una al azar, y ninguna
              tiene los ojos quietos: cada una usa un gesto distinto.
            </p>
          </div>
          <button
            className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            onClick={onClose}
          >
            Cerrar
          </button>
        </header>

        <div className="flex flex-wrap items-center gap-5 border-b border-slate-200 px-6 py-3 dark:border-slate-800">
          <label className="flex items-center gap-2.5">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Tu voz
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(nivel * 100)}
              onChange={(e) => setNivel(Number(e.target.value) / 100)}
              className="w-32 accent-blue-600"
              aria-label="Nivel de voz simulado"
            />
          </label>
          <button
            className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            onClick={() => setDoble((d) => !d)}
          >
            {doble ? "Tamaño real" : "Ver al doble"}
          </button>
          <span className="text-xs text-slate-400 dark:text-slate-500">
            El deslizador mueve las caritas que reaccionan al volumen.
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5" style={vars}>
          {ESTADOS.map(({ key, titulo, cuando }) => (
            <section key={key} className="mb-7 last:mb-1">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                {titulo}
              </h3>
              <p className="mb-3 max-w-xl text-xs text-slate-500 dark:text-slate-400">
                {cuando}
              </p>
              <div className="flex flex-col gap-2.5">
                {V[key].map((v, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3"
                    style={doble ? { height: 132 } : undefined}
                  >
                    <span className="w-4 shrink-0 font-mono text-[11px] text-slate-400 dark:text-slate-500">
                      {i + 1}
                    </span>
                    <div
                      style={
                        doble
                          ? { transform: "scale(2)", transformOrigin: "left center" }
                          : undefined
                      }
                    >
                      {pill(v)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}

          <section className="mb-1 border-t border-dashed border-slate-300 pt-6 dark:border-slate-700">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              El mareo
            </h3>
            <p className="mb-3 max-w-xl text-xs text-slate-500 dark:text-slate-400">
              No salen dictando. Ve a Inicio, pulsa «Seleccionar posición en
              pantalla» y zarandea la onda con el ratón: cada sacudida sube un
              escalón y se va poniendo peor.
            </p>
            <div className="flex flex-col gap-2.5">
              {MAREO.map((v, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3"
                  style={doble ? { height: 132 } : undefined}
                >
                  <span className="w-4 shrink-0 font-mono text-[11px] text-slate-400 dark:text-slate-500">
                    {i + 1}
                  </span>
                  <div
                    style={
                      doble
                        ? { transform: "scale(2)", transformOrigin: "left center" }
                        : undefined
                    }
                  >
                    {pill(v)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
