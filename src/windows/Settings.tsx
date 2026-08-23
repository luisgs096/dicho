import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AppSettings,
  DictItem,
  HistoryItem,
  ModelProgress,
  ModelStatus,
} from "../types";
import { hotkeyLabel } from "../types";

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
const kbdCls =
  "rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300";

const TAB_META: Record<Tab, { title: string; desc: string }> = {
  perfil: {
    title: "Perfil",
    desc: "Tu forma de dictar: motores de voz y cuenta opcional de Groq.",
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
    desc: "Preferencias de dictado y comportamiento en el sistema.",
  },
};

export default function Settings() {
  const [tab, setTab] = useState<Tab>("perfil");
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

  const refreshHistory = useCallback((q: string) => {
    invoke<HistoryItem[]>("get_history", { search: q || null, limit: 100 })
      .then(setHistory)
      .catch(console.error);
  }, []);

  const refreshDict = useCallback(() => {
    invoke<DictItem[]>("dict_list").then(setDict).catch(console.error);
  }, []);

  useEffect(() => {
    invoke<AppSettings>("get_settings").then(setSettings).catch(console.error);
    invoke<ModelStatus>("model_status").then(setModel).catch(console.error);
    invoke<boolean>("has_groq_key").then(setHasKey).catch(console.error);
    refreshHistory("");
    refreshDict();

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
    return () => {
      unProgress.then((f) => f());
      unHistory.then((f) => f());
    };
  }, [refreshHistory, refreshDict]);

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
              <Section title="Cómo dictar">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Mantén{" "}
                  <kbd className={kbdCls}>
                    {settings ? hotkeyLabel(settings.hotkey) : "Ctrl + Win"}
                  </kbd>{" "}
                  y habla; suelta y el texto aparece donde estés escribiendo.
                </p>
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

                  <label className="flex flex-col gap-1.5">
                    <span className={labelCls}>Idioma del dictado</span>
                    <select
                      className={fieldCls}
                      value={settings.language}
                      onChange={(e) => update({ language: e.target.value })}
                    >
                      <option value="auto">Detección automática</option>
                      <option value="es">Español</option>
                      <option value="en">English</option>
                    </select>
                  </label>
                </div>
              </Section>

              <Section title="Sistema">
                <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                  <label className="flex flex-col gap-1.5">
                    <span className={labelCls}>Atajo push-to-talk</span>
                    <span className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                      {hotkeyLabel(settings.hotkey)}{" "}
                      <span className="text-xs text-slate-400 dark:text-slate-500">
                        (personalizable pronto)
                      </span>
                    </span>
                  </label>

                  <div className="flex flex-col justify-center gap-3">
                    <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={settings.hud_enabled}
                        onChange={(e) =>
                          update({ hud_enabled: e.target.checked })
                        }
                        className="h-4 w-4 accent-blue-600"
                      />
                      Mostrar la onda flotante al dictar
                    </label>

                    <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={settings.autostart}
                        onChange={(e) =>
                          update({ autostart: e.target.checked })
                        }
                        className="h-4 w-4 accent-blue-600"
                      />
                      Iniciar con Windows
                    </label>
                  </div>
                </div>
              </Section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
