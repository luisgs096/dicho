import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { comparar, type Tipo, type Tramo } from "./diferencias";

/**
 * El globo del escribano: sale de la onda, como si hablara ella, con lo que
 * corrigió.
 *
 * Existe porque corregir texto ajeno no es como dictar: **el original ya vale
 * algo**. En un dictado, si el pulido sale mal, lo peor que pasa es que repitas;
 * aquí lo peor que pasa es que pierdas lo que habías escrito. Así que Dicho no
 * sustituye nada sin enseñarlo antes.
 *
 * Fue una ventana normal de 560×460 con los dos textos enteros uno encima del
 * otro, y había que leerlos los dos para encontrar qué cambió. Luego fue este
 * globo con las erratas repetidas en fichas debajo del texto, y las fichas se
 * comían más de la mitad del globo. Ahora es sólo el texto con los cambios
 * marcados: **pasar el ratón por uno enseña cómo estaba**.
 *
 * **No toma el foco**, igual que la onda: la ventana donde copiaste sigue
 * delante, y «Sustituir» pega ahí. Por eso «Copiar» lo hace Rust: sin foco el
 * navegador no deja escribir en el portapapeles.
 */

type Datos = { original: string; corregido: string };

/** Cómo se marca cada tipo de cambio en el texto corregido. Sólo las erratas
 *  llevan fondo: con todo pintado —tildes y comas incluidas— el mensaje de
 *  prueba quedaba con quince manchas y las tres que importaban no destacaban.
 *  Los acentos van subrayados, y los signos sólo se cuentan arriba. */
const MARCA: Record<Tipo, string> = {
  errata: "bg-emerald-200/80 dark:bg-emerald-500/35",
  acento: "underline decoration-sky-400/80 decoration-2 underline-offset-2",
  signo: "",
};
/** Lo mismo en el original: sólo se tacha lo que estaba mal escrito. Tachar
 *  «que» porque le faltaba la tilde parecía decir que esa palabra se borró. */
const MARCA_ANTES: Record<Tipo, string> = {
  errata: "bg-rose-200/60 line-through decoration-rose-500/60 dark:bg-rose-500/25",
  acento: "underline decoration-rose-400/70 decoration-2 underline-offset-2",
  signo: "",
};

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** El texto de cada cambio en un lado, por su número: es lo que enseña la
 *  etiqueta al pasar el ratón por el otro lado. */
const textoPorCambio = (tramos: Tramo[]) => {
  const m = new Map<number, string>();
  for (const t of tramos)
    if (t.cambio !== null) m.set(t.cambio, (m.get(t.cambio) ?? "") + t.texto);
  return m;
};

export default function Revision() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [ver, setVer] = useState<"despues" | "antes">("despues");
  const [pico, setPico] = useState<"abajo" | "arriba">("abajo");
  const [aviso, setAviso] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  // La etiqueta de «así estaba»: qué dice y dónde, en coordenadas de la ventana.
  const [etiqueta, setEtiqueta] = useState<{ texto: string; x: number; y: number; abajo: boolean } | null>(null);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const poner = (p: Datos) => {
      setDatos(p);
      setVer("despues");
      setAviso(null);
      setCopiado(false);
    };
    // El globo se crea al usarlo: el primer texto llegó antes de que escuchara,
    // así que lo pide él. Los siguientes llegan por el evento.
    invoke<Datos | null>("revision_pendiente").then((p) => p && poner(p));
    const un = listen<Datos>("revision", (e) => poner(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);

  // El alto lo pone el contenido: se mide y Rust ajusta la ventana y la pega a
  // la onda. Y se vuelve a pegar cuando sueltas la onda en otro sitio.
  useLayoutEffect(() => {
    const el = caja.current;
    if (!el) return;
    const medir = () =>
      invoke<string>("revision_colocar", { alto: Math.ceil(el.getBoundingClientRect().height) })
        .then((p) => setPico(p === "arriba" ? "arriba" : "abajo"))
        .catch(() => {});
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    const un = listen<boolean>("hud-arrastre", (e) => {
      if (!e.payload) medir();
    });
    return () => {
      ro.disconnect();
      un.then((f) => f());
    };
  }, []);

  const dif = useMemo(() => (datos ? comparar(datos.original, datos.corregido) : null), [datos]);
  const otroLado = useMemo(
    () => (dif ? textoPorCambio(ver === "despues" ? dif.antes : dif.despues) : new Map()),
    [dif, ver],
  );
  const cuenta = (t: Tipo) => dif?.cambios.filter((c) => c.tipo === t).length ?? 0;
  const sinCambios = !!dif && dif.cambios.length === 0;
  const resumen = sinCambios
    ? "Tu texto ya estaba bien"
    : [
        cuenta("errata") && plural(cuenta("errata"), "errata", "erratas"),
        cuenta("acento") && plural(cuenta("acento"), "acento", "acentos"),
        cuenta("signo") && plural(cuenta("signo"), "signo", "signos"),
      ]
        .filter(Boolean)
        .join(" · ");

  const cerrar = () => invoke("revision_cerrar");
  const sustituir = () => invoke("escribano_sustituir").catch((e) => setAviso(String(e)));
  // Copia y se va: lo que sigue es pegarlo tú, y el globo ya no pinta nada.
  const copiar = () =>
    invoke("revision_copiar").then(
      () => {
        setCopiado(true);
        setTimeout(cerrar, 900);
      },
      (e) => setAviso(String(e)),
    );

  /** Al pasar por un cambio, la etiqueta con cómo estaba (o cómo quedó, si se
   *  está viendo el original). Va encima de la palabra; en la primera línea no
   *  cabría, así que ahí va debajo. */
  const mostrar = (cambio: number, el: HTMLElement) => {
    // El primer renglón y no la caja entera: un cambio partido en dos líneas
    // («¿Quién sabe? :c» al final de una) dejaba la etiqueta en medio de nada.
    const r = el.getClientRects()[0] ?? el.getBoundingClientRect();
    const otro = (otroLado.get(cambio) ?? "").trim();
    const texto =
      ver === "despues"
        ? otro
          ? `antes: ${otro}`
          : "esto no estaba"
        : otro
          ? `quedó: ${otro}`
          : "esto se quitó";
    const abajo = r.top < 40;
    setEtiqueta({
      texto,
      x: Math.min(Math.max(r.left + r.width / 2, 70), window.innerWidth - 70),
      y: abajo ? r.bottom + 4 : r.top - 4,
      abajo,
    });
  };

  const tramos = dif ? (ver === "despues" ? dif.despues : dif.antes) : [];

  // El pico del globo apunta a la onda: abajo si el globo salió encima de ella.
  const colaPico = (
    <div
      className={`relative z-10 h-3 w-3 rotate-45 border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 ${
        pico === "abajo" ? "-mt-[7px] border-r border-b" : "-mb-[7px] border-t border-l"
      }`}
    />
  );

  return (
    <div ref={caja} className="flex flex-col items-center px-2 py-1 select-none">
      <style>{"html, body, #root { overflow: hidden; background: transparent; }"}</style>
      {pico === "arriba" && colaPico}
      <div className="w-full rounded-2xl border border-slate-200 bg-white p-3 text-slate-800 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
            ✒ Corregí esto
          </span>
          <span className="truncate text-[11px] text-slate-400">{resumen}</span>
        </div>

        {!sinCambios && (
          <div className="mt-2 flex gap-1 text-[10px] font-medium">
            {(
              [
                ["despues", "Corregido"],
                ["antes", "Como estaba"],
              ] as const
            ).map(([v, texto]) => (
              <button
                key={v}
                onClick={() => setVer(v)}
                className={`rounded-full px-2 py-0.5 ${
                  ver === v
                    ? "bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900"
                    : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                }`}
              >
                {texto}
              </button>
            ))}
          </div>
        )}

        <p
          className="mt-2 max-h-36 overflow-y-auto text-[13px] leading-relaxed whitespace-pre-wrap select-text"
          onScroll={() => setEtiqueta(null)}
        >
          {tramos.map((t, k) =>
            t.cambio === null ? (
              <span key={k}>{t.texto}</span>
            ) : (
              <span
                key={k}
                onMouseEnter={(e) => mostrar(t.cambio!, e.currentTarget)}
                onMouseLeave={() => setEtiqueta(null)}
                className={`cursor-help rounded-sm ${
                  (ver === "despues" ? MARCA : MARCA_ANTES)[dif!.cambios[t.cambio].tipo]
                }`}
              >
                {t.texto}
              </span>
            ),
          )}
          {!datos && "…"}
        </p>

        {aviso && (
          <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            {aviso}
          </p>
        )}

        <div className="mt-3 flex items-center justify-end gap-1.5">
          <button
            onClick={cerrar}
            className="mr-auto rounded-lg px-2.5 py-1 text-[11px] text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            {sinCambios ? "Cerrar" : "Dejarlo así"}
          </button>
          {!sinCambios && (
            <>
              <button
                onClick={copiar}
                disabled={!datos}
                className="rounded-lg border border-slate-300 px-3 py-1 text-[11px] font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800"
              >
                {copiado ? "¡Copiado!" : "Copiar"}
              </button>
              <button
                onClick={sustituir}
                disabled={!datos}
                className="rounded-lg bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Sustituir
              </button>
            </>
          )}
        </div>
      </div>
      {pico === "abajo" && colaPico}

      {etiqueta && (
        <div
          className="pointer-events-none fixed z-20 rounded-md bg-slate-800 px-2 py-0.5 text-[11px] whitespace-nowrap text-white shadow dark:bg-slate-100 dark:text-slate-900"
          style={{
            left: etiqueta.x,
            top: etiqueta.y,
            transform: `translate(-50%, ${etiqueta.abajo ? "0" : "-100%"})`,
          }}
        >
          {etiqueta.texto}
        </div>
      )}
    </div>
  );
}
