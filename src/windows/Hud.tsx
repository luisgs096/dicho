import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppSettings, HudStyle, PolishKind, RecordingState } from "../types";
import {
  CARITA_COMILONA,
  CARITA_ERUCTO,
  ACTUALIZADO,
  LEYENDO,
  CARITA_CANCELADO,
  FACE_CSS,
  LIMPIADAS,
  MAREO,
  RODANDO,
  MIC_SVG,
  V,
  type FaceState,
} from "./faces";

function hudLog(msg: string) {
  invoke("hud_log", { msg }).catch(() => {});
}

// ─── paletas del tamagotchi (mismos colores de Dicho) ───────────────────────
const LIGHT = {
  a: "#2563eb",
  m: "#17b394",
  p: "#f06ea9",
  w: "#ea7317",
  s: "#38bdf8",
  face: "#33415c",
  faint: "#8296b2",
  lcd: "#d7e1f0",
  lcdBorder: "#bfcde2",
  grid: "rgba(51,65,92,.07)",
  shellA: "#cdd7e6",
  shellB: "#aab9d0",
  warnLcd: "#f7e3cd",
  warnBorder: "#ecc9a0",
};
const DARK = {
  a: "#38bdf8",
  m: "#2dd4b4",
  p: "#f472b6",
  w: "#fb923c",
  s: "#7dd3fc",
  face: "#dbe6f6",
  faint: "#5c6f8f",
  lcd: "#0a1322",
  lcdBorder: "#223052",
  grid: "rgba(219,230,246,.05)",
  shellA: "#263450",
  shellB: "#16223a",
  warnLcd: "#2b1d0e",
  warnBorder: "#4a3520",
};

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

/** Y un escalón más, al que **no** se llega meneando: limpiarse la boca. Del
 *  cuarto tiempo se encarga el reloj, que no se le puede pedir al usuario que
 *  siga zarandeando para ver cómo se le pasa. */
const LIMPIANDO = VOMITO + 1;

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
  /** Cuál de las dos limpiadas tocó esta vez. Se sortea al entrar y se guarda en
   *  una ref, que si no cada repintado sacaría otra y las dos se atropellarían
   *  a mitad de la animación. */
  const limpiada = useRef(LIMPIADAS[0].v);
  const mareoDesde = useRef(0);
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
      if (e.payload) arrastro.current = true;
      setRodando(e.payload);
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
      // llega cuando el vómito termina.
      setMareo((m) => Math.min(VOMITO, m + 1));
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
      const t = setTimeout(() => setFundiendo(true), 900);
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
          LIMPIADAS[Math.floor(Math.random() * LIMPIADAS.length)].v;
        setMareo(LIMPIANDO);
      },
      mareo === VOMITO ? 2600 : 4200,
    );
    return () => clearTimeout(t);
  }, [mareo]);

  // El fundido: la pantalla baja a cero, se cambia la carita por debajo y vuelve
  // a subir. Los 200 ms son los mismos que declara la transición de la escena.
  useEffect(() => {
    if (!fundiendo) return;
    const t = setTimeout(() => {
      setMareo(0);
      setFundiendo(false);
    }, 200);
    return () => clearTimeout(t);
  }, [fundiendo]);

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
  const vars = useMemo(
    () =>
      ({
        "--a": pal.a,
        "--m": pal.m,
        "--p": pal.p,
        "--w": pal.w,
        "--s": pal.s,
        "--face": pal.face,
        "--faint": pal.faint,
        "--lcd": pal.lcd,
        "--lcdBorder": pal.lcdBorder,
        "--grid": pal.grid,
        "--shellA": pal.shellA,
        "--shellB": pal.shellB,
        "--warnLcd": pal.warnLcd,
        "--warnBorder": pal.warnBorder,
      }) as React.CSSProperties,
    [pal],
  );

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
    pin && rec.state === "idle" && !encima && !rodando && mareo === 0
      ? opacidadReposo
      : 1;

  const isError = rec.state === "error";
  // Zarandeada gana a todo: es el único momento en que la carita no cuenta en
  // qué va el dictado, y para entonces no hay dictado ninguno.
  const mareada =
    mareo === LIMPIANDO ? limpiada.current : mareo > 0 ? MAREO[mareo - 1] : null;
  const cancelada = rec.state === "cancelado" ? CARITA_CANCELADO : null;
  // Arrastrándola: va en la vagoneta. Pierde contra el mareo, que es lo que
  // pasa si además la zarandeas.
  const encarrito = rodando ? RODANDO : null;
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
  const v =
    mareada ??
    encarrito ??
    cancelada ??
    corrigiendo ??
    estrenada ??
    (isError ? V["no-entendi"][3] : (V[face][variant] ?? V[face][0]));
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
        <style>{CLASSIC_CSS + DRAG_CSS}</style>
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
            {verNiveles && !rodando && mareo === 0 && (
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
          className={`tama ${sad ? "sad" : ""} ${leyendo ? "leyendo" : ""} ${v.shake && !isError ? "shake" : ""} ${relevo ? "relevo" : ""} ${fundiendo ? "fundido" : ""}`}
        >
          <div className="screen" style={{ color: sad ? pal.w : pal.face }}>
            {estrenando && <CapasEstreno version={version} />}
            {/* Sin micrófono en modo lectura: no está escuchando nada, y
                dejarlo puesto sería decir lo contrario de lo que pasa. */}
            {!leyendo && (
              <span
                className={`mic-px ${estrenando ? "u-entra" : ""}`}
                dangerouslySetInnerHTML={{ __html: MIC_SVG }}
              />
            )}
            <span className="scene">
              {/* La franja visible arranca en y=2: así el píxel sale un 40 % más
                grande sin tener que recolocar todos los sprites. */}
              <svg
                viewBox="0 2 48 16"
                dangerouslySetInnerHTML={{ __html: v.scene }}
              />
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
            {verNiveles && !rodando && mareo === 0 && (
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
