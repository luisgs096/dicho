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

const fieldCls =
  "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-sky-400";
const inputCls = `${fieldCls} placeholder:text-slate-400 dark:placeholder:text-slate-500`;
const btnCls =
  "rounded-xl bg-gradient-to-br from-blue-600 to-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40";
const btnGhostCls =
  "rounded-xl border border-slate-300 px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800";
const labelCls = "text-xs font-medium text-slate-500 dark:text-slate-400";

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [model, setModel] = useState<ModelStatus | null>(null);
  const [progress, setProgress] = useState<ModelProgress | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [search, setSearch] = useState("");
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

  return (
    <div className="min-h-screen bg-slate-100 px-6 py-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <header className="mb-1 flex items-end justify-between">
          <div>
            <h1 className="bg-gradient-to-br from-blue-600 to-sky-400 bg-clip-text text-3xl font-black tracking-tight text-transparent">
              Dicho
            </h1>
            <p className="mt-0.5 text-sm font-medium text-slate-500 dark:text-slate-400">
              Dicho y hecho. — mantén{" "}
              <kbd className="rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {settings ? hotkeyLabel(settings.hotkey) : "Ctrl + Win"}
              </kbd>{" "}
              y habla; suelta y el texto aparece donde estés escribiendo.
            </p>
          </div>
        </header>

        <Section title="Modelo de voz local">
          {model?.state === "ready" && !downloading && (
            <p className="flex items-center gap-2 text-sm text-blue-600 dark:text-sky-400">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-sky-400 text-[10px] font-bold text-white">
                ✓
              </span>
              Parakeet V3 listo — todo se procesa en tu equipo, sin internet.
            </p>
          )}
          {downloading && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Descargando modelo… {progress ? fmtBytes(progress.downloaded) : ""}
                {progress ? ` de ${fmtBytes(progress.total)}` : ""}
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-600 to-sky-400 transition-all"
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
                Falta el modelo Parakeet V3 ({fmtBytes(671_000_000)}, descarga
                única).
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

        {settings && (
          <Section title="Ajustes">
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <label className="flex flex-col gap-1.5">
                <span className={labelCls}>Motor de transcripción</span>
                <select
                  className={fieldCls}
                  value={settings.engine}
                  onChange={(e) =>
                    update({ engine: e.target.value as AppSettings["engine"] })
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
                  ¿Mezclas español e inglés en la misma frase? El motor local
                  elige un solo idioma por dictado; para spanglish fluido usa el
                  motor cloud (gratis con API key de Groq).
                </span>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className={labelCls}>Limpieza del texto</span>
                <select
                  className={fieldCls}
                  value={settings.polish}
                  onChange={(e) =>
                    update({ polish: e.target.value as AppSettings["polish"] })
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

              <label className="flex flex-col gap-1.5">
                <span className={labelCls}>Atajo push-to-talk</span>
                <span className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                  {hotkeyLabel(settings.hotkey)}{" "}
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    (personalizable pronto)
                  </span>
                </span>
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
        )}

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
                    if (settings) update({ engine: "parakeet", polish: "rules" });
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

        <Section
          title="Diccionario personal"
          hint="Nombres propios, marcas o términos que Dicho debe escribir exactamente así. Con reemplazo corrige transcripciones erróneas (p. ej. 'iPad' → 'setup' si siempre te lo confunde)."
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

        <Section title="Historial">
          <input
            className={`${inputCls} mb-3 w-full`}
            placeholder="Buscar en tus dictados…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              refreshHistory(e.target.value);
            }}
          />
          {history.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Aquí aparecerá todo lo que dictes.
            </p>
          ) : (
            <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto pr-1">
              {history.map((h) => (
                <li
                  key={h.id}
                  className="group rounded-xl bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60"
                >
                  <p className="text-slate-800 dark:text-slate-100">
                    {h.polished}
                  </p>
                  <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-400 dark:text-slate-500">
                    <span>{fmtDate(h.ts)}</span>
                    <span>{h.engine === "parakeet" ? "local" : h.engine}</span>
                    <span>{(h.duration_ms / 1000).toFixed(1)} s</span>
                    <button
                      className="ml-auto opacity-0 transition-opacity hover:text-blue-600 group-hover:opacity-100 dark:hover:text-sky-400"
                      onClick={() => navigator.clipboard.writeText(h.polished)}
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

        <footer className="pb-2 text-center text-[11px] text-slate-400 dark:text-slate-600">
          Dicho v0.1 — corre en tu equipo. Cierra esta ventana y sigo en la
          bandeja del sistema.
        </footer>
      </div>
    </div>
  );
}
