/**
 * Una tarjeta del historial: el texto del dictado y, si lo pides, qué pasó con él.
 *
 * Vivía dentro del `.map()` de Settings.tsx en cincuenta líneas. Con el panel de
 * detalle no cabía, y además necesita estado propio por tarjeta (abierto, y si
 * se está viendo el crudo o el final), que en un `.map()` no tiene dónde ir.
 *
 * Lo que se ve siempre es **un solo renglón**: fecha, modo de redacción y
 * cuántas correcciones hubo. El detalle —los chips, los tiempos, las muletillas
 * y los anglicismos— sale al pulsar la "i". Al pasar el ratón por cualquiera de
 * esos indicadores se resalta en el texto lo que cuenta, cada uno con su color;
 * y si lo suyo está en el otro texto, la tarjeta cambia sola al que toca.
 *
 * Nada de esto necesita guardar posiciones en la base de datos: los tramos se
 * buscan en el texto cuando hacen falta.
 */
import { useMemo, useState } from "react";
import type { Correction, HistoryItem, ListasAnalisis } from "../types";

/** Los cuatro indicadores, cada uno con su color. Sirve para el chip, para el
 *  resaltado y para el punto de color: un solo sitio donde cambiarlo. */
const TONOS = {
  correcciones: {
    chip: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/30",
    marca: "bg-blue-200/70 dark:bg-sky-500/30",
    punto: "bg-blue-500",
  },
  muletillas: {
    chip: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30",
    marca: "bg-amber-200/70 dark:bg-amber-500/30",
    punto: "bg-amber-500",
  },
  anglicismos: {
    chip: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/30",
    marca: "bg-violet-200/70 dark:bg-violet-500/30",
    punto: "bg-violet-500",
  },
  tiempos: {
    chip: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:ring-slate-600",
    marca: "",
    punto: "bg-slate-400",
  },
} as const;

type Indicador = keyof typeof TONOS;

const MODOS: Record<string, string> = {
  reglas: "Tal cual",
  estandar: "Estándar",
  editor: "Editor",
};

/** Escapa lo que va a ir dentro de un regex. Los términos salen del diccionario
 *  del usuario y de las listas, así que pueden traer paréntesis o signos. */
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Bordes de palabra que entienden español.
 *
 *  El borde de palabra de JavaScript sólo cuenta como letra el ASCII, así que
 *  "más bien" no casaba con su propio patrón y las muletillas con signos
 *  —"¿sabes?", "¿no?"— no se contaban jamás. Aquí el borde es "no hay una
 *  letra pegada", con las acentuadas y la eñe dentro. */
const LETRA = "0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ";
const conBordes = (t: string) => `(?<![${LETRA}])${escapar(t)}(?![${LETRA}])`;

/** Cuántas veces aparece cada término, y el regex para resaltarlos. */
function buscar(texto: string, terminos: string[]) {
  const presentes = terminos.filter((t) =>
    new RegExp(conBordes(t), "iu").test(texto),
  );
  const total = terminos.reduce(
    (n, t) => n + (texto.match(new RegExp(conBordes(t), "giu"))?.length ?? 0),
    0,
  );
  return { presentes, total };
}

/** Parte el texto en tramos, marcando los que coinciden. Devuelve tramos y no
 *  HTML para no tener que usar dangerouslySetInnerHTML sobre texto del usuario. */
function tramos(
  texto: string,
  terminos: string[],
): { t: string; marca: boolean }[] {
  if (terminos.length === 0) return [{ t: texto, marca: false }];
  const re = new RegExp(
    `(?<![${LETRA}])(${terminos.map(escapar).join("|")})(?![${LETRA}])`,
    "giu",
  );
  const out: { t: string; marca: boolean }[] = [];
  let i = 0;
  for (const m of texto.matchAll(re)) {
    if (m.index > i) out.push({ t: texto.slice(i, m.index), marca: false });
    out.push({ t: m[0], marca: true });
    i = m.index + m[0].length;
  }
  if (i < texto.length) out.push({ t: texto.slice(i), marca: false });
  return out;
}

const seg = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function TarjetaDictado(props: {
  h: HistoryItem;
  listas: ListasAnalisis | null;
  fmtDate: (ts: number) => string;
  onBorrar: () => void;
}) {
  const { h, listas } = props;
  const [abierto, setAbierto] = useState(false);
  const [verCrudo, setVerCrudo] = useState(false);
  const [resaltado, setResaltado] = useState<Indicador | null>(null);
  const [copiado, setCopiado] = useState(false);
  /** El pulido no tocó nada: crudo y final son el mismo texto. */
  const sinCambios = h.raw.trim() === h.polished.trim();

  const analisis = useMemo(() => {
    // Sólo con el panel abierto, que es el único sitio donde se enseña. Hecho
    // para las cien tarjetas a la vez, abrir la pestaña Historial costaba unos
    // 64 ms en vez de 17: ~270 expresiones regulares por tarjeta.
    if (!listas || !abierto) return null;
    // Las muletillas se cuentan por DIFERENCIA: las que estaban en el crudo y ya
    // no están en el final. Así una palabra que también es muletilla —"este
    // documento", "pues bien"— no infla el número, porque aparece en los dos.
    const enCrudo = buscar(h.raw, listas.muletillas);
    const enFinal = buscar(h.polished, listas.muletillas);
    // Los anglicismos se buscan en los DOS textos: el chip cuenta los del final
    // —que es el que te llevas— pero al resaltar sobre el crudo hay que conocer
    // también los que sólo estaban ahí, o no se marcaría ninguno.
    const angFinal = buscar(h.polished, listas.anglicismos);
    const angCrudo = buscar(h.raw, listas.anglicismos);
    return {
      muletillas: Math.max(0, enCrudo.total - enFinal.total),
      // Las que había, para que el número del chip cuadre con lo que se
      // enciende al pasar el ratón: se resaltan todas las del crudo, no sólo
      // las que se fueron.
      muletillasCrudo: enCrudo.total,
      muletillasTerminos: enCrudo.presentes,
      anglicismos: angFinal.total,
      anglicismosTerminos: [
        ...new Set([...angFinal.presentes, ...angCrudo.presentes]),
      ],
      palabrasCrudo: h.raw.split(/\s+/).filter(Boolean).length,
      palabrasFinal: h.polished.split(/\s+/).filter(Boolean).length,
    };
  }, [h.raw, h.polished, listas, abierto]);

  // Cada indicador resalta sobre el texto donde se le ve. Las muletillas sólo
  // existen en el crudo; las correcciones, en el final.
  // Los tiempos no resaltan nada —no hay tramo de texto que sea "2,4 s"—, así
  // que su chip no llama a onHover y no necesita entrada aquí.
  const textoDe: Record<Exclude<Indicador, "tiempos">, "raw" | "polished"> = {
    correcciones: "polished",
    muletillas: "raw",
    anglicismos: verCrudo ? "raw" : "polished",
  };
  const cual =
    resaltado && resaltado !== "tiempos"
      ? textoDe[resaltado]
      : verCrudo
        ? "raw"
        : "polished";
  const texto = cual === "raw" ? h.raw : h.polished;

  const terminosResaltados =
    resaltado === "correcciones"
      ? h.corrections
          // Sin el dato (dictados de antes de la 0.11) no se sabe si llegó:
          // no se resalta nada en vez de adivinar.
          .filter((c) => (c.aplicadas ?? 0) > 0)
          .map((c) => c.replacement)
      : resaltado === "muletillas"
        ? (analisis?.muletillasTerminos ?? [])
        : resaltado === "anglicismos"
          ? (analisis?.anglicismosTerminos ?? [])
          : [];

  const marca = resaltado ? TONOS[resaltado].marca : "";
  const nCorr = h.corrections.reduce((n, c) => n + c.count, 0);
  // En las mismas unidades que `nCorr` —veces, no términos—: si no, un término
  // corregido ×3 y otro que no llegó ×2 salían «5 correcciones (1 sin aplicar)».
  const ignoradas = h.corrections
    .filter((c) => c.aplicadas === 0)
    .reduce((n, c) => n + c.count, 0);

  return (
    <li className="group rounded-xl bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
      <div className="flex items-start gap-2">
        {/*
          Los dos textos ocupan **la misma celda** de la rejilla, y el que no se
          ve sigue ocupando su sitio (`invisible`, no `hidden`). Así el bloque
          mide siempre lo que el más largo de los dos y **cambiar de uno a otro
          no mueve nada de lo que hay debajo**.

          No es una floritura, es el arreglo de un bug que hacía vibrar la
          pantalla entera. Los chips van DEBAJO del texto, y pasarles el ratón
          cambia el texto —las muletillas sólo existen en el crudo, así que la
          tarjeta se cambia sola para poder resaltarlas—. Si ese cambio mueve el
          párrafo, mueve los chips, el ratón deja de estar encima, se deshace el
          resaltado, el párrafo vuelve a su alto, el chip vuelve bajo el ratón…
          y otra vez. Medido sobre el historial real: **17 de cada 100 tarjetas**
          cambian de alto al menos un renglón entre crudo y final, y en ésas
          entraba en bucle.

          El texto oculto sólo se monta con el panel abierto, que es la única
          situación en la que hay un chip al que pasarle el ratón. Con el panel
          cerrado no hace falta pagar el doble de nodos por tarjeta.
        */}
        <div className="grid min-w-0 flex-1">
          <p className="col-start-1 row-start-1 whitespace-pre-wrap text-slate-800 dark:text-slate-100">
            {tramos(texto, terminosResaltados).map((x, i) =>
              x.marca ? (
                <mark key={i} className={`rounded px-0.5 text-inherit ${marca}`}>
                  {x.t}
                </mark>
              ) : (
                <span key={i}>{x.t}</span>
              ),
            )}
          </p>
          {abierto && !sinCambios && (
            <p
              aria-hidden
              className="invisible col-start-1 row-start-1 whitespace-pre-wrap"
            >
              {cual === "raw" ? h.polished : h.raw}
            </p>
          )}
        </div>
        {/* Crudo/final arriba a la derecha, fuera del panel: es lo que estás
            leyendo, no un detalle escondido. */}
        {/* Cuando el pulido no cambió nada, el interruptor no tiene qué
            enseñar: dejarlo vivo parece que está roto —pulsas y no pasa nada—
            cuando lo que pasa es que los dos textos son el mismo. Se apaga y lo
            dice, que además es un dato útil: significa que ese modo no tocó tu
            dictado. */}
        <button
          type="button"
          disabled={sinCambios}
          onClick={() => setVerCrudo((v) => !v)}
          title={
            sinCambios
              ? "Este dictado salió igual que lo dijiste: el pulido no cambió nada"
              : verCrudo
                ? "Estás viendo lo que salió de la voz, sin redactar"
                : "Ver lo que salió de la voz, antes de redactar"
          }
          className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide transition-colors ${
            sinCambios
              ? "cursor-default text-slate-300 dark:text-slate-600"
              : cual === "raw"
                ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                : "text-slate-400 hover:bg-slate-200 dark:text-slate-500 dark:hover:bg-slate-700"
          }`}
        >
          {sinCambios ? "SIN CAMBIOS" : cual === "raw" ? "CRUDO" : "FINAL"}
        </button>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400 dark:text-slate-500">
        <span>{props.fmtDate(h.ts)}</span>
        {h.polish_mode && (
          <span className="font-medium text-slate-500 dark:text-slate-400">
            {MODOS[h.polish_mode] ?? h.polish_mode}
          </span>
        )}
        <span>
          {nCorr === 0
            ? "sin correcciones"
            : `${nCorr} ${nCorr === 1 ? "corrección" : "correcciones"}`}
          {ignoradas > 0 && (
            <span className="text-amber-600 dark:text-amber-400">
              {" "}
              ({ignoradas} sin aplicar)
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => setAbierto((a) => !a)}
          aria-expanded={abierto}
          title="Qué pasó con este dictado"
          className={`flex h-[18px] w-[18px] items-center justify-center rounded-full border text-[10px] font-bold transition-colors ${
            abierto
              ? "border-blue-500 bg-blue-500 text-white dark:border-sky-400 dark:bg-sky-400 dark:text-slate-900"
              : "border-slate-300 hover:border-blue-500 hover:text-blue-600 dark:border-slate-600 dark:hover:border-sky-400"
          }`}
        >
          i
        </button>
        <button
          className={`ml-auto opacity-0 transition-opacity group-hover:opacity-100 ${
            copiado
              ? "font-medium text-emerald-600 opacity-100 dark:text-emerald-400"
              : "hover:text-blue-600 dark:hover:text-sky-400"
          }`}
          onClick={() => {
            navigator.clipboard.writeText(texto).then(() => {
              setCopiado(true);
              window.setTimeout(() => setCopiado(false), 1500);
            });
          }}
        >
          {copiado ? "¡Copiado!" : "Copiar"}
        </button>
        <button
          className="opacity-0 transition-opacity hover:text-amber-600 group-hover:opacity-100 dark:hover:text-amber-400"
          onClick={props.onBorrar}
        >
          Eliminar
        </button>
      </div>

      {abierto && (
        <div className="mt-2 flex flex-col gap-2 border-t border-slate-200 pt-2 dark:border-slate-700">
          <div className="flex flex-wrap gap-1.5">
            {h.corrections.length > 0 && (
              <Indicativo
                tipo="correcciones"
                activo={resaltado === "correcciones"}
                onHover={setResaltado}
              >
                {/* El mismo número que el renglón de arriba, no otro. */}
                {nCorr} {nCorr === 1 ? "corrección" : "correcciones"}
              </Indicativo>
            )}
            {analisis && analisis.muletillas > 0 && (
              <Indicativo
                tipo="muletillas"
                activo={resaltado === "muletillas"}
                onHover={setResaltado}
              >
                {analisis.muletillas} de {analisis.muletillasCrudo} muletillas
                fuera · {analisis.palabrasCrudo} → {analisis.palabrasFinal}{" "}
                palabras
              </Indicativo>
            )}
            {analisis && analisis.anglicismos > 0 && (
              <Indicativo
                tipo="anglicismos"
                activo={resaltado === "anglicismos"}
                onHover={setResaltado}
              >
                {analisis.anglicismos} en inglés
              </Indicativo>
            )}
            {h.stt_ms !== null && (
              <Indicativo tipo="tiempos" activo={false} onHover={() => {}}>
                hablaste {seg(h.duration_ms)} · transcribir {seg(h.stt_ms)}
                {h.polish_ms !== null && ` · redactar ${seg(h.polish_ms)}`}
              </Indicativo>
            )}
          </div>

          {h.corrections.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {h.corrections.map((c, i) => (
                <ChipCorreccion key={i} c={c} />
              ))}
            </div>
          )}

          {h.stt_ms === null && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              De este dictado no se guardó el modo ni los tiempos: son datos que
              Dicho empezó a apuntar en la 0.11.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function Indicativo(props: {
  tipo: Indicador;
  activo: boolean;
  onHover: (t: Indicador | null) => void;
  children: React.ReactNode;
}) {
  const t = TONOS[props.tipo];
  return (
    <span
      onMouseEnter={() => props.onHover(props.tipo)}
      onMouseLeave={() => props.onHover(null)}
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 transition-shadow ${t.chip} ${
        props.activo ? "ring-2" : ""
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${t.punto}`} />
      {props.children}
    </span>
  );
}

/** Un reemplazo del diccionario. Desde la 0.12 el diccionario se aplica
 *  después de pulir, así que si el reemplazo no está en el texto final no es
 *  que el modelo lo ignorara: es que reescribió o quitó el término antes de
 *  que el diccionario pasara. Se dice, en vez de dejar creer que se aplicó. */
function ChipCorreccion({ c }: { c: Correction }) {
  const ignorada = c.aplicadas === 0;
  return (
    <span
      title={
        ignorada
          ? "El modelo cambió esta palabra antes de que tu diccionario pudiera corregirla: en el texto final no está"
          : "Corregido por tu diccionario"
      }
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${
        ignorada
          ? "bg-slate-100 text-slate-400 ring-slate-200 dark:bg-slate-800 dark:text-slate-500 dark:ring-slate-700"
          : TONOS.correcciones.chip
      }`}
    >
      <span className="line-through opacity-60">{c.term}</span>
      <span>→</span>
      <span>{c.replacement}</span>
      {c.count > 1 && <span className="opacity-60">×{c.count}</span>}
      {ignorada && <span className="ml-0.5 italic opacity-80">no llegó</span>}
    </span>
  );
}
