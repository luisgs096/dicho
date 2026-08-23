export type EngineKind = "parakeet" | "groq";
export type PolishKind = "rules" | "groq_llm";

export interface AppSettings {
  hotkey: string[];
  engine: EngineKind;
  polish: PolishKind;
  language: string;
  hud_enabled: boolean;
  autostart: boolean;
}

export type ModelStatus =
  | { state: "ready" }
  | { state: "missing"; downloaded: number; total: number }
  | { state: "downloading" };

export interface ModelProgress {
  file: string;
  downloaded: number;
  total: number;
  done: boolean;
  error: string | null;
}

export type RecordingState =
  | { state: "idle" }
  | { state: "recording" }
  | { state: "processing" }
  | { state: "done"; text: string }
  | { state: "error"; message: string };

/** Corrección del diccionario aplicada a un dictado. */
export interface Correction {
  term: string;
  replacement: string;
  count: number;
}

export interface HistoryItem {
  id: number;
  ts: number;
  raw: string;
  polished: string;
  engine: string;
  duration_ms: number;
  corrections: Correction[];
}

export interface DictItem {
  id: number;
  term: string;
  replacement: string | null;
}

/** Nombres legibles de las teclas rdev que usamos en la combinación. */
export const KEY_LABELS: Record<string, string> = {
  ControlLeft: "Ctrl",
  ControlRight: "Ctrl Der",
  MetaLeft: "Win",
  MetaRight: "Win Der",
  Alt: "Alt",
  AltGr: "AltGr",
  ShiftLeft: "Shift",
  ShiftRight: "Shift Der",
  Space: "Espacio",
};

export function hotkeyLabel(keys: string[]): string {
  return keys.map((k) => KEY_LABELS[k] ?? k).join(" + ");
}
