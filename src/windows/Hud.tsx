import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppSettings, HudStyle, PolishKind, RecordingState } from "../types";
import {
  CARITA_COMILONA,
  CARITA_ERUCTO,
  ACTUALIZADO,
  LEYENDO,
  OJOS_MAREADOS,
  CARITA_CANCELADO,
  FACE_CSS,
  BAJANDO,
  CURIOSEANDO,
  LIMPIADAS,
  MAREO,
  RODANDO,
  MIC_SVG,
  PALETA_CLARA,
  PALETA_OSCURA,
  V,
  cssVars,
  type FaceState,
} from "./faces";

function hudLog(msg: string) {
  invoke("hud_log", { msg }).catch(() => {});
}

/** El micro del LCD, en un objeto fijo: ver `escenaHtml` más abajo. */
const MIC_HTML = { __html: MIC_SVG };

// ─── paletas del tamagotchi (mismos colores de Dicho) ───────────────────────
// Las de faces.ts, no una copia: la copia que vivía aquí se quedó sin
// --pergamino, --pergaminoBorde y --tinta cuando nació el modo lectura, y en la
// onda de verdad el LCD del escribano salía transparente, con el aro del color
// de la cara y los huecos de los lentes pintados de negro. La vista previa y el
// catálogo ya usaban las de faces.ts, pero ninguno enseña el pergamino: el
// fallo sólo existía donde nadie lo miraba con calma.
const LIGHT = PALETA_CLARA;
const DARK = PALETA_OSCURA;

// ─── modo clásico: barras que crecen con la intensidad de la voz ────────────
/** Historial de niveles de voz que alimenta las barras. */
const HISTORY = 16;
/** Desfase por barra (centro reacciona primero, orillas después → ondulación). */
const BAR_LAG = [4, 2, 0, 2, 4];
/** Ganancia por barra: arco simétrico, el centro sube más que las orillas. */
const BAR_GAIN = [0.72, 0.9, 1, 0.9, 0.72];
/** Altura de las barras en px (reposo → pico). */
const BAR_MIN = 8;
const BAR_MAX = 30;

/** Lo que aguanta cada escalón del mareo antes de dejar pasar al siguiente:
 *  un bucle entero de la carita (los más largos duran 1,4 s) y un respiro. */
const PLANTON_MAREO = 1600;

/** Hasta dónde llega la escalada del zarandeo: `MAREO` son los tres escalones
 *  —mareada, aguantándose, vomita— y al último se llega meneando. */
const VOMITO = MAREO.length;

/** Lo que tarda en levantarse la barandilla y quedarse la cara sola: un ciclo
 *  entero del flipbook de `BAJANDO`. Va con la clase `una-vez`, así que al
 *  acabar se queda en su último cuadro —la cara sola— y el fundido se lo come
 *  sin que la barandilla vuelva a bajar. */
const BAJARSE_MS = 1200;

/** Ya en el suelo, mira a los lados: una vuelta entera de `CURIOSEANDO`. Es el
 *  final que prometía la bajada —«queda la cara mirando a los lados»— y que el
 *  HUD nunca llegó a enseñar: de la barandilla saltaba directo al reposo, que
 *  puede ser el dormido. */
const CURIOSEAR_MS = 2400;

/** Y un escalón más, al que **no** se llega meneando: limpiarse la boca. Del
 *  cuarto tiempo se encarga el reloj, que no se le puede pedir al usuario que
 *  siga zarandeando para ver cómo se le pasa. */
const LIMPIANDO = VOMITO + 1;

/** Lo que se queda la cara limpia a la vista antes de fundir, con la limpiada
 *  ya terminada y quieta en su último cuadro: sin esto la sonrisa del final
 *  salía y se iba en el mismo instante. */
const REMATE_LIMPIA = 800;

/** Vueltas enteras alrededor de la onda que marean a los ojos que te siguen, y
 *  en cuánto tiempo hay que darlas. Dos en tres segundos es un gesto que se
 *  hace a propósito: trabajando, el cursor no rodea la onda ni una vez. */
const VUELTAS_MAREO = 2;
const VENTANA_VUELTAS = 3000;

/** En qué casilla va la pupila en un eje: -1, 0 o 1, nunca a medio píxel —la
 *  regla de las coordenadas enteras vale también para lo que mueve el cursor—.
 *
 *  Con histéresis: para salir del centro hay que pasar de 0,2 (120 px) y para
 *  volver hay que bajar de 0,12. Con un solo umbral, el cursor parado justo en
 *  la raya haría tiritar la pupila entre dos casillas. */
function casillaPupila(v: number, actual: number): number {
  const umbral = actual === 0 ? 0.2 : 0.12;
  return v > umbral ? 1 : v < -umbral ? -1 : 0;
}

const CLASSIC_CSS = `
  .classic-shake { animation: cshake .55s ease-in-out; }
  @keyframes cshake { 0%, 100% { transform: translateX(0); }
    15% { transform: translateX(-5px); } 30% { transform: translateX(4px); }
    45% { transform: translateX(-3px); } 60% { transform: translateX(2px); }
    75% { transform: translateX(-1px); } }
  @keyframes cdroop { 0%, 100% { height: 8px; } 15% { height: 13px; } 30%, 90% { height: 6px; } }
  .cbar-sad { animation: cdroop 2.4s ease-in-out infinite; }
`;

// ─── arrastre ───────────────────────────────────────────────────────────────
// El movimiento de la ventana lo hace Windows en el backend (ver
// `overlay::arrastrar_con_cursor`); aquí sólo se ve que la estás agarrando.
const DRAG_CSS = `
  /* El HUD no se desliza nunca. Al cruzar entre monitores de distinto DPI,
     WebView2 se queda un rato con el lienzo viejo (medido: lienzo 1440x384
     con dpr 1.25), el contenido escalado se desborda y Windows le mete barras
     de scroll de las de verdad, que reservan 15 px y ya no se van: se ven como
     dos rayas en los costados y además encogen la carita. */
  html, body, #root { overflow: hidden; }
  ::-webkit-scrollbar { width: 0; height: 0; }
  .agarrable { cursor: grab; }
  /* El vómito rompiendo la cuarta pared: nace en el borde de abajo de la
     cápsula y chorrea por fuera, sobre la ventana. Sólo hay ocho píxeles de
     aire ahí debajo —la cápsula va pegada abajo para que el menú quepa
     arriba—, así que el reguero es corto a propósito: alargarlo obligaría a
     crecer la ventana, y una ventana más alta es más superficie invisible
     atrapando clics, que es un fallo que ya se pagó una vez. */
  .chorrea {
    position: absolute; top: 100%; left: 58%; width: 3px; height: 0;
    background: var(--m); border-radius: 0 0 3px 3px;
    pointer-events: none; opacity: 0;
    animation-name: chorrear; animation-duration: 2.4s;
    animation-timing-function: ease-in; animation-iteration-count: 1;
    animation-fill-mode: forwards;
  }
  /* El segundo, más fino y con retraso: un solo hilo se lee como una raya, dos
     desiguales se leen como algo cayendo. */
  .chorrea.dos { left: 63%; width: 2px; animation-delay: .35s; }
  @keyframes chorrear {
    0% { height: 0; opacity: 0; }
    10% { opacity: 1; }
    55% { height: 8px; opacity: 1; }
    100% { height: 8px; opacity: 0; }
  }
  .agarrando { cursor: grabbing; }
  /* Relevo entre caritas: la pantalla da un golpe de luz, como un LCD al
     refrescar. Sin él, una carita se convertía en otra de un fotograma a otro
     y parecía un fallo en vez de una transición. */
  .relevo .screen { filter: brightness(1.35) contrast(.9); }
  /* El aro de "estoy suelta": hormiguitas que dan la vuelta al marco, más un
     respiro de luz. Sale **mientras la arrastras**, no antes: es la única señal
     de que la ventana va pegada al cursor. Antes era un outline punteado que sólo parpadeaba, y un
     parpadeo se lee como un error; el punteado que camina se lee como algo vivo
     y esperando. Va en un pseudoelemento porque outline no sabe animar el
     recorrido de sus guiones: aquí cada lado es un degradado repetido al que se
     le mueve la posición, que es el truco de las "marching ants" de toda la
     vida. Los cuatro lados corren en el mismo sentido —derecha arriba,
     izquierda abajo, abajo a la izquierda, arriba a la derecha— para que el
     conjunto gire y no se note que son cuatro trozos. */
  .suelta { position: relative; }
  .suelta::before {
    content: ""; position: absolute; inset: -6px; border-radius: 16px;
    pointer-events: none;
    background-image:
      repeating-linear-gradient(90deg, var(--a) 0 7px, transparent 7px 14px),
      repeating-linear-gradient(90deg, var(--a) 0 7px, transparent 7px 14px),
      repeating-linear-gradient(0deg, var(--a) 0 7px, transparent 7px 14px),
      repeating-linear-gradient(0deg, var(--a) 0 7px, transparent 7px 14px);
    background-size: 100% 2px, 100% 2px, 2px 100%, 2px 100%;
    background-position: 0 0, 0 100%, 0 0, 100% 0;
    background-repeat: no-repeat;
    animation: hormigas 1.1s linear infinite, respira 2.2s ease-in-out infinite;
  }
  @keyframes hormigas {
    to { background-position: 14px 0, -14px 100%, 0 -14px, 100% 14px; }
  }
  /* El respiro: se enciende y se apaga poquito a poco, sin llegar a apagarse.
     Bajar de .55 lo volvía otra vez un parpadeo. */
  @keyframes respira { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
`;

// ─── el menú de la propia onda ──────────────────────────────────────────────
// Todo lo que se hace con la cápsula se hace **sobre la cápsula**, no en
// Ajustes: es donde está la mano. Son **dos botones y ya** —clavarla y
// devolverla a su sitio—, a la vista en cuanto le pasas el ratón.
//
// Hubo un tercero, "cambiarla de sitio", y un "+" que desplegaba los tres en
// abanico. Los dos se fueron el 17/09/2026 y por el mismo motivo: la onda se
// arrastra **siempre**, así que el modo de colocación no decidía nada y el
// abanico escondía dos botones detrás de un clic de más. Lo que hace viable el
// arrastre libre es el umbral de seis píxeles del backend (UMBRAL_ARRASTRE en
// overlay.rs): por debajo de eso un clic sigue siendo un clic y no mueve la
// ventana.
//
// `stopPropagation` en el `pointerdown` de cada botón es obligatorio: sin él,
// pulsarlos dispararía también el arrastre de la ventana y la onda saldría
// persiguiendo al cursor en vez de obedecer.

const ICONO = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  className: "h-[15px] w-[15px]",
} as const;

/** Cuánto se separa el botón de la izquierda del de la derecha. */
const PASO_ABANICO = 31;

const MENU_CSS = `
  /* Al pasar el ratón el botón crece y se enciende: el aviso de que se puede
     pulsar, antes de pulsarlo. */
  .bo { transition: transform .14s ease-out, background-color .14s, box-shadow .14s, opacity .18s; }
  .bo:hover { transform: scale(1.18); box-shadow: 0 0 0 3px var(--halo), 0 6px 14px -4px rgba(10,25,60,.5); }
  .bo:active { transform: scale(1.04); }
`;

function BotonOnda(props: {
  titulo: string;
  onClick: () => void;
  tono?: "normal" | "ok" | "activo";
  clase?: string;
  estilo?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const tono = props.tono ?? "normal";
  const cls =
    tono === "ok"
      ? "bg-emerald-500 text-white hover:bg-emerald-600"
      : tono === "activo"
        ? "bg-blue-600 text-white hover:bg-blue-700"
        : "border border-slate-300/80 bg-white/95 text-slate-600 hover:bg-white";
  const halo =
    tono === "ok"
      ? "rgba(16,185,129,.35)"
      : tono === "activo"
        ? "rgba(37,99,235,.35)"
        : "rgba(148,163,184,.4)";
  return (
    <button
      title={props.titulo}
      aria-label={props.titulo}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={props.onClick}
      style={{ ["--halo" as string]: halo, ...props.estilo }}
      className={`bo absolute right-0 top-0 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full shadow-md ${cls} ${props.clase ?? ""}`}
    >
      {props.children}
    </button>
  );
}

const IconoReset = () => (
  <svg {...ICONO}>
    <path d="M3 12a9 9 0 1 0 2.64-6.36" />
    <path d="M3 4v5h5" />
  </svg>
);
const IconoPin = () => (
  <svg {...ICONO}>
    <path d="M9 4h6l-1 6 3 3H7l3-3-1-6Z" />
    <path d="M12 13v7" />
  </svg>
);

/**
 * El menú de la propia onda, arriba a la derecha y **asomando** un poco por
 * fuera de la cápsula: dentro tapaba la leyenda de lo que estaba haciendo
 * («Anotando…», «Escribiendo…»), que es justo lo que hay que poder leer.
 *
 * Dos botones, los dos siempre a la vista mientras el ratón esté encima:
 * clavarla y devolverla a su sitio de siempre. El de la izquierda se separa
 * un paso; no hay abanico que desplegar porque con dos no hay nada que
 * esconder.
 */
export function MenuOnda(props: {
  pin: boolean;
  onPin: () => void;
  onReset: () => void;
}) {
  // Asomando por la esquina, pero con cuentas. La ventana de 104 deja 22 px de
  // aire por arriba y 12 por los lados —el aire no se reparte a medias: la
  // cápsula va pegada abajo justo para que el menú tenga sitio—, y al pasar el
  // ratón el botón crece un 18 % (2,4 px por lado) y saca un halo de 3.
  // Sobresalir 8 arriba y 4 a la derecha deja margen de sobra: medido, el borde
  // de arriba del halo se queda a 8,7 px del techo de la ventana.
  return (
    <div className="absolute -right-1 -top-2 z-10 h-[26px] w-[26px]">
      <style>{MENU_CSS}</style>
      <BotonOnda
        titulo="Devolverla a su sitio de siempre"
        onClick={props.onReset}
        estilo={{ transform: `translateX(-${PASO_ABANICO}px)` }}
      >
        <IconoReset />
      </BotonOnda>
      <BotonOnda
        titulo={props.pin ? "Desclavarla" : "Clavarla en pantalla"}
        tono={props.pin ? "activo" : "normal"}
        onClick={props.onPin}
      >
        <IconoPin />
      </BotonOnda>
    </div>
  );
}

/**
 * El toggle de redacción, **dentro** de la cápsula y pegada a su borde de abajo.
 *
 * Existe porque el nivel de redacción se decide justo antes de hablar, no una
 * semana antes en un ajuste. Teniéndolo aquí, el gesto es: miras la onda, ves
 * en qué modo está, y si no es el que quieres lo cambias de un clic.
 *
 * En reposo no es un menú: es **una rayita encendida** en la casilla del modo
 * puesto —izquierda o derecha, con el color de ese modo—, que se lee de un
 * vistazo sin robarle sitio a la carita. Al pasar el ratón por cualquier parte de la cápsula se
 * despliega con los nombres. Toda la presentación es CSS (`.niveles` en
 * faces.ts): el hover no pasa por React, así que no repinta nada ni reinicia
 * las animaciones de las caritas.
 *
 * La curvatura de los extremos no se dibuja aquí — la recorta `.screen`, que
 * es una pastilla con `overflow: hidden`.
 */
const NIVELES_HUD: {
  id: PolishKind;
  corto: string;
  largo: string;
  /** Color de su rayita. En reposo es lo ÚNICO que se ve, así que cada modo
   *  lleva el suyo: si no, izquierda y derecha se distinguirían sólo por la
   *  posición y habría que acordarse de cuál es cuál. */
  color: string;
}[] = [
  {
    id: "groq_llm",
    corto: "Estándar",
    largo: "Estándar — mismas palabras, mejor forma",
    color: "var(--a)",
  },
  {
    id: "groq_estructurado",
    corto: "Editor",
    largo: "Editor — te redacta la idea en párrafos",
    color: "var(--p)",
  },
];

function CintaNiveles(props: { nivel: PolishKind; hasKey: boolean; quieta: boolean }) {
  return (
    <div
      className={`niveles ${props.quieta ? "quieta" : ""}`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {NIVELES_HUD.map((n) => {
        const bloqueado = !props.hasKey || props.quieta;
        return (
          <button
            key={n.id}
            type="button"
            className="niv"
            style={{ "--c": n.color } as React.CSSProperties}
            data-on={props.nivel === n.id ? "" : undefined}
            title={
              props.quieta
                ? "El modo se elige antes de dictar"
                : props.hasKey
                  ? n.largo
                  : `${n.largo} (necesita la key de Groq)`
            }
            disabled={bloqueado}
            onClick={() => invoke("hud_nivel", { nivel: n.id }).catch(() => {})}
          >
            <span className="niv-luz" />
            <span className="niv-txt">{n.corto}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Las dos capas del estreno de versión: la barra que se llena y el destello
 *  blanco con el número. Idénticas en los dos estilos, porque no dependen de qué
 *  haya dibujado dentro de la cápsula — ahí está el 80 % del guion. */
function CapasEstreno({ version }: { version: string }) {
  return (
    <>
      <span className="u-barra" />
      <span className="u-blanco">v{version}</span>
    </>
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

/// Heurística ligera para la reacción por idioma del estado "listo".
function detectLang(text: string): "es" | "en" | null {
  const t = ` ${text.toLowerCase()} `;
  if (/[áéíóúñ¿¡]/.test(t)) return "es";
  const es = (
    t.match(
      / (el|la|los|las|que|de|en|un|una|para|con|por|esta|pero|como) /g,
    ) || []
  ).length;
  const en = (
    t.match(/ (the|and|is|are|to|of|in|that|it|for|with|this|was) /g) || []
  ).length;
  if (es >= 2 && es > en) return "es";
  if (en >= 2 && en > es) return "en";
  return null;
}

function pick(state: FaceState, text?: string, comio = false): number {
  if (state === "listo") {
    // Si mientras hablabas se comió tu voz, la respuesta obligada es el eructo.
    if (comio) return CARITA_ERUCTO;
    const lang = detectLang(text ?? "");
    const pool =
      lang === "es" ? [0, 1, 2, 3] : lang === "en" ? [0, 1, 2, 4] : [0, 1, 2];
    return pool[Math.floor(Math.random() * pool.length)];
  }
  return Math.floor(Math.random() * V[state].length);
}

const stateFor = (rec: RecordingState): FaceState => {
  switch (rec.state) {
    case "recording":
      return "escuchando";
    case "processing":
      return "pensando";
    case "done":
      return "listo";
    case "empty":
      return "no-entendi";
    default:
      return "reposo";
  }
};

export default function Hud() {
  const [rec, setRec] = useState<RecordingState>({ state: "idle" });
  const [variant, setVariant] = useState(0);
  const [hudStyle, setHudStyle] = useState<HudStyle>("tamagotchi");
  /** La estás arrastrando de verdad (cruzado el umbral): va en la vagoneta. */
  const [rodando, setRodando] = useState(false);
  /** 0 = entera; 1…3 los escalones del zarandeo y 4 la limpiada del final. */
  const [mareo, setMareo] = useState(0);
  /** La pantalla se está fundiendo para cambiar de carita sin corte. */
  const [fundiendo, setFundiendo] = useState(false);
  /** Bajándose del carrito: la barandilla se levanta y se va. */
  const [bajando, setBajando] = useState(false);
  /** Recién bajada: mira a los lados antes de volver al reposo. */
  const [curioseando, setCurioseando] = useState(false);
  /** Clavada en pantalla: no se esconde al acabar el dictado. */
  const [pin, setPin] = useState(false);
  const [opacidadReposo, setOpacidadReposo] = useState(0.45);
  /** El nivel de redacción y si se puede usar: los pinta la cinta de abajo. */
  const [nivel, setNivel] = useState<PolishKind>("rules");
  const [verNiveles, setVerNiveles] = useState(true);
  const [hasKey, setHasKey] = useState(false);
  /** El ratón está encima: saca los controles y le quita el velo. */
  const [encima, setEncima] = useState(false);
  /** Destello de relevo entre una carita del mareo y la siguiente. */
  const [relevo, setRelevo] = useState(false);
  /** Cuál de las dos limpiadas tocó esta vez, con lo que dura. Se sortea al
   *  entrar y se guarda en una ref, que si no cada repintado sacaría otra y las
   *  dos se atropellarían a mitad de la animación. */
  const limpiada = useRef(LIMPIADAS[0]);
  const mareoDesde = useRef(0);
  /** El listener del arrastre se registra una vez y se quedaría con el `mareo`
   *  de aquel render; la ref le da siempre el de ahora. */
  const mareoRef = useRef(0);
  const [agarrando, setAgarrando] = useState(false);
  const [dark, setDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const tamaRef = useRef<HTMLDivElement | null>(null);
  const levelsRef = useRef<number[]>(Array(HISTORY).fill(0));
  const displayRef = useRef<number[]>(Array(5).fill(BAR_MIN));
  const recRef = useRef(rec);
  recRef.current = rec;
  // ¿La carita de "te escucho" que tocó esta vez fue la comilona? Decide si al
  // terminar toca el eructo.
  const comioRef = useRef(false);
  // Cuánto llevas del tope del dictado (0-1) y cuál es ese tope; lo manda el
  // backend al empezar a grabar.
  const [cap, setCap] = useState(0);
  const topeRef = useRef(600);

  // El HUD está dibujado para un lienzo de 96 px de alto. Al saltar a un
  // monitor con otro DPI, WebView2 a veces conserva su escala y nos deja un
  // lienzo más grande: se escala todo en bloque para llenarlo igual.
  useEffect(() => {
    const ajustar = () => {
      // 104 es el alto lógico de la ventana (ver HUD_H en pipeline.rs). Los dos
      // números tienen que ir a la par: éste traduce el lienzo real a escala.
      document.documentElement.style.setProperty(
        "--k",
        (window.innerHeight / 104).toFixed(3),
      );
      // Si el lienzo se desbordara, Windows le metería barras de scroll que
      // roban 15 px y ya no se van. No debería volver a pasar (overflow
      // hidden, arriba), pero si pasa que quede en el log y no en la cara del
      // usuario: fue así como se encontró.
      const d = document.documentElement;
      const desborde =
        d.scrollWidth !== d.clientWidth || d.scrollHeight !== d.clientHeight
          ? ` DESBORDE scroll=${d.scrollWidth}x${d.scrollHeight} client=${d.clientWidth}x${d.clientHeight}`
          : "";
      hudLog(
        `lienzo ${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio}${desborde}`,
      );
    };
    ajustar();
    window.addEventListener("resize", ajustar);
    return () => window.removeEventListener("resize", ajustar);
  }, []);

  useEffect(() => {
    if (rec.state !== "recording") {
      setCap(0);
      return;
    }
    const t0 = Date.now();
    const id = setInterval(() => {
      const frac = Math.min(1, (Date.now() - t0) / 1000 / topeRef.current);
      setCap((prev) => (Math.abs(prev - frac) > 0.004 ? frac : prev));
    }, 1000);
    return () => clearInterval(id);
  }, [rec.state]);

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
      if (e.payload.state === "recording") {
        levelsRef.current = Array(HISTORY).fill(0);
        if (e.payload.max_seconds) topeRef.current = e.payload.max_seconds;
      }
      const face = stateFor(e.payload);
      const idx = pick(
        face,
        e.payload.state === "done" ? e.payload.text : undefined,
        comioRef.current,
      );
      // Se apunta en cada grabación, así que nunca queda un eructo colgado de
      // un dictado anterior.
      if (face === "escuchando") comioRef.current = idx === CARITA_COMILONA;
      setVariant(idx);
      hudLog(`evento ${e.payload.state} → carita ${face}[${idx}]`);
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

  // El backend avisa cuando el arrastre arranca de verdad —no al apretar, sino
  // al cruzar el umbral— y cuando se suelta. Es lo que enciende el aro punteado
  // y la carita de la vagoneta.
  useEffect(() => {
    const un = listen<boolean>("hud-arrastre", (e) => {
      if (e.payload) {
        arrastro.current = true;
        // Agarrada otra vez: vuelve a la vagoneta, se estuviera bajando o
        // mirando alrededor. Sin esto su temporizador seguía corriendo y
        // fundía la pantalla con la onda en la mano.
        setBajando(false);
        setCurioseando(false);
      }
      setRodando(e.payload);
      // Soltaste sin haberte mareado: toca bajarse. Si hubo mareo, la bajada
      // espera a que termine esa historia — se encadena desde el fundido.
      if (!e.payload) setBajando((b) => b || mareoRef.current === 0);
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    invoke<boolean>("has_groq_key").then(setHasKey).catch(() => {});
  }, []);

  // Zarandéala mientras la arrastras y se marea. Cada meneo sube un escalón:
  // mareada → aguantándose → ya no aguantó. El backend sólo avisa de que hubo
  // meneo; la escalada es cosa de aquí, que es presentación pura.
  //
  // Arrastrándola con suavidad no se llega a ninguno: se queda en la vagoneta
  // pasándoselo bien, que es el escalón cero.
  //
  // **Cada escalón tiene que dar su vuelta antes de ceder el sitio.** Zarandeando
  // sin parar los meneos llegaban en ráfaga y las caritas se atropellaban: no se
  // veía ninguna entera. Los tamagotchi resuelven esto igual —dos fotogramas
  // repetidos tres o cuatro veces antes de cambiar de estado—, así que aquí hay
  // un plantón mínimo del tamaño de un bucle completo. Agitando cinco segundos
  // se recorren las tres con tiempo de mirarlas.
  useEffect(() => {
    const un = listen("hud-meneo", () => {
      const ahora = Date.now();
      if (ahora - mareoDesde.current < PLANTON_MAREO) return;
      mareoDesde.current = ahora;
      // Tope en el vómito: al cuarto —la limpiada— no se llega meneando, se
      // llega cuando el vómito termina. Y la limpiada no se interrumpe: antes
      // un meneo a media limpiada la devolvía al vómito, y la de la servilleta,
      // que necesita su tiempo para leerse, no llegaba a verse nunca.
      setMareo((m) => (m === LIMPIANDO ? m : Math.min(VOMITO, m + 1)));
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  // El destello de la pantalla al cambiar de escalón: es el relevo entre una
  // carita y la siguiente, para que no parezca un corte.
  useEffect(() => {
    if (mareo === 0) return;
    setRelevo(true);
    const t = setTimeout(() => setRelevo(false), 200);
    return () => clearTimeout(t);
  }, [mareo]);

  // Se le pasa solo. Los dos primeros escalones aguantan un rato por si sigues
  // zarandeando; el vómito encadena con la limpiada de la servilleta, y de ahí se
  // sale **fundiendo**, nunca de un fotograma al siguiente.
  useEffect(() => {
    if (mareo === 0) return;
    if (mareo === LIMPIANDO) {
      // Entera y una sola vez (ver la clase una-vez en FACE_CSS), y un rato
      // quieta en la cara limpia antes de fundir.
      const t = setTimeout(
        () => setFundiendo(true),
        limpiada.current.ms + REMATE_LIMPIA,
      );
      return () => clearTimeout(t);
    }
    const t = setTimeout(
      () => {
        if (mareo !== VOMITO) {
          setFundiendo(true);
          return;
        }
        // El sorteo: las dos versiones se quedaron y sale una u otra.
        limpiada.current =
          LIMPIADAS[Math.floor(Math.random() * LIMPIADAS.length)];
        hudLog(`limpiada: ${limpiada.current.nombre}`);
        setMareo(LIMPIANDO);
      },
      mareo === VOMITO ? 2600 : 4200,
    );
    return () => clearTimeout(t);
  }, [mareo]);

  // Bajarse del carrito dura lo que dura su flipbook, y sin corte pasa a mirar
  // a los lados: las dos escenas llevan la cara y la vagoneta en el mismo sitio,
  // así que lo único que cambia es que los ojos empiezan a moverse.
  useEffect(() => {
    if (!bajando) return;
    const t = setTimeout(() => {
      setBajando(false);
      setCurioseando(true);
    }, BAJARSE_MS);
    return () => clearTimeout(t);
  }, [bajando]);

  // Después de curiosear, funde a reposo. Si mientras tanto empiezas a dictar
  // (o salta el escribano), manda eso: se deja de curiosear en el acto, y el
  // fundido no llega a caer en mitad del dictado.
  useEffect(() => {
    if (!curioseando) return;
    if (rec.state !== "idle") {
      setCurioseando(false);
      return;
    }
    const t = setTimeout(() => setFundiendo(true), CURIOSEAR_MS);
    return () => clearTimeout(t);
  }, [curioseando, rec.state]);

  // El fundido: la pantalla baja a cero, se cambia la carita por debajo y vuelve
  // a subir. Los 200 ms son los mismos que declara la transición de la escena.
  //
  // Al salir del mareo **se encadena la bajada**: el bicho acaba de vomitar
  // encima de un carrito, así que todavía tiene que bajarse de él. Si el fundido
  // viene de curiosear, ya se bajó: vuelve a reposo de verdad.
  useEffect(() => {
    if (!fundiendo) return;
    const t = setTimeout(() => {
      // Si sigues arrastrando no te has bajado de nada: vuelve a la vagoneta.
      setBajando(mareo > 0 && !rodando);
      setCurioseando(false);
      setMareo(0);
      setFundiendo(false);
    }, 200);
    return () => clearTimeout(t);
  }, [fundiendo, mareo, rodando]);

  // La ref del mareo, al día en cada render.
  useEffect(() => {
    mareoRef.current = mareo;
  }, [mareo]);

  // Estilo del HUD desde Ajustes; se refresca al vuelo al guardar cambios.
  useEffect(() => {
    const load = () =>
      invoke<AppSettings>("get_settings")
        .then((s) => {
          setHudStyle(s.hud_style);
          setPin(s.hud_pin);
          setOpacidadReposo(s.hud_opacidad_reposo ?? 0.45);
          setNivel(s.polish);
          setVerNiveles(s.hud_niveles ?? true);
        })
        .catch(console.error);
    load();
    const un = listen("settings-changed", load);
    return () => {
      un.then((f) => f());
    };
  }, []);

  // Modo clásico: barras tipo ecualizador movidas por la intensidad de la voz
  // (grabando) o en onda secuencial (procesando). DOM + height, sin canvas.
  useEffect(() => {
    if (hudStyle !== "classic") return;
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
            BAR_MIN +
            (BAR_MAX - BAR_MIN) * Math.min(1, v * BAR_GAIN[i] * wobble);
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
  }, [rec.state, hudStyle]);

  // Tamagotchi: --lvl lleva el volumen real de tu voz a la carita (barras y
  // boca). Se escribe directo en el DOM para no re-renderizar 30 veces por s.
  useEffect(() => {
    if (hudStyle !== "tamagotchi" || rec.state !== "recording") return;
    let raf = 0;
    let suave = 0;
    const tick = () => {
      const levels = levelsRef.current;
      const v = levels[levels.length - 1] ?? 0;
      suave += (v - suave) * 0.4;
      tamaRef.current?.style.setProperty("--lvl", suave.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rec.state, hudStyle]);

  // Agarrar el HUD: el backend se queda siguiendo el cursor hasta que sueltes,
  // así que desde aquí sólo hay que dar el pistoletazo de salida.
  // La onda se agarra **siempre**, sin modos ni permisos. Lo que antes lo
  // impedía —que ir a pulsar su propio menú la desplazara sin querer— lo
  // resuelve el umbral de seis píxeles del backend (UMBRAL_ARRASTRE): por
  // debajo de eso el clic llega limpio y la ventana no se mueve. Hasta cruzarlo
  // no hay ni aro punteado ni vagoneta.
  // ¿Llegó a arrastrarse? Lo dice el backend al cruzar el umbral. Sin esto no
  // se puede distinguir un clic de un arrastre: la onda es a la vez el botón
  // del escribano y su propia asa.
  const arrastro = useRef(false);
  const agarrar = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    arrastro.current = false;
    e.preventDefault();
    setAgarrando(true);
    invoke("hud_arrastrar").catch(() => {});
  };
  useEffect(() => {
    if (!agarrando) return;
    const soltar = () => {
      setAgarrando(false);
      // Soltaste sin haberla movido: eso es un clic. Y sólo hace algo si el
      // escribano está armado — el backend lo vuelve a comprobar, porque en la
      // cápsula se hacen muchos clics que no son éste.
      if (!arrastro.current && recRef.current.state === "escribano") {
        invoke("hud_corregir").catch(() => {});
      }
    };
    window.addEventListener("pointerup", soltar);
    window.addEventListener("pointercancel", soltar);
    // Red de seguridad: si la ventana se mueve fuera del cursor y el
    // "pointerup" nunca llega, el HUD no se queda con la manita cerrada.
    const t = setTimeout(soltar, 60_000);
    return () => {
      window.removeEventListener("pointerup", soltar);
      window.removeEventListener("pointercancel", soltar);
      clearTimeout(t);
    };
  }, [agarrando]);
  const gesto = `agarrable ${agarrando ? "agarrando" : ""} select-none`;

  const pal = dark ? DARK : LIGHT;
  const vars = useMemo(() => cssVars(dark) as React.CSSProperties, [dark]);

  const face = stateFor(rec);
  // ── acciones del menú de la onda ──────────────────────────────────────────
  const alternarPin = () => {
    const nuevo = !pin;
    setPin(nuevo); // optimista: el backend confirma con `settings-changed`
    invoke("hud_pin", { on: nuevo }).catch(() => setPin(!nuevo));
  };
  const resetearPos = () => invoke("hud_pos_reset").catch(() => {});

  // Clavada y sin nada que decir, la onda se pone a medio velo para no competir
  // con lo que estés leyendo. Al pasarle el ratón por encima vuelve entera, y
  // mientras dictas nunca se vela: es justo cuando hay que verla.
  const velo =
    pin &&
    rec.state === "idle" &&
    !encima &&
    !rodando &&
    !bajando &&
    !curioseando &&
    mareo === 0
      ? opacidadReposo
      : 1;

  const isError = rec.state === "error";
  // Zarandeada gana a todo: es el único momento en que la carita no cuenta en
  // qué va el dictado, y para entonces no hay dictado ninguno.
  const mareada =
    mareo === LIMPIANDO ? limpiada.current.v : mareo > 0 ? MAREO[mareo - 1] : null;
  // Las escenas que cuentan un final se ven una sola vez y se quedan en su
  // último cuadro hasta que llega lo siguiente: el vómito hasta la limpiada, y
  // la limpiada, la bajada y el curioseo mientras funden.
  const unaVez =
    mareo === VOMITO ||
    mareo === LIMPIANDO ||
    ((bajando || curioseando) && !mareada);
  const cancelada = rec.state === "cancelado" ? CARITA_CANCELADO : null;
  // Arrastrándola: va en la vagoneta. Pierde contra el mareo, que es lo que
  // pasa si además la zarandeas. El curioseo, sólo en reposo: si empiezas a
  // dictar recién soltada, manda el dictado.
  const encarrito = bajando
    ? BAJANDO
    : rodando
      ? RODANDO
      : curioseando && rec.state === "idle"
        ? CURIOSEANDO
        : null;
  // Modo escribano: acabas de copiar algo y la onda se ofrece a corregirlo.
  // Es la misma carita que mientras corrige —pluma y pergamino— y eso es
  // deliberado: el usuario ve «modo escribano» y lo que cambia es la leyenda,
  // no el personaje.
  const armado = rec.state === "escribano";
  // Modo lectura: no hay micrófono que enseñar porque no se está escuchando.
  const leyendo = rec.state === "corrigiendo" || armado;
  const corrigiendo = leyendo ? LEYENDO : null;
  // El estreno ya no es una pantalla aparte: es una carita más que entra por
  // el camino de siempre, con dos capas encima de la cápsula. Ver `ACTUALIZADO`
  // en faces.ts.
  const estrenando = rec.state === "actualizado";
  const version = rec.state === "actualizado" ? rec.version : "";
  const estrenada = rec.state === "actualizado" ? ACTUALIZADO : null;
  // En error se reutiliza la carita de "señal perdida" con el mensaje real.
  const sorteada = isError ? V["no-entendi"][3] : (V[face][variant] ?? V[face][0]);
  // Las historias largas de stand-by traen `fresco`: una tirada nueva cada vez
  // que salen, para que dos reposos seguidos no cuenten lo mismo.
  //
  // Va en un `useMemo` y no suelto, y eso NO es una optimización: la escena
  // entra por `dangerouslySetInnerHTML`, así que si cambiara en cada render
  // React reescribiría el interior del `<svg>` sesenta veces por segundo y la
  // historia volvería a empezar en cada fotograma. Se vuelve a tirar sólo
  // cuando de verdad cambia la carita.
  const fresca = useMemo(
    () => (sorteada.fresco ? { ...sorteada, scene: sorteada.fresco() } : sorteada),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [face, variant, isError],
  );
  // Los ojos que siguen al cursor. Se pregunta a Rust cada 70 ms y SOLO
  // mientras esa carita esta a la vista: desde el webview no se puede saber
  // donde esta el raton -el HUD solo recibe eventos cuando esta encima de el- y
  // preguntarlo todo el rato para las otras cuatro caritas seria pagar por nada.
  // Con la onda escondida Rust contesta null y se pregunta mucho mas despacio.
  //
  // El valor se escribe directo en el DOM, como `--lvl`: pasarlo por el estado
  // de React repintaria la escena quince veces por segundo y se llevaria por
  // delante las animaciones, que es el gotcha de siempre. Y se escribe solo
  // cuando la pupila cambia de casilla, que es pocas veces.
  //
  // **Se marea solo si le das vueltas.** Antes bastaban tres saltos rapidos
  // seguidos del cursor, y eso lo hace cualquiera que trabaje deprisa con un
  // raton sensible o en una 4K: los ojos se ponian en aspa sin que nadie la
  // hubiera tocado. Dar vueltas alrededor de la onda no depende de lo rapido
  // que vaya el puntero y no pasa sin querer: ir y venir se anula solo, y un
  // viaje de una ventana a otra no rodea nada.
  const [mareoCursor, setMareoCursor] = useState(false);
  // "A la vista" de verdad: que la carita de reposo sorteada sea la de los ojos
  // no basta. En clásico no se dibuja, y el escribano, el cancelado, el estreno
  // y la vagoneta la tapan (todos pasan por stateFor → "reposo" y sortean una
  // debajo). Mirando sólo `fresca.sigue`, cualquiera de ellos con los ojos
  // sorteados preguntaba a Rust quince veces por segundo para nada.
  const ojosAVista =
    hudStyle === "tamagotchi" &&
    !!fresca.sigue &&
    !mareada &&
    !encarrito &&
    !cancelada &&
    !corrigiendo &&
    !estrenada;
  useEffect(() => {
    if (!ojosAVista) return;
    const caja = tamaRef.current;
    let vivo = true;
    let t = 0;
    let tMareo = 0;
    let escondida = false;
    let pupila: [number, number] = [0, 0];
    let anguloAnt: number | null = null;
    let giros: { t: number; d: number }[] = [];
    const tick = () => {
      invoke<[number, number] | null>("hud_cursor")
        .then((r) => {
          if (!vivo) return;
          escondida = !r;
          if (!r) {
            anguloAnt = null;
            giros = [];
            return;
          }
          const [x, y] = r;
          const nueva: [number, number] = [
            casillaPupila(x, pupila[0]),
            casillaPupila(y, pupila[1]),
          ];
          if (nueva[0] !== pupila[0] || nueva[1] !== pupila[1]) {
            pupila = nueva;
            caja?.style.setProperty("--mx", String(nueva[0]));
            caja?.style.setProperty("--my", String(nueva[1]));
          }
          // Las vueltas: cuanto ha girado el cursor alrededor del centro de la
          // onda. Ni pegado al centro, donde el angulo baila con un pixel, ni en
          // la otra punta del escritorio.
          const ahora = performance.now();
          const lejos = Math.hypot(x, y);
          if (lejos > 0.12 && lejos < 3) {
            const angulo = Math.atan2(y, x);
            if (anguloAnt !== null) {
              let d = angulo - anguloAnt;
              if (d > Math.PI) d -= 2 * Math.PI;
              else if (d < -Math.PI) d += 2 * Math.PI;
              // Un salto de más de un cuarto de vuelta en 70 ms no es girar, es
              // el cursor apareciendo en otro sitio. Sin este tope, saltos al
              // azar sumaban vueltas por pura estadística: medido, 7 mareos por
              // hora saltando cada 70 ms por una 4K; con él, cero. Dando vueltas
              // de verdad —hasta tres por segundo— nunca se llega al tope.
              if (Math.abs(d) < 1.6) giros.push({ t: ahora, d });
            }
            anguloAnt = angulo;
          } else {
            anguloAnt = null;
          }
          giros = giros.filter((g) => ahora - g.t < VENTANA_VUELTAS);
          const girado = giros.reduce((a, g) => a + g.d, 0);
          if (Math.abs(girado) >= VUELTAS_MAREO * 2 * Math.PI) {
            giros = [];
            setMareoCursor(true);
            window.clearTimeout(tMareo);
            tMareo = window.setTimeout(() => vivo && setMareoCursor(false), 1800);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (vivo) t = window.setTimeout(tick, escondida ? 600 : 70);
        });
    };
    t = window.setTimeout(tick, 70);
    return () => {
      vivo = false;
      window.clearTimeout(t);
      // Si la carita se va a media borrachera —empiezas a dictar antes de que
      // se le pase—, el vivo && de arriba ya no la desmarea nunca, y la próxima
      // vez que salieran los ojos saldrían en aspa y así se quedaban. Se
      // desmarea al irse.
      window.clearTimeout(tMareo);
      setMareoCursor(false);
      caja?.style.removeProperty("--mx");
      caja?.style.removeProperty("--my");
    };
  }, [fresca, ojosAVista]);

  const v =
    mareada ??
    encarrito ??
    cancelada ??
    corrigiendo ??
    estrenada ??
    (mareoCursor && fresca.sigue ? OJOS_MAREADOS : fresca);
  // React 19 compara `dangerouslySetInnerHTML` por identidad del objeto, no por
  // el texto: un `{ __html }` nuevo en cada render reescribe el <svg> entero y
  // la carita vuelve a empezar. Pasar el ratón, pulsar o la cinta de capacidad
  // repintan el HUD sin cambiar de carita; con el objeto memorizado, esos
  // renders no tocan la escena.
  const escenaHtml = useMemo(() => ({ __html: v.scene }), [v.scene]);
  const sad =
    (isError && !mareada && !cancelada && !corrigiendo && !estrenada) || v.sad;
  const porLimite = rec.state === "processing" && rec.motivo === "limite";
  const status = armado
    ? `Clic para corregir · ${rec.state === "escribano" ? rec.palabras : 0} palabras`
    : mareada
    ? mareada.status
    : cancelada
    ? cancelada.status
    : // Al estrenar, la pantallita lleva el número: en los sprites no cabe.
      rec.state === "actualizado"
      ? `v${rec.version}`
      : isError
      ? rec.message
      : rec.state === "done"
        ? rec.text
        : porLimite
          ? `Tope de ${Math.round(topeRef.current / 60)} min: transcribiendo`
          : v.status;
  const cinta =
    rec.state === "recording" && cap > 0.5 ? (
      <span
        className={`cinta ${cap > 0.85 ? "alto" : ""}`}
        style={{ "--cap": cap.toFixed(3) } as React.CSSProperties}
      />
    ) : null;

  // ── modo clásico: pill claro + barras reactivas a la voz ──────────────────
  if (hudStyle === "classic") {
    // El cancelado comparte con "no te escuché" el tono naranja y el meneo —los
    // dos son "esto no salió"— pero cada uno dice lo suyo, así que el contenido
    // se decide aparte.
    const naranja = rec.state === "empty" || rec.state === "cancelado";
    const emptyC = rec.state === "empty";
    const pill = naranja
      ? dark
        ? "border-orange-400/30 bg-slate-900/90 text-orange-200"
        : "border-orange-200 bg-orange-50/95 text-orange-900"
      : dark
        ? "border-white/10 bg-slate-900/90 text-slate-200"
        : "border-slate-200/80 bg-white/95 text-slate-700";
    return (
      <div
        className={`flex h-screen w-screen items-end justify-center pb-2 ${gesto}`}
        style={{ ...vars, opacity: velo, transition: "opacity .18s" }}
        onPointerDown={agarrar}
        onPointerEnter={() => {
          setEncima(true);
          invoke("hud_encima", { on: true }).catch(() => {});
        }}
        onPointerLeave={() => {
          setEncima(false);
          invoke("hud_encima", { on: false }).catch(() => {});
        }}
      >
        {/* FACE_CSS también aquí: la cinta de niveles (.niveles, .niv…) y las
            capas del estreno (.u-barra, .u-blanco, .u-entra, .u-px) viven ahí
            desde que la cinta entró en la cápsula, con sus reglas .clasico
            incluidas. Sin él, el clásico las pinta como texto suelto. */}
        <style>{FACE_CSS + CLASSIC_CSS + DRAG_CSS}</style>
        <div
          className={`relative ${rodando ? "suelta" : ""}`}
          style={{ transform: "scale(var(--k, 1))" }}
        >
          {encima && (
          <MenuOnda pin={pin} onPin={alternarPin} onReset={resetearPos} />
        )}
          <div
            className={`clasico relative flex h-[74px] w-[336px] items-center gap-3 overflow-hidden rounded-full border px-5 pb-2 shadow-2xl shadow-blue-900/20 backdrop-blur transition-colors ${
              naranja ? "classic-shake" : ""
            } ${pill} ${estrenando ? "isolate" : ""}`}
          >
            {/* El estreno, en el estilo clásico: las mismas dos capas, y al
                final se revelan las cinco barritas en vez de la cara. Mismo
                frente de onda —1,44 a 1,68 s— y mismo keyframe. */}
            {estrenando && (
              <>
                <CapasEstreno version={version} />
                <span className="u-entra flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white dark:bg-sky-500">
                  <MicIcon className="h-4 w-4" />
                </span>
                <div className="flex h-8 flex-1 items-center justify-center gap-2.5">
                  {BAR_LAG.map((_, i) => (
                    <span
                      key={i}
                      className="u-px w-2 rounded-full"
                      style={{
                        height: BAR_MIN,
                        backgroundColor: dark ? "#38bdf8" : "#2563eb",
                        animationDelay: `${(1.44 + i * 0.06).toFixed(2)}s`,
                      }}
                    />
                  ))}
                </div>
                <span
                  className={`u-entra shrink-0 text-[11px] font-medium ${
                    dark ? "text-slate-400" : "text-slate-500"
                  }`}
                >
                  Dicho
                </span>
              </>
            )}

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

            {emptyC && (
              <>
                <div className="flex h-8 shrink-0 items-center gap-2 pl-1">
                  {BAR_LAG.map((_, i) => (
                    <span
                      key={i}
                      className="cbar-sad w-2 rounded-full"
                      style={{
                        height: BAR_MIN,
                        backgroundColor: dark ? "#fb923c" : "#ea7317",
                        animationDelay: `${i * 0.12}s`,
                      }}
                    />
                  ))}
                </div>
                <p className="min-w-0 flex-1 text-[11px] font-medium leading-tight">
                  Perdón, no escuché, ¿puedes repetir?
                </p>
              </>
            )}

            {rec.state === "cancelado" && (
              <>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white">
                  ✕
                </span>
                <p className="min-w-0 flex-1 truncate text-sm">
                  Cancelado, no escribí nada
                </p>
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
                {rodando ? "Arrástrame donde quieras" : "Dicho"}
              </p>
            )}
            {/* El toggle se esconde mientras la onda va montada: ocupa el
                borde de abajo de la cápsula, que es justo por donde asoma la
                vagoneta y por donde se escurre el vómito. Y mientras arrastras
                no vas a cambiar de modo. */}
            {verNiveles && !rodando && !bajando && mareo === 0 && (
              <span className={estrenando ? "u-entra" : ""}>
                <CintaNiveles
                  nivel={nivel}
                  hasKey={hasKey}
                  quieta={rec.state === "recording" || rec.state === "processing"}
                />
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex h-screen w-screen items-end justify-center pb-2 ${gesto}`}
      style={{ ...vars, opacity: velo, transition: "opacity .18s" }}
      onPointerDown={agarrar}
      onPointerEnter={() => {
        setEncima(true);
        invoke("hud_encima", { on: true }).catch(() => {});
      }}
      onPointerLeave={() => {
        setEncima(false);
        invoke("hud_encima", { on: false }).catch(() => {});
      }}
    >
      <style>{FACE_CSS + DRAG_CSS}</style>
      <div
        className={`relative ${rodando ? "suelta" : ""}`}
        style={{ transform: "scale(var(--k, 1))" }}
      >
        {encima && (
          <MenuOnda pin={pin} onPin={alternarPin} onReset={resetearPos} />
        )}
        {/* El vómito se sale de la cápsula y chorrea por fuera. Va **aquí**
            y no dentro del SVG a propósito: dentro está recortado por la
            pantalla, y la gracia es justo que se salga. Son píxeles de verdad,
            no de la rejilla del LCD — por eso puede medir 3 de ancho. */}
        {mareo === VOMITO && (
          <>
            <span className="chorrea" />
            <span className="chorrea dos" />
          </>
        )}
        <div
          ref={tamaRef}
          className={`tama ${sad ? "sad" : ""} ${leyendo ? "leyendo" : ""} ${v.shake && !isError ? "shake" : ""} ${relevo ? "relevo" : ""} ${fundiendo ? "fundido" : ""} ${unaVez ? "una-vez" : ""}`}
        >
          {/* El color va inline y gana a la regla de .leyendo, así que la tinta
              tiene que ir aquí también: si no, el pergamino llevaría la carita
              pintada con el color de siempre. */}
          <div className="screen" style={{ color: sad ? pal.w : leyendo ? pal.tinta : pal.face }}>
            {estrenando && <CapasEstreno version={version} />}
            {/* Sin micrófono en modo lectura: no está escuchando nada, y
                dejarlo puesto sería decir lo contrario de lo que pasa. */}
            {!leyendo && (
              <span
                className={`mic-px ${estrenando ? "u-entra" : ""}`}
                dangerouslySetInnerHTML={MIC_HTML}
              />
            )}
            <span className="scene">
              {/* La franja visible arranca en y=2: así el píxel sale un 40 % más
                grande sin tener que recolocar todos los sprites. */}
              <svg viewBox="0 2 48 16" dangerouslySetInnerHTML={escenaHtml} />
            </span>
            <span
              className={`status ${rec.state === "done" || isError ? "texto" : ""} ${estrenando ? "u-entra" : ""}`}
            >
              {status}
            </span>
            {cinta}
            {/* El toggle se esconde mientras la onda va montada: ocupa el
                borde de abajo de la cápsula, que es justo por donde asoma la
                vagoneta y por donde se escurre el vómito. Y mientras arrastras
                no vas a cambiar de modo. */}
            {verNiveles && !rodando && !bajando && mareo === 0 && (
              <span className={estrenando ? "u-entra" : ""}>
                <CintaNiveles
                  nivel={nivel}
                  hasKey={hasKey}
                  quieta={rec.state === "recording" || rec.state === "processing"}
                />
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
