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

function Section(props: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
      <h2 className="mb-1 text-sm font-semibold tracking-wide text-neutral-200">
        {props.title}
      </h2>
      {props.hint && <p className="mb-3 text-xs text-neutral-500">{props.hint}</p>}
      <div className={props.hint ? "" : "mt-3"}>{props.children}</div>
    </section>
  );
}

const selectCls =
  "rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 outline-none focus:border-emerald-500";
const inputCls =
  "rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 outline-none placeholder:text-neutral-500 focus:border-emerald-500";
const btnCls =
  "rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50";
const btnGhostCls =
  "rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800";

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
    <div className="min-h-screen bg-neutral-950 px-6 py-6 text-neutral-100">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <header className="mb-1 flex items-baseline justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Mike</h1>
            <p className="text-sm text-neutral-400">
              Dictado por voz local y gratuito — mantén{" "}
              <kbd className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs">
                {settings ? hotkeyLabel(settings.hotkey) : "Ctrl + Win"}
              </kbd>{" "}
              y habla; suelta para insertar el texto donde estés escribiendo.
            </p>
          </div>
        </header>

        <Section title="Modelo de voz local">
          {model?.state === "ready" && !downloading && (
            <p className="text-sm text-emerald-400">
              ✓ Parakeet V3 listo — todo se procesa en tu equipo, sin internet.
            </p>
          )}
          {downloading && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-neutral-300">
                Descargando modelo… {progress ? fmtBytes(progress.downloaded) : ""}
                {progress ? ` de ${fmtBytes(progress.total)}` : ""}
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-neutral-800">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
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
              <p className="flex-1 text-sm text-neutral-300">
                Falta el modelo Parakeet V3 ({fmtBytes(671_000_000)}, descarga única).
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
            <p className="mt-2 text-xs text-red-400">{modelError}</p>
          )}
        </Section>

        {settings && (
          <Section title="Ajustes">
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-neutral-400">Motor de transcripción</span>
                <select
                  className={selectCls}
                  value={settings.engine}
                  onChange={(e) =>
                    update({ engine: e.target.value as AppSettings["engine"] })
                  }
                >
                  <option value="parakeet">Local — Parakeet V3 (privado, gratis)</option>
                  <option value="groq" disabled={!hasKey}>
                    Cloud — Groq Whisper turbo {hasKey ? "" : "(requiere API key)"}
                  </option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="text-neutral-400">Limpieza del texto</span>
                <select
                  className={selectCls}
                  value={settings.polish}
                  onChange={(e) =>
                    update({ polish: e.target.value as AppSettings["polish"] })
                  }
                >
                  <option value="rules">Rápida local (muletillas + diccionario)</option>
                  <option value="groq_llm" disabled={!hasKey}>
                    IA — Groq Llama {hasKey ? "" : "(requiere API key)"}
                  </option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="text-neutral-400">Idioma del dictado</span>
                <select
                  className={selectCls}
                  value={settings.language}
                  onChange={(e) => update({ language: e.target.value })}
                >
                  <option value="auto">Detección automática</option>
                  <option value="es">Español</option>
                  <option value="en">English</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="text-neutral-400">Atajo push-to-talk</span>
                <span className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-neutral-300">
                  {hotkeyLabel(settings.hotkey)}{" "}
                  <span className="text-xs text-neutral-500">(personalizable pronto)</span>
                </span>
              </label>

              <label className="flex items-center gap-2 text-sm text-neutral-300">
                <input
                  type="checkbox"
                  checked={settings.hud_enabled}
                  onChange={(e) => update({ hud_enabled: e.target.checked })}
                  className="h-4 w-4 accent-emerald-500"
                />
                Mostrar indicador flotante al dictar
              </label>

              <label className="flex items-center gap-2 text-sm text-neutral-300">
                <input
                  type="checkbox"
                  checked={settings.autostart}
                  onChange={(e) => update({ autostart: e.target.checked })}
                  className="h-4 w-4 accent-emerald-500"
                />
                Iniciar con Windows
              </label>
            </div>
          </Section>
        )}

        <Section
          title="Groq (opcional)"
          hint="Con una API key gratuita de console.groq.com activas el motor cloud (más rápido) y la limpieza con IA. Si no, todo sigue funcionando 100% local. La key se guarda cifrada en el Administrador de credenciales de Windows."
        >
          {hasKey ? (
            <div className="flex items-center gap-3">
              <p className="flex-1 text-sm text-emerald-400">✓ API key guardada</p>
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

        <Section
          title="Diccionario personal"
          hint="Nombres propios, marcas o términos que Mike debe escribir exactamente así. Con reemplazo corrige transcripciones erróneas (p. ej. 'guisper' → 'Wispr')."
        >
          <div className="mb-3 flex gap-2">
            <input
              className={`${inputCls} flex-1`}
              placeholder="Término (p. ej. guisper)"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
            <input
              className={`${inputCls} flex-1`}
              placeholder="Reemplazo (opcional, p. ej. Wispr)"
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
            <p className="text-xs text-neutral-500">Aún no hay términos.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {dict.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between rounded-lg bg-neutral-900 px-3 py-1.5 text-sm"
                >
                  <span>
                    {d.term}
                    {d.replacement && (
                      <span className="text-neutral-400"> → {d.replacement}</span>
                    )}
                  </span>
                  <button
                    className="text-xs text-neutral-500 hover:text-red-400"
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
            <p className="text-xs text-neutral-500">
              Aquí aparecerá todo lo que dictes.
            </p>
          ) : (
            <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto pr-1">
              {history.map((h) => (
                <li
                  key={h.id}
                  className="group rounded-lg bg-neutral-900 px-3 py-2 text-sm"
                >
                  <p className="text-neutral-200">{h.polished}</p>
                  <div className="mt-1 flex items-center gap-3 text-[11px] text-neutral-500">
                    <span>{fmtDate(h.ts)}</span>
                    <span>{h.engine === "parakeet" ? "local" : h.engine}</span>
                    <span>{(h.duration_ms / 1000).toFixed(1)} s</span>
                    <button
                      className="ml-auto opacity-0 transition-opacity hover:text-neutral-200 group-hover:opacity-100"
                      onClick={() =>
                        navigator.clipboard.writeText(h.polished)
                      }
                    >
                      Copiar
                    </button>
                    <button
                      className="opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
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

        <footer className="pb-2 text-center text-[11px] text-neutral-600">
          Mike v0.1 — corre en tu equipo. Cierra esta ventana y sigo en la bandeja
          del sistema.
        </footer>
      </div>
    </div>
  );
}
