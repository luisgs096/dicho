import { useCallback, useEffect, useState } from "react";
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
import { hotkeyLabel, keyLabel } from "../types";
import Animaciones from "./Animaciones";

type Tab = "perfil" | "diccionario" | "historial" | "ajustes";

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

function UserIcon() {
  return (
    <svg {...iconProps}>
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="7" r="4" />
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

function NavItem(props: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
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

const TAB_META: Record<Tab, { title: string; desc: string }> = {
  perfil: {
    title: "Perfil",
    desc: "Tu cuenta para sincronizar entre dispositivos y tu atajo de dictado.",
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
    desc: "Motores de voz, limpieza del texto y comportamiento en el sistema.",
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
  const [tab, setTab] = useState<Tab>("perfil");
  const [verAnimaciones, setVerAnimaciones] = useState(false);
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
      <aside className="flex w-52 shrink-0 flex-col border-r border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="px-3 text-2xl font-black tracking-tight text-blue-600 dark:text-sky-400">
          Dicho
        </h1>
        <p className="mb-5 px-3 text-[11px] font-medium text-slate-400 dark:text-slate-500">
          Dicho y hecho.
        </p>
        <nav className="flex flex-1 flex-col gap-1">
          <NavItem
            active={tab === "perfil"}
            onClick={() => setTab("perfil")}
            icon={<UserIcon />}
            label="Perfil"
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
            />
          </div>
        </nav>
        <p className="mt-3 px-3 text-[10px] text-slate-400 dark:text-slate-600">
          v0.1 — corre en tu equipo
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

          {tab === "perfil" && (
            <>
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
                        <button
                          className="ml-auto opacity-0 transition-opacity hover:text-blue-600 group-hover:opacity-100 dark:hover:text-sky-400"
                          onClick={() =>
                            navigator.clipboard.writeText(h.polished)
                          }
                        >
                          Copiar
                        </button>
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

                  <label className="flex flex-col gap-1.5">
                    <span className={labelCls}>Limpieza del texto</span>
                    <select
                      className={fieldCls}
                      value={settings.polish}
                      onChange={(e) =>
                        update({
                          polish: e.target.value as AppSettings["polish"],
                        })
                      }
                    >
                      <option value="rules">
                        Rápida local (muletillas + diccionario)
                      </option>
                      <option value="groq_llm" disabled={!hasKey}>
                        IA — Groq Llama {hasKey ? "" : "(requiere API key)"}
                      </option>
                    </select>
                  </label>

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
                title="Groq (opcional)"
                hint="Con una API key gratuita de console.groq.com activas el motor cloud (más rápido y mejor con spanglish) y la limpieza con IA. Sin key, todo sigue funcionando 100% local. La key se guarda cifrada en el Administrador de credenciales de Windows."
              >
                {hasKey ? (
                  <div className="flex items-center gap-3">
                    <p className="flex-1 text-sm text-blue-600 dark:text-sky-400">
                      ✓ API key guardada
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
                      Quitar
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="password"
                      className={`${inputCls} flex-1`}
                      placeholder="gsk_..."
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
                          })
                          .catch((e) => alert(String(e)))
                      }
                    >
                      Guardar
                    </button>
                  </div>
                )}
              </Section>

              <Section title="Sistema">
                <div className="flex flex-col gap-3">
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    El atajo de dictado ({hotkeyLabel(settings.hotkey)}) se
                    cambia en la pestaña Perfil.
                  </p>
                  <label className="flex max-w-xs flex-col gap-1.5">
                    <span className={labelCls}>Estilo de la onda flotante</span>
                    <select
                      className={fieldCls}
                      value={settings.hud_style}
                      onChange={(e) =>
                        update({
                          hud_style: e.target.value as AppSettings["hud_style"],
                        })
                      }
                    >
                      <option value="tamagotchi">
                        Caritas tamagotchi (5 por estado, al azar)
                      </option>
                      <option value="classic">
                        Clásico — barras que crecen con tu voz
                      </option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={settings.hud_enabled}
                      onChange={(e) => update({ hud_enabled: e.target.checked })}
                      className="h-4 w-4 accent-blue-600"
                    />
                    Mostrar la onda flotante al dictar
                  </label>
                  {settings.hud_enabled && (
                    <button
                      className={`${btnGhostCls} self-start`}
                      onClick={() => setVerAnimaciones(true)}
                    >
                      Ver animaciones
                    </button>
                  )}

                  <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={settings.autostart}
                      onChange={(e) => update({ autostart: e.target.checked })}
                      className="h-4 w-4 accent-blue-600"
                    />
                    Iniciar con Windows
                  </label>
                </div>
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
