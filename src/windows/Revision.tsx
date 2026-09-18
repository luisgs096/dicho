import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

/**
 * La ventana que sale al corregir un texto que ya estaba escrito.
 *
 * Existe porque corregir texto ajeno no es como dictar: **el original ya vale
 * algo**. En un dictado, si el pulido sale mal, lo peor que pasa es que repitas;
 * aquí lo peor que pasa es que pierdas lo que habías escrito. Así que Dicho no
 * sustituye nada sin enseñarlo antes.
 *
 * El texto ya está en el portapapeles cuando esta ventana aparece, así que
 * cerrarla no pierde el trabajo: el botón es un atajo, no la única salida.
 */
export default function Revision() {
  const [original, setOriginal] = useState("");
  const [corregido, setCorregido] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    const un = listen<{ original: string; corregido: string }>(
      "revision",
      (e) => {
        setOriginal(e.payload.original);
        setCorregido(e.payload.corregido);
        setAviso(null);
        setCopiado(false);
      },
    );
    return () => {
      un.then((f) => f());
    };
  }, []);

  const cerrar = () => getCurrentWebviewWindow().hide();

  const sustituir = () =>
    invoke("escribano_sustituir").catch((e) => setAviso(String(e)));

  // El texto ya está copiado desde antes de abrirse la ventana; esto sólo lo
  // vuelve a poner por si el usuario copió otra cosa mientras leía.
  const copiar = () => {
    navigator.clipboard.writeText(corregido).then(
      () => {
        setCopiado(true);
        setTimeout(() => setCopiado(false), 1600);
      },
      () => setAviso("No pude copiarlo. Selecciónalo y cópialo a mano."),
    );
  };

  const palabras = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
  const sinCambios = original.trim() === corregido.trim();

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-800 dark:bg-slate-950 dark:text-slate-100">
      <header className="shrink-0 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
        <h1 className="text-sm font-semibold">Revisa antes de sustituir</h1>
        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
          Ya está copiado. <b>Sustituir</b> te devuelve a donde estabas y lo pega
          encima de lo que tenías seleccionado.
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
        <section className="flex min-h-0 flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Como estaba · {palabras(original)} palabras
          </span>
          <p className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-3 text-[13px] leading-relaxed text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            {original || "…"}
          </p>
        </section>

        <section className="flex min-h-0 flex-1 flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            Corregido · {palabras(corregido)} palabras
          </span>
          <p className="min-h-24 flex-1 overflow-y-auto whitespace-pre-wrap rounded-lg border border-emerald-300 bg-white p-3 text-[13px] leading-relaxed dark:border-emerald-800 dark:bg-slate-900">
            {corregido || "…"}
          </p>
        </section>

        {sinCambios && corregido && (
          <p className="rounded-lg bg-slate-100 px-3 py-2 text-[11px] text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            No hubo nada que cambiar: tu texto ya estaba bien.
          </p>
        )}

        {aviso && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            {aviso}
          </p>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
        <button
          onClick={cerrar}
          className="rounded-lg px-3 py-1.5 text-[12px] text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          Cerrar
        </button>
        <button
          onClick={copiar}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-medium hover:bg-white dark:border-slate-700 dark:hover:bg-slate-800"
        >
          {copiado ? "¡Copiado!" : "Copiar otra vez"}
        </button>
        <button
          onClick={sustituir}
          disabled={!corregido || sinCambios}
          className="rounded-lg bg-emerald-600 px-4 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
        >
          Sustituir
        </button>
      </footer>
    </div>
  );
}
