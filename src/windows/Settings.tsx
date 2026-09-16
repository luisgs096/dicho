import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  AppSettings,
  DictItem,
  GoogleStatus,
  HistoryItem,
  ModelProgress,
  ModelStatus,
} from "../types";
import { keyLabel } from "../types";
import Animaciones from "./Animaciones";
import VistaPrevia from "./VistaPrevia";
import { CAMBIOS, cambioDe, sinMarcas } from "./cambios";
import { useUpdater } from "./updater";

type Tab = "inicio" | "diccionario" | "historial" | "ajustes";

function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
  return `${(n / 1e3).toFixed(0)} KB`;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function HomeIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </svg>
  );
}


function BookIcon() {
  return (
    <svg {...iconProps}>
      <path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z" />
      <path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/** Copiar al portapapeles, diciéndolo.
 *
 *  Antes el botón llamaba a writeText y se quedaba mudo: no había forma de
 *  saber si había funcionado, así que uno lo pulsaba dos veces por si acaso. La
 *  confirmación va en el propio botón —no hace falta un sistema de avisos para
 *  una palabra— y el temporizador se limpia al desmontar, que si no React
 *  protesta cuando borras la entrada antes de que pasen los 1,5 s. */
function BotonCopiar(props: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  const reloj = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (reloj.current) window.clearTimeout(reloj.current);
    },
    [],
  );
  return (
    <button
      className={`ml-auto opacity-0 transition-opacity group-hover:opacity-100 ${
        copiado
          ? "font-medium text-emerald-600 opacity-100 dark:text-emerald-400"
          : "hover:text-blue-600 dark:hover:text-sky-400"
      }`}
      onClick={() => {
        navigator.clipboard.writeText(props.texto).then(() => {
          setCopiado(true);
          if (reloj.current) window.clearTimeout(reloj.current);
          reloj.current = window.setTimeout(() => setCopiado(false), 1500);
        });
      }}
    >
      {copiado ? "¡Copiado!" : "Copiar"}
    </button>
  );
}

function Section(props: {
  title: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h2 className="mb-1 text-sm font-semibold tracking-wide text-slate-800 dark:text-slate-100">
        {props.title}
      </h2>
      {props.hint && (
        <p className="mb-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          {props.hint}
        </p>
      )}
      <div className={props.hint ? "" : "mt-3"}>{props.children}</div>
    </section>
  );
}

/** Campanita del aviso de versión nueva. */
function CampanaIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-[11px] w-[11px]">
      <path d="M12 2a6 6 0 0 0-6 6v3.6l-1.3 2.6A1 1 0 0 0 5.6 16h12.8a1 1 0 0 0 .9-1.4L18 11.6V8a6 6 0 0 0-6-6Z" />
      <path d="M9.8 17.5a2.3 2.3 0 0 0 4.4 0Z" />
    </svg>
  );
}

const AVISO_CSS = `
  /* El aviso late despacio: llama la atención sin pedir auxilio. Verde y no
     rojo a propósito — una versión nueva es una buena noticia, no una alarma. */
  @keyframes latido {
    0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, .55); }
    60% { box-shadow: 0 0 0 5px rgba(16, 185, 129, 0); }
  }
  .aviso { animation: latido 2.4s ease-out infinite; }
`;

function NavItem(props: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  /** Hay algo esperando ahí dentro: sale la campanita verde. */
  aviso?: boolean;
}) {
  return (
    <button
      onClick={props.onClick}
      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
        props.active
          ? "bg-blue-600 text-white shadow-sm"
          : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      }`}
    >
      <span className="h-4 w-4 shrink-0">{props.icon}</span>
      {props.label}
      {props.aviso && (
        <span
          className="aviso ml-auto flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"
          title="Hay una versión nueva"
          aria-label="Hay una versión nueva"
        >
          <CampanaIcon />
        </span>
      )}
    </button>
  );
}

const fieldCls =
  "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-sky-400";
const inputCls = `${fieldCls} placeholder:text-slate-400 dark:placeholder:text-slate-500`;
const btnCls =
  "rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-40";
const btnGhostCls =
  "rounded-xl border border-slate-300 px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800";
const labelCls = "text-xs font-medium text-slate-500 dark:text-slate-400";

/** Los tres escalones de redacción. El orden importa: de menos a más permiso
 *  sobre tus palabras, que es lo único que de verdad los distingue. */
const NIVELES: {
  id: AppSettings["polish"];
  titulo: string;
  coste: string;
  desc: string;
  /** Lo que este escalón NO hace nunca. El techo importa más que el suelo: es
   *  lo que te deja dictar sin releer con lupa. */
  limite: string;
  ejemplo: string;
}[] = [
  {
    id: "rules",
    titulo: "Tal cual",
    coste: "al instante",
    desc: "Tus palabras exactas. Sólo puntuación, acentos y tu diccionario. No pasa por ninguna IA ni sale de tu equipo.",
    limite: "No quita nada ni cambia el orden. Lo que dijiste llega entero, muletillas incluidas.",
    ejemplo: "«o sea creo que deberíamos mover la reunión al jueves» → O sea, creo que deberíamos mover la reunión al jueves.",
  },
  {
    id: "groq_llm",
    titulo: "Estándar",
    coste: "~1 s",
    desc: "Mismas palabras, mejor forma: quita muletillas, aplica tus correcciones al vuelo y puntúa bien. Es el de siempre, y el más rápido.",
    limite: "No resume, no reordena y no contesta. Si le dictas una pregunta, escribe la pregunta.",
    ejemplo: "«o sea creo que deberíamos, bueno, mover la reunión al jueves» → Creo que deberíamos mover la reunión al jueves.",
  },
  {
    id: "groq_estructurado",
    titulo: "Editor",
    coste: "~2-3 s",
    desc: "Te lo REDACTA. No limpia tu dictado: lee la idea entera y la vuelve a escribir en párrafos, encadenando las frases y cambiando las muletillas por conectores de verdad. Suele salir un tercio más corto. Usa un modelo más grande, por eso tarda un par de segundos más.",
    limite: "No añade información, ejemplos, cifras ni conclusiones que no dijiste. Si se pasa, Dicho lo descarta solo y te deja el texto sin tocar.",
    ejemplo: "«lo que quiero decir es que, este, quizás mover la reunión, o sea moverla al jueves, porque el miércoles no puedo» → Movamos la reunión al jueves: el miércoles no puedo.",
  },
];

/** El sello de laboratorio: verde ácido y un matraz. Es la única parte de la
 *  app que se anuncia como experimental, y tiene que verse distinta al resto
 *  para que se note que ahí las cosas pueden cambiar. */
const LABS_CSS = `
  .labs-sello { animation: burbuja 3s ease-in-out infinite; }
  @keyframes burbuja { 0%, 100% { transform: translateY(0) rotate(-6deg); }
                       50% { transform: translateY(-2px) rotate(-6deg); } }
`;

const TAB_META: Record<Tab, { title: string; desc: string }> = {
  inicio: {
    title: "Inicio",
    desc: "Tu atajo para dictar y cómo se ve la onda flotante mientras hablas.",
  },
  diccionario: {
    title: "Diccionario",
    desc: "Términos que Dicho debe escribir exactamente como tú quieres.",
  },
  historial: {
    title: "Historial",
    desc: "Todo lo que has dictado, con las correcciones que aplicó tu diccionario.",
  },
  ajustes: {
    title: "Ajustes",
    desc: "Lo de debajo del capó: motores de voz, claves, tu cuenta de Google y actualizaciones.",
  },
};

// ─── Teclado gráfico para elegir el atajo ────────────────────────────────────

/** Tecla del teclado gráfico: code = nombre rdev (null → no capturable). */
interface KbKey {
  code: string | null;
  label: string;
  w?: number;
}

const K = (code: string, label: string, w?: number): KbKey => ({
  code,
  label,
  w,
});

const MAIN_ROWS: KbKey[][] = [
  [
    K("Escape", "Esc", 1.4),
    ...Array.from({ length: 12 }, (_, i) => K(`F${i + 1}`, `F${i + 1}`)),
  ],
  [
    K("BackQuote", "`"),
    ...[..."1234567890"].map((d) => K(`Num${d}`, d)),
    K("Minus", "-"),
    K("Equal", "="),
    K("Backspace", "⌫", 1.8),
  ],
  [
    K("Tab", "Tab", 1.5),
    ...[..."QWERTYUIOP"].map((c) => K(`Key${c}`, c)),
    K("LeftBracket", "["),
    K("RightBracket", "]"),
    K("BackSlash", "\\", 1.3),
  ],
  [
    K("CapsLock", "Bloq Mayús", 1.9),
    ...[..."ASDFGHJKL"].map((c) => K(`Key${c}`, c)),
    K("SemiColon", ";"),
    K("Quote", "'"),
    K("Return", "Entrar", 1.9),
  ],
  [
    K("ShiftLeft", "Mayús", 2.4),
    ...[..."ZXCVBNM"].map((c) => K(`Key${c}`, c)),
    K("Comma", ","),
    K("Dot", "."),
    K("Slash", "/"),
    K("ShiftRight", "Mayús", 2.4),
  ],
];

const BOTTOM_ROW_LAPTOP: KbKey[] = [
  K("ControlLeft", "Ctrl", 1.4),
  { code: null, label: "Fn" },
  K("MetaLeft", "Win", 1.2),
  K("Alt", "Alt", 1.2),
  K("Space", "Espacio", 5.6),
  K("AltGr", "AltGr", 1.2),
  K("ControlRight", "Ctrl", 1.4),
  K("LeftArrow", "←"),
  K("UpArrow", "↑"),
  K("DownArrow", "↓"),
  K("RightArrow", "→"),
];

const BOTTOM_ROW_EXTENDED: KbKey[] = [
  K("ControlLeft", "Ctrl", 1.6),
  K("MetaLeft", "Win", 1.3),
  K("Alt", "Alt", 1.3),
  K("Space", "Espacio", 7),
  K("AltGr", "AltGr", 1.3),
  K("MetaRight", "Win", 1.3),
  K("ControlRight", "Ctrl", 1.6),
];

const MODIFIERS = new Set([
  "ControlLeft",
  "ControlRight",
  "MetaLeft",
  "MetaRight",
  "Alt",
  "AltGr",
  "ShiftLeft",
  "ShiftRight",
]);

function Cap(props: {
  k: KbKey;
  selected: boolean;
  onToggle: (code: string) => void;
  className?: string;
}) {
  const { k, selected } = props;
  const base =
    "flex h-8 items-center justify-center overflow-hidden rounded-md border text-[9px] font-medium leading-none transition-colors";
  const style = k.code
    ? selected
      ? "border-blue-700 bg-blue-600 text-white shadow-sm ring-2 ring-blue-500/40"
      : "cursor-pointer border-slate-300 bg-white text-slate-600 hover:border-blue-400 hover:text-blue-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-sky-400 dark:hover:text-sky-300"
    : "border-slate-200 bg-slate-100 text-slate-300 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-600";
  return (
    <button
      type="button"
      disabled={!k.code}
      title={k.code ? keyLabel(k.code) : "No capturable"}
      onClick={() => k.code && props.onToggle(k.code)}
      style={{ flex: `${k.w ?? 1} ${k.w ?? 1} 0%` }}
      className={`${base} ${style} ${props.className ?? ""}`}
    >
      <span className="truncate px-0.5">{k.label}</span>
    </button>
  );
}

function KeyboardPicker(props: {
  selected: string[];
  onToggle: (code: string) => void;
}) {
  const [layout, setLayout] = useState<"laptop" | "extendido">("laptop");
  const isSel = (code: string | null) =>
    code !== null && props.selected.includes(code);
  const cap = (k: KbKey, i: number) => (
    <Cap key={i} k={k} selected={isSel(k.code)} onToggle={props.onToggle} />
  );
  const gridCap = (k: KbKey, i: number, extra?: string) => (
    <Cap
      key={i}
      k={k}
      selected={isSel(k.code)}
      onToggle={props.onToggle}
      className={extra}
    />
  );

  return (
    <div>
      <div className="mb-2 inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
        {(["laptop", "extendido"] as const).map((l) => (
          <button
            key={l}
            onClick={() => setLayout(l)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              layout === l
                ? "bg-blue-600 text-white"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {l === "laptop" ? "Laptop" : "Teclado extendido"}
          </button>
        ))}
      </div>

      <div className="flex gap-2 rounded-xl bg-slate-100 p-2 dark:bg-slate-950/60">
        {/* Bloque principal */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {MAIN_ROWS.map((row, r) => (
            <div key={r} className="flex gap-1">
              {row.map(cap)}
            </div>
          ))}
          <div className="flex gap-1">
            {(layout === "laptop" ? BOTTOM_ROW_LAPTOP : BOTTOM_ROW_EXTENDED).map(
              cap,
            )}
          </div>
        </div>

        {layout === "extendido" && (
          <>
            {/* Bloque de navegación + flechas */}
            <div className="flex w-[19%] shrink-0 flex-col gap-1">
              <div className="grid grid-cols-3 gap-1">
                {[
                  K("Insert", "Ins"),
                  K("Home", "Inicio"),
                  K("PageUp", "RePág"),
                  K("Delete", "Supr"),
                  K("End", "Fin"),
                  K("PageDown", "AvPág"),
                ].map((k, i) => gridCap(k, i))}
              </div>
              <div className="mt-auto grid grid-cols-3 gap-1">
                <span />
                {gridCap(K("UpArrow", "↑"), 100)}
                <span />
                {gridCap(K("LeftArrow", "←"), 101)}
                {gridCap(K("DownArrow", "↓"), 102)}
                {gridCap(K("RightArrow", "→"), 103)}
              </div>
            </div>

            {/* Numpad */}
            <div className="grid w-[22%] shrink-0 grid-cols-4 gap-1">
              {gridCap(K("NumLock", "Bloq"), 0)}
              {gridCap(K("KpDivide", "÷"), 1)}
              {gridCap(K("KpMultiply", "×"), 2)}
              {gridCap(K("KpMinus", "−"), 3)}
              {gridCap(K("Kp7", "7"), 4)}
              {gridCap(K("Kp8", "8"), 5)}
              {gridCap(K("Kp9", "9"), 6)}
              {gridCap(K("KpPlus", "+"), 7, "row-span-2 !h-auto")}
              {gridCap(K("Kp4", "4"), 8)}
              {gridCap(K("Kp5", "5"), 9)}
              {gridCap(K("Kp6", "6"), 10)}
              {gridCap(K("Kp1", "1"), 11)}
              {gridCap(K("Kp2", "2"), 12)}
              {gridCap(K("Kp3", "3"), 13)}
              {gridCap(K("KpReturn", "⏎"), 14, "row-span-2 !h-auto")}
              {gridCap(K("Kp0", "0"), 15, "col-span-2")}
              {gridCap(K("KpDelete", "."), 16)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Pantalla principal ──────────────────────────────────────────────────────

export default function Settings() {
  const [tab, setTab] = useState<Tab>("inicio");
  const [verAnimaciones, setVerAnimaciones] = useState(false);
  // Novedades: por defecto sólo las de la versión puesta; el resto se despliega.
  const [verCambios, setVerCambios] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [model, setModel] = useState<ModelStatus | null>(null);
  const [progress, setProgress] = useState<ModelProgress | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [search, setSearch] = useState("");
  const [onlyCorrected, setOnlyCorrected] = useState(false);
  const [dict, setDict] = useState<DictItem[]>([]);
  const [term, setTerm] = useState("");
  const [replacement, setReplacement] = useState("");
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [googleBusy, setGoogleBusy] = useState<"login" | "sync" | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [hotkeyDraft, setHotkeyDraft] = useState<string[] | null>(null);
  // `update` ya es el actualizador de ajustes de esta pantalla: el de versiones
  // va con nombre propio para no pisarlo.
  const {
    estado: actualizacion,
    versionActual,
    buscar: buscarActualizacion,
    instalar: instalarActualizacion,
  } = useUpdater();
  // Lo que trajo la versión que corre ahora. Sale de CAMBIOS.md, que viaja
  // dentro del binario: se ve sin internet y no depende de GitHub.
  const novedades = cambioDe(versionActual);

  const refreshHistory = useCallback((q: string) => {
    invoke<HistoryItem[]>("get_history", { search: q || null, limit: 100 })
      .then(setHistory)
      .catch(console.error);
  }, []);

  const refreshDict = useCallback(() => {
    invoke<DictItem[]>("dict_list").then(setDict).catch(console.error);
  }, []);

  const refreshGoogle = useCallback(() => {
    invoke<GoogleStatus>("google_status").then(setGoogle).catch(console.error);
  }, []);

  useEffect(() => {
    invoke<AppSettings>("get_settings").then(setSettings).catch(console.error);
    invoke<ModelStatus>("model_status").then(setModel).catch(console.error);
    invoke<boolean>("has_groq_key").then(setHasKey).catch(console.error);
    refreshHistory("");
    refreshDict();
    refreshGoogle();

    const unProgress = listen<ModelProgress>("model-progress", (e) => {
      if (e.payload.error) {
        setModelError(e.payload.error);
        setProgress(null);
        invoke<ModelStatus>("model_status").then(setModel).catch(console.error);
        return;
      }
      setModelError(null);
      setProgress(e.payload);
      if (e.payload.done) {
        setModel({ state: "ready" });
        setProgress(null);
      }
    });
    const unHistory = listen("history-changed", () => refreshHistory(""));
    const unDict = listen("dict-changed", () => refreshDict());
    // El modo colocación también se apaga solo al cerrar esta ventana, así que
    // el botón se entera por el mismo evento que el HUD y no se queda diciendo
    // "Listo, déjala ahí" cuando ya no hay nada que colocar.
    return () => {
      unProgress.then((f) => f());
      unHistory.then((f) => f());
      unDict.then((f) => f());
    };
  }, [refreshHistory, refreshDict, refreshGoogle]);

  const update = (patch: Partial<AppSettings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    invoke("save_settings", { newSettings: next }).catch(console.error);
  };

  const downloading =
    progress !== null || (model !== null && model.state === "downloading");

  const visibleHistory = onlyCorrected
    ? history.filter((h) => h.corrections.length > 0)
    : history;

  // Atajo: borrador local hasta que el usuario guarde.
  const currentHotkey = settings?.hotkey ?? [];
  const draft = hotkeyDraft ?? currentHotkey;
  const draftHasModifier = draft.some((k) => MODIFIERS.has(k));
  const draftChanged =
    hotkeyDraft !== null &&
    (draft.length !== currentHotkey.length ||
      draft.some((k) => !currentHotkey.includes(k)));
  const toggleKey = (code: string) => {
    const base = hotkeyDraft ?? currentHotkey;
    setHotkeyDraft(
      base.includes(code)
        ? base.filter((k) => k !== code)
        : base.length >= 4
          ? base
          : [...base, code],
    );
  };

  const googleLogin = () => {
    setGoogleBusy("login");
    setGoogleError(null);
    invoke<GoogleStatus>("google_login")
      .then(setGoogle)
      .catch((e) => setGoogleError(String(e)))
      .finally(() => setGoogleBusy(null));
  };

  const googleSync = () => {
    setGoogleBusy("sync");
    setGoogleError(null);
    invoke<GoogleStatus>("google_sync_now")
      .then(setGoogle)
      .catch((e) => setGoogleError(String(e)))
      .finally(() => setGoogleBusy(null));
  };

  const googleLogout = () => {
    invoke("google_logout")
      .then(refreshGoogle)
      .catch((e) => setGoogleError(String(e)));
  };

  return (
    <div className="flex h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <style>{AVISO_CSS}</style>
      <aside className="flex w-52 shrink-0 flex-col border-r border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="px-3 text-2xl font-black tracking-tight text-blue-600 dark:text-sky-400">
          Dicho
        </h1>
        <p className="mb-5 px-3 text-[11px] font-medium text-slate-400 dark:text-slate-500">
          Dicho y hecho.
        </p>
        <nav className="flex flex-1 flex-col gap-1">
          <NavItem
            active={tab === "inicio"}
            onClick={() => setTab("inicio")}
            icon={<HomeIcon />}
            label="Inicio"
          />
          <NavItem
            active={tab === "diccionario"}
            onClick={() => setTab("diccionario")}
            icon={<BookIcon />}
            label="Diccionario"
          />
          <NavItem
            active={tab === "historial"}
            onClick={() => setTab("historial")}
            icon={<ClockIcon />}
            label="Historial"
          />
          <div className="mt-auto border-t border-slate-200 pt-2 dark:border-slate-800">
            <NavItem
              active={tab === "ajustes"}
              onClick={() => setTab("ajustes")}
              icon={<GearIcon />}
              label="Ajustes"
              aviso={actualizacion.fase === "disponible"}
            />
          </div>
        </nav>
        <p className="mt-3 px-3 text-[10px] text-slate-400 dark:text-slate-600">
          {/* La versión sale del binario, igual que en Ajustes: escrita a mano se
              quedaba clavada en la del día que se tecleó. */}
          {versionActual ? `v${versionActual}` : "v…"} — corre en tu equipo
        </p>
      </aside>

      <main className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          <header className="mb-1">
            <h1 className="text-xl font-bold tracking-tight">
              {TAB_META[tab].title}
            </h1>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              {TAB_META[tab].desc}
            </p>
          </header>

          {tab === "inicio" && (
            <>
              <Section
                title="Atajo para dictar"
                hint="Mantén estas teclas y habla; suéltalas y el texto aparece donde estés escribiendo. Haz clic en el teclado para armar tu combinación (máximo 4 teclas, al menos un modificador como Ctrl, Win, Alt o Mayús)."
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className={labelCls}>Combinación:</span>
                  {draft.length === 0 ? (
                    <span className="text-xs text-amber-600 dark:text-amber-400">
                      elige al menos una tecla
                    </span>
                  ) : (
                    draft.map((k) => (
                      <kbd
                        key={k}
                        className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300"
                      >
                        {keyLabel(k)}
                      </kbd>
                    ))
                  )}
                </div>

                <KeyboardPicker selected={draft} onToggle={toggleKey} />

                <div className="mt-3 flex items-center gap-2">
                  <button
                    className={btnCls}
                    disabled={
                      !draftChanged || draft.length === 0 || !draftHasModifier
                    }
                    onClick={() => {
                      update({ hotkey: draft });
                      setHotkeyDraft(null);
                    }}
                  >
                    Guardar atajo
                  </button>
                  <button
                    className={btnGhostCls}
                    onClick={() => setHotkeyDraft(["ControlLeft", "MetaLeft"])}
                  >
                    Restaurar Ctrl + Win
                  </button>
                  {draftChanged && (
                    <button
                      className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                      onClick={() => setHotkeyDraft(null)}
                    >
                      Descartar cambios
                    </button>
                  )}
                </div>
                {!draftHasModifier && draft.length > 0 && (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    Incluye al menos un modificador (Ctrl, Win, Alt o Mayús);
                    si no, el dictado se activaría al escribir normal.
                  </p>
                )}
              </Section>

              <Section
                title="LABS · Cómo te redacta"
                hint="Cuánto permiso le das a Dicho sobre lo que dijiste. Sube un escalón sólo cuando quieras que te ayude a ordenar la idea, no a copiarla."
              >
                {settings ? (
                  <div className="flex flex-col gap-2.5">
                    <style>{LABS_CSS}</style>
                    {/* El sello. Verde ácido y matraz, a propósito distinto del
                        azul del resto: es la única parte de la app que se
                        anuncia como experimental, y tiene que verse. */}
                    <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-emerald-400/70 bg-emerald-50/60 px-3 py-2 dark:border-emerald-500/40 dark:bg-emerald-950/30">
                      <span className="labs-sello text-emerald-600 dark:text-emerald-400">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-5 w-5"
                        >
                          <path d="M9 3h6" />
                          <path d="M10 3v6.5L4.8 18a2 2 0 0 0 1.7 3h11a2 2 0 0 0 1.7-3L14 9.5V3" />
                          <path d="M7.3 14h9.4" />
                        </svg>
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="rounded bg-emerald-600 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-widest text-white dark:bg-emerald-500">
                          LABS
                        </span>
                        <span className="ml-2 text-[11px] text-emerald-800 dark:text-emerald-300">
                          Experimento en curso: esto puede cambiar de una versión
                          a otra.
                        </span>
                      </div>
                    </div>

                    {NIVELES.map((n) => {
                      const activo = settings.polish === n.id;
                      const bloqueado = n.id !== "rules" && !hasKey;
                      return (
                        <button
                          key={n.id}
                          type="button"
                          disabled={bloqueado}
                          onClick={() => update({ polish: n.id })}
                          className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                            activo
                              ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/20 dark:border-emerald-400 dark:bg-emerald-950/40 dark:ring-emerald-400/20"
                              : "border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/40 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-emerald-700"
                          }`}
                        >
                          <span
                            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                              activo
                                ? "border-emerald-600 dark:border-emerald-400"
                                : "border-slate-300 dark:border-slate-600"
                            }`}
                          >
                            {activo && (
                              <span className="h-2 w-2 rounded-full bg-emerald-600 dark:bg-emerald-400" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold">
                                {n.titulo}
                              </span>
                              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                {n.coste}
                              </span>
                              {bloqueado && (
                                <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                                  necesita la key de Groq (Ajustes)
                                </span>
                              )}
                            </span>
                            <span className="mt-1 block text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                              {n.desc}
                            </span>
                            <span className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2.2}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="mt-[3px] h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400"
                              >
                                <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z" />
                              </svg>
                              <span>{n.limite}</span>
                            </span>
                            <span className="mt-1.5 block rounded-lg bg-slate-50 px-2 py-1 font-mono text-[10px] leading-relaxed text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                              {n.ejemplo}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                    <label className="mt-1 flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={settings.hud_niveles}
                        onChange={(e) => update({ hud_niveles: e.target.checked })}
                        className="mt-0.5 h-4 w-4 accent-emerald-600"
                      />
                      <span>
                        Enseñar la cinta de niveles debajo de la onda
                        <span className="mt-1 block text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                          Una tira fina con los tres, y el puesto en azul. Sirve
                          para cambiarlo de un clic justo antes de hablar, que es
                          cuando de verdad lo decides. Se ve mejor con la onda
                          clavada.
                        </span>
                      </span>
                    </label>

                    <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                      Editor es el único que puede cambiarte las palabras.
                      Si el resultado se aleja demasiado de lo que dijiste —o trae
                      palabras que tú no usaste— Dicho lo descarta solo y escribe
                      la versión limpia de siempre, sin avisar y sin perder nada.
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">Cargando…</p>
                )}
              </Section>

              <Section
                title="La onda flotante"
                hint="La cápsula que aparece mientras hablas. Las dos hacen exactamente lo mismo: sólo cambia la cara. Pulsa la que te guste y se queda puesta."
              >
                {settings ? (
                  <div className="flex flex-col gap-3">
                    <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={settings.hud_enabled}
                        onChange={(e) => update({ hud_enabled: e.target.checked })}
                        className="h-4 w-4 accent-blue-600"
                      />
                      Mostrarla mientras dicto
                    </label>

                    {settings.hud_enabled && (
                      <>
                        <VistaPrevia
                          value={settings.hud_style}
                          onChange={(v) => update({ hud_style: v })}
                          onVerCaritas={() => setVerAnimaciones(true)}
                        />

                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
                          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                            Todo lo demás se hace sobre la onda misma
                          </p>
                          <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                            Pásale el ratón por encima y aparece un botón de lápiz
                            a la derecha. Ahí puedes <strong>clavarla</strong> para
                            que se quede siempre a la vista, o{" "}
                            <strong>cambiarla de sitio</strong> —y entonces los
                            botones se convierten en «listo» y «devolverla a su
                            sitio»—. Clavada y sin dictar se pone translúcida para
                            no estorbar.
                          </p>
                          <p className="mt-2 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                            Si la onda no está a la vista, enciéndela abajo o
                            dicta una vez: sale sola.
                          </p>
                        </div>

                        <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={settings.hud_arrastrable}
                            onChange={(e) =>
                              update({ hud_arrastrable: e.target.checked })
                            }
                            className="h-4 w-4 accent-blue-600"
                          />
                          Que la onda responda al ratón
                        </label>
                        <p className="-mt-1 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                          Encendido, la onda atrapa el ratón mientras está a la
                          vista: es lo que permite pasarle el cursor por encima y
                          usar su menú. A cambio, los clics que caigan sobre ella
                          van a ella y no a lo que tengas debajo. Apagándolo
                          vuelve a ser un cristal que se atraviesa — y entonces su
                          menú deja de existir, así que sólo podrás moverla o
                          clavarla volviendo a encender esto.
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">Cargando…</p>
                )}
              </Section>
            </>
          )}

          {tab === "diccionario" && (
            <Section
              title="Diccionario personal"
              hint="Nombres propios, marcas o términos que Dicho debe escribir exactamente así. Con reemplazo corrige transcripciones erróneas; cada corrección aplicada queda marcada en el Historial."
            >
              <div className="mb-3 flex gap-2">
                <input
                  className={`${inputCls} flex-1`}
                  placeholder="Término que transcribe mal"
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                />
                <input
                  className={`${inputCls} flex-1`}
                  placeholder="Cómo debe escribirse (opcional)"
                  value={replacement}
                  onChange={(e) => setReplacement(e.target.value)}
                />
                <button
                  className={btnCls}
                  disabled={!term.trim()}
                  onClick={() =>
                    invoke("dict_add", {
                      term,
                      replacement: replacement.trim() || null,
                    }).then(() => {
                      setTerm("");
                      setReplacement("");
                      refreshDict();
                    })
                  }
                >
                  Agregar
                </button>
              </div>
              {dict.length === 0 ? (
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Aún no hay términos.
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {dict.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60"
                    >
                      <span className="text-slate-700 dark:text-slate-200">
                        {d.term}
                        {d.replacement && (
                          <span className="text-slate-400 dark:text-slate-500">
                            {" "}
                            → {d.replacement}
                          </span>
                        )}
                      </span>
                      <button
                        className="text-xs text-slate-400 transition-colors hover:text-amber-600 dark:text-slate-500 dark:hover:text-amber-400"
                        onClick={() =>
                          invoke("dict_remove", { id: d.id }).then(refreshDict)
                        }
                      >
                        Eliminar
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {tab === "historial" && (
            <Section title="Tus dictados">
              <div className="mb-3 flex items-center gap-3">
                <input
                  className={`${inputCls} flex-1`}
                  placeholder="Buscar en tus dictados…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    refreshHistory(e.target.value);
                  }}
                />
                <label className="flex shrink-0 items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={onlyCorrected}
                    onChange={(e) => setOnlyCorrected(e.target.checked)}
                    className="h-3.5 w-3.5 accent-blue-600"
                  />
                  Solo con correcciones
                </label>
              </div>
              {visibleHistory.length === 0 ? (
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {onlyCorrected
                    ? "Ningún dictado con correcciones del diccionario todavía."
                    : "Aquí aparecerá todo lo que dictes."}
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {visibleHistory.map((h) => (
                    <li
                      key={h.id}
                      className="group rounded-xl bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60"
                    >
                      <p className="text-slate-800 dark:text-slate-100">
                        {h.polished}
                      </p>
                      {h.corrections.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {h.corrections.map((c, i) => (
                            <span
                              key={i}
                              title="Corregido por tu diccionario"
                              className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-sky-500/10 dark:text-sky-300"
                            >
                              <span className="line-through opacity-60">
                                {c.term}
                              </span>
                              <span>→</span>
                              <span>{c.replacement}</span>
                              {c.count > 1 && (
                                <span className="opacity-60">×{c.count}</span>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-400 dark:text-slate-500">
                        <span>{fmtDate(h.ts)}</span>
                        <span>
                          {h.engine === "parakeet" ? "local" : h.engine}
                        </span>
                        <span>{(h.duration_ms / 1000).toFixed(1)} s</span>
                        <BotonCopiar texto={h.polished} />
                        <button
                          className="opacity-0 transition-opacity hover:text-amber-600 group-hover:opacity-100 dark:hover:text-amber-400"
                          onClick={() =>
                            invoke("delete_history", { id: h.id }).then(() =>
                              refreshHistory(search),
                            )
                          }
                        >
                          Eliminar
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {tab === "ajustes" && settings && (
            <>
              <Section title="Dictado">
                <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                  <label className="flex flex-col gap-1.5">
                    <span className={labelCls}>Motor de transcripción</span>
                    <select
                      className={fieldCls}
                      value={settings.engine}
                      onChange={(e) =>
                        update({
                          engine: e.target.value as AppSettings["engine"],
                        })
                      }
                    >
                      <option value="parakeet">
                        Local — Parakeet V3 (privado, gratis)
                      </option>
                      <option value="groq" disabled={!hasKey}>
                        Cloud — Groq Whisper turbo{" "}
                        {hasKey ? "" : "(requiere API key)"}
                      </option>
                    </select>
                    <span className="text-[11px] leading-snug text-slate-400 dark:text-slate-500">
                      ¿Mezclas español e inglés en la misma frase? El motor
                      local elige un solo idioma por dictado; para spanglish
                      fluido usa el motor cloud (gratis con API key de Groq).
                    </span>
                  </label>

                  <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
                    <strong className="text-slate-600 dark:text-slate-300">
                      Cómo te redacta se elige en Inicio,
                    </strong>{" "}
                    en la sección LABS: ahí están los tres niveles, con un ejemplo
                    de lo que hace cada uno.
                  </p>

                  <label className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={settings.no_traducir}
                      onChange={(e) => update({ no_traducir: e.target.checked })}
                      className="mt-0.5 h-4 w-4 accent-blue-600"
                    />
                    <span>
                      No traducir nunca
                      <span className="mt-0.5 block text-xs text-slate-400 dark:text-slate-500">
                        Conserva cada palabra en el idioma en que la dijiste. El motor
                        decide un solo idioma cada 30 s, así que Dicho corta el audio en
                        tus pausas para que cada tramo decida por su cuenta; aun así, una
                        palabra suelta en el otro idioma puede salir traducida.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={settings.copiar_al_portapapeles}
                      onChange={(e) =>
                        update({ copiar_al_portapapeles: e.target.checked })
                      }
                      className="mt-0.5 h-4 w-4 accent-blue-600"
                    />
                    <span>
                      Dejar el dictado en el portapapeles
                      <span className="mt-0.5 block text-xs text-slate-400 dark:text-slate-500">
                        Además de pegarlo donde estés escribiendo, el texto se queda
                        copiado y puedes volver a pegarlo con Ctrl+V donde quieras. Ojo:
                        con esto encendido, <strong>cada dictado pisa lo que tuvieras
                        copiado</strong>. Apagado, Dicho te devuelve lo de antes.
                      </span>
                    </span>
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className={labelCls}>Idioma del dictado</span>
                    <select
                      className={`${fieldCls} disabled:opacity-40`}
                      disabled={settings.no_traducir}
                      value={settings.language}
                      onChange={(e) => update({ language: e.target.value })}
                    >
                      <option value="auto">Detección automática</option>
                      <option value="es">Español</option>
                      <option value="en">English</option>
                    </select>
                    {settings.no_traducir && (
                      <span className="text-xs text-slate-400 dark:text-slate-500">
                        Sin efecto mientras "no traducir" esté encendido: fijar el idioma
                        es justo lo que empuja al motor a traducir el otro.
                      </span>
                    )}
                  </label>
                </div>
              </Section>

              <Section title="Modelo de voz local">
                {model?.state === "ready" && !downloading && (
                  <p className="flex items-center gap-2 text-sm text-blue-600 dark:text-sky-400">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white dark:bg-sky-500">
                      ✓
                    </span>
                    Parakeet V3 listo — todo se procesa en tu equipo, sin
                    internet.
                  </p>
                )}
                {downloading && (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      Descargando modelo…{" "}
                      {progress ? fmtBytes(progress.downloaded) : ""}
                      {progress ? ` de ${fmtBytes(progress.total)}` : ""}
                    </p>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full bg-blue-600 transition-all dark:bg-sky-500"
                        style={{
                          width: progress
                            ? `${Math.round((progress.downloaded / progress.total) * 100)}%`
                            : "0%",
                        }}
                      />
                    </div>
                  </div>
                )}
                {model?.state === "missing" && !downloading && (
                  <div className="flex items-center gap-3">
                    <p className="flex-1 text-sm text-slate-600 dark:text-slate-300">
                      Falta el modelo Parakeet V3 ({fmtBytes(671_000_000)},
                      descarga única).
                    </p>
                    <button
                      className={btnCls}
                      onClick={() => {
                        setModelError(null);
                        invoke("download_model");
                      }}
                    >
                      {modelError ? "Reintentar" : "Descargar"}
                    </button>
                  </div>
                )}
                {modelError && !downloading && (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    {modelError}
                  </p>
                )}
              </Section>

              <Section
                title="Conectar Groq — opcional, gratis y sin tarjeta"
                hint="Dicho ya funciona entero sin esto. Conectar Groq es para cuando quieres más velocidad o dictas mezclando español e inglés en la misma frase."
              >
                {hasKey ? (
                  <div className="flex items-center gap-3">
                    <p className="flex-1 text-sm text-blue-600 dark:text-sky-400">
                      ✓ Groq conectado. Arriba, en «Motor de transcripción», ya
                      puedes elegir el motor cloud y la limpieza con IA.
                    </p>
                    <button
                      className={btnGhostCls}
                      onClick={() =>
                        invoke("delete_groq_key").then(() => {
                          setHasKey(false);
                          if (settings)
                            update({ engine: "parakeet", polish: "rules" });
                        })
                      }
                    >
                      Desconectar
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-5">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
                        <p className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                          Ahora mismo — motor local
                        </p>
                        <ul className="flex flex-col gap-1.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                          <li>Tu voz no sale nunca de este equipo.</li>
                          <li>Funciona sin internet.</li>
                          <li>
                            Elige un solo idioma por dictado: el spanglish se le
                            atraganta.
                          </li>
                          <li>Ocupa 670 MB en disco y RAM mientras dictas.</li>
                        </ul>
                      </div>
                      <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3.5 dark:border-sky-900 dark:bg-sky-950/40">
                        <p className="mb-2 text-xs font-semibold text-blue-700 dark:text-sky-300">
                          Con Groq conectado
                        </p>
                        <ul className="flex flex-col gap-1.5 text-[11px] leading-snug text-slate-600 dark:text-slate-300">
                          <li>Más rápido, sobre todo en dictados largos.</li>
                          <li>
                            Respeta el spanglish: cada tramo decide su idioma.
                          </li>
                          <li>
                            Desbloquea la limpieza con IA, que además ordena la
                            frase.
                          </li>
                          <li>
                            Necesita internet y envía tu audio a Groq para
                            transcribirlo.
                          </li>
                        </ul>
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                        Sacar la key son tres minutos:
                      </p>
                      <ol className="flex flex-col gap-1.5 text-xs leading-snug text-slate-500 dark:text-slate-400">
                        <li>
                          <b className="text-slate-700 dark:text-slate-300">1.</b>{" "}
                          Entra a console.groq.com y crea la cuenta con Google o
                          GitHub. No pide tarjeta.
                        </li>
                        <li>
                          <b className="text-slate-700 dark:text-slate-300">2.</b>{" "}
                          En el menú «API Keys», pulsa «Create API Key» y ponle
                          un nombre cualquiera, por ejemplo Dicho.
                        </li>
                        <li>
                          <b className="text-slate-700 dark:text-slate-300">3.</b>{" "}
                          Copia la clave que empieza por <code>gsk_</code> y
                          pégala aquí abajo. Sólo se muestra una vez.
                        </li>
                      </ol>
                      <button
                        className={`${btnGhostCls} mt-3`}
                        onClick={() => openUrl("https://console.groq.com/keys")}
                      >
                        Abrir console.groq.com ↗
                      </button>
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="password"
                        className={`${inputCls} flex-1`}
                        placeholder="Pega aquí tu key: gsk_…"
                        value={keyInput}
                        onChange={(e) => setKeyInput(e.target.value)}
                      />
                      <button
                        className={btnCls}
                        disabled={!keyInput.trim()}
                        onClick={() =>
                          invoke("set_groq_key", { key: keyInput })
                            .then(() => {
                              setHasKey(true);
                              setKeyInput("");
                              // Conectar Groq sin activarlo no le sirve a nadie.
                              update({ engine: "groq" });
                            })
                            .catch((e) => alert(String(e)))
                        }
                      >
                        Conectar
                      </button>
                    </div>

                    <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                      La key se guarda cifrada en el Administrador de
                      credenciales de Windows, nunca en un archivo del proyecto.
                      El plan gratuito de Groq admite 20 peticiones por minuto,
                      de sobra para dictar todo el día: Dicho manda un trozo cada
                      20-55 segundos de audio.
                    </p>
                  </div>
                )}
              </Section>

              <Section
                title="Cuenta de Google"
                hint="Inicia sesión para llevar tu diccionario y tu historial a cualquier dispositivo. Se guardan en un espacio privado de tu propio Google Drive: nadie más los ve, ni siquiera nosotros."
              >
                {google?.email ? (
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold uppercase text-white dark:bg-sky-500">
                      {google.email[0]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                        {google.email}
                      </p>
                      <p className="text-xs text-slate-400 dark:text-slate-500">
                        {google.last_sync_ms
                          ? `Última sincronización: ${fmtDate(google.last_sync_ms)}`
                          : "Aún sin sincronizar"}
                      </p>
                    </div>
                    <button
                      className={btnGhostCls}
                      disabled={googleBusy !== null}
                      onClick={googleSync}
                    >
                      {googleBusy === "sync"
                        ? "Sincronizando…"
                        : "Sincronizar ahora"}
                    </button>
                    <button
                      className="text-xs text-slate-400 transition-colors hover:text-amber-600 dark:text-slate-500 dark:hover:text-amber-400"
                      onClick={googleLogout}
                    >
                      Cerrar sesión
                    </button>
                  </div>
                ) : google?.configured ? (
                  <button
                    className="flex items-center gap-2.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                    disabled={googleBusy !== null}
                    onClick={googleLogin}
                  >
                    <GoogleG />
                    {googleBusy === "login"
                      ? "Esperando al navegador…"
                      : "Continuar con Google"}
                  </button>
                ) : google ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      Para activar la sincronización hace falta un cliente OAuth
                      gratuito de Google (una sola vez, ~5 minutos).
                    </p>
                    <button
                      className={`${btnGhostCls} self-start`}
                      onClick={() => setShowSetup(!showSetup)}
                    >
                      {showSetup ? "Ocultar pasos" : "Configurar"}
                    </button>
                    {showSetup && settings && (
                      <div className="mt-1 flex flex-col gap-2 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                        <ol className="list-inside list-decimal space-y-1">
                          <li>
                            Abre la{" "}
                            <button
                              className="font-semibold text-blue-600 underline dark:text-sky-400"
                              onClick={() =>
                                openUrl("https://console.cloud.google.com")
                              }
                            >
                              Google Cloud Console
                            </button>{" "}
                            y crea un proyecto (p. ej. "Dicho").
                          </li>
                          <li>
                            En "APIs y servicios → Biblioteca" habilita{" "}
                            <b>Google Drive API</b>.
                          </li>
                          <li>
                            En "Pantalla de consentimiento OAuth" elige
                            "Externo" y agrégate como usuario de prueba.
                          </li>
                          <li>
                            En "Credenciales → Crear credenciales → ID de
                            cliente de OAuth" elige tipo{" "}
                            <b>App de escritorio</b>.
                          </li>
                          <li>Copia aquí el ID y el secreto de cliente:</li>
                        </ol>
                        <input
                          className={`${inputCls} w-full`}
                          placeholder="Client ID (…apps.googleusercontent.com)"
                          value={settings.google_client_id}
                          onChange={(e) =>
                            update({ google_client_id: e.target.value })
                          }
                        />
                        <input
                          type="password"
                          className={`${inputCls} w-full`}
                          placeholder="Client secret (GOCSPX-…)"
                          value={settings.google_client_secret}
                          onChange={(e) =>
                            update({ google_client_secret: e.target.value })
                          }
                        />
                        <button
                          className={`${btnCls} self-start`}
                          disabled={
                            !settings.google_client_id.trim() ||
                            !settings.google_client_secret.trim()
                          }
                          onClick={refreshGoogle}
                        >
                          Listo
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">Cargando…</p>
                )}
                {googleError && (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    {googleError}
                  </p>
                )}
              </Section>

              <Section
                title="Sistema"
                hint="El atajo para dictar y la onda flotante se configuran en Inicio."
              >
                <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={settings.autostart}
                    onChange={(e) => update({ autostart: e.target.checked })}
                    className="h-4 w-4 accent-blue-600"
                  />
                  Iniciar con Windows
                </label>
              </Section>

              <Section
                title="Novedades de esta versión"
                hint="Qué trajo la versión que tienes puesta. Va dentro de la app, así que está a mano siempre, con o sin internet."
              >
                {novedades ? (
                  <>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      Dicho {novedades.version}
                      {novedades.fecha && (
                        <span className="ml-2 text-xs font-normal text-slate-400 dark:text-slate-500">
                          {novedades.fecha}
                        </span>
                      )}
                    </p>
                    <ul className="mt-2.5 flex flex-col gap-2">
                      {novedades.bullets.map((b, i) => (
                        <li
                          key={i}
                          className="flex gap-2.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300"
                        >
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500 dark:bg-sky-400" />
                          <span>{sinMarcas(b)}</span>
                        </li>
                      ))}
                    </ul>
                    {versionActual && novedades.version !== versionActual && (
                      <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                        Esta copia es la {versionActual} y no trae apartado
                        propio; arriba sale el más reciente que hay escrito.
                      </p>
                    )}
                    <button
                      className={`${btnGhostCls} mt-3`}
                      onClick={() => setVerCambios((v) => !v)}
                    >
                      {verCambios
                        ? "Ocultar versiones anteriores"
                        : `Ver versiones anteriores (${CAMBIOS.length - 1})`}
                    </button>
                    {verCambios && (
                      <div className="mt-3 flex flex-col gap-4 border-t border-slate-200 pt-3 dark:border-slate-800">
                        {CAMBIOS.filter((c) => c.version !== novedades.version).map(
                          (c) => (
                            <div key={c.version}>
                              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                                {c.version}
                                {c.fecha && ` — ${c.fecha}`}
                              </p>
                              <ul className="mt-1 flex flex-col gap-1">
                                {c.bullets.map((b, i) => (
                                  <li
                                    key={i}
                                    className="flex gap-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400"
                                  >
                                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-300 dark:bg-slate-600" />
                                    <span>{sinMarcas(b)}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ),
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-slate-400">
                    No hay notas escritas todavía.
                  </p>
                )}
              </Section>

              <Section
                title="Actualizaciones"
                hint="Dicho mira si hay versión nueva cada vez que abres esta ventana. Cada actualización viene firmada: si la firma no cuadra, no se instala."
              >
                {actualizacion.fase === "disponible" ? (
                  <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3.5 dark:border-sky-900 dark:bg-sky-950/40">
                    <p className="text-sm font-semibold text-blue-700 dark:text-sky-300">
                      Dicho {actualizacion.version} ya está disponible
                    </p>
                    {actualizacion.notas && (
                      <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                        {actualizacion.notas}
                      </p>
                    )}
                    <button
                      className={`${btnCls} mt-3`}
                      onClick={instalarActualizacion}
                    >
                      Actualizar ahora
                    </button>
                    <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
                      Dicho se cierra un momento para instalarla y vuelve solo.
                      No perderás el historial ni el diccionario.
                    </p>
                  </div>
                ) : actualizacion.fase === "descargando" ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      Descargando {actualizacion.version}…{" "}
                      {actualizacion.total > 0
                        ? `${fmtBytes(actualizacion.hechos)} de ${fmtBytes(actualizacion.total)}`
                        : ""}
                    </p>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full bg-blue-600 transition-all dark:bg-sky-500"
                        style={{
                          width:
                            actualizacion.total > 0
                              ? `${Math.round((actualizacion.hechos / actualizacion.total) * 100)}%`
                              : "0%",
                        }}
                      />
                    </div>
                  </div>
                ) : actualizacion.fase === "listo" ? (
                  <p className="text-sm text-blue-600 dark:text-sky-400">
                    Descarga terminada — instalando y reiniciando Dicho…
                  </p>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <p className="text-sm text-slate-700 dark:text-slate-200">
                        Versión instalada: {versionActual ?? "…"}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                        {actualizacion.fase === "buscando"
                          ? "Buscando…"
                          : actualizacion.fase === "alDia"
                            ? "Estás al día."
                            : actualizacion.fase === "error"
                              ? "No se pudo comprobar. Revisa tu conexión."
                              : "Se comprueba sola al abrir esta ventana."}
                      </p>
                    </div>
                    <button
                      className={btnGhostCls}
                      disabled={actualizacion.fase === "buscando"}
                      onClick={() => buscarActualizacion(true)}
                    >
                      Buscar actualizaciones
                    </button>
                  </div>
                )}
                {actualizacion.fase === "error" && (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    {actualizacion.mensaje}
                  </p>
                )}
              </Section>
            </>
          )}
        </div>
      </main>
      {verAnimaciones && (
        <Animaciones onClose={() => setVerAnimaciones(false)} />
      )}
    </div>
  );
}
