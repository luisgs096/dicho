export type EngineKind = "parakeet" | "groq";
export type PolishKind = "rules" | "groq_llm";
export type HudStyle = "tamagotchi" | "classic";

export interface AppSettings {
  hotkey: string[];
  engine: EngineKind;
  polish: PolishKind;
  language: string;
  hud_enabled: boolean;
  hud_style: HudStyle;
  autostart: boolean;
  google_client_id: string;
  google_client_secret: string;
}

export interface GoogleStatus {
  configured: boolean;
  email: string | null;
  last_sync_ms: number | null;
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
  /** Hubo grabación pero no se entendió nada. */
  | { state: "empty" }
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
  Escape: "Esc",
  Tab: "Tab",
  CapsLock: "Bloq Mayús",
  Return: "Entrar",
  Backspace: "Retroceso",
  BackQuote: "`",
  Minus: "-",
  Equal: "=",
  LeftBracket: "[",
  RightBracket: "]",
  BackSlash: "\\",
  SemiColon: ";",
  Quote: "'",
  Comma: ",",
  Dot: ".",
  Slash: "/",
  Insert: "Insert",
  Delete: "Supr",
  Home: "Inicio",
  End: "Fin",
  PageUp: "Re Pág",
  PageDown: "Av Pág",
  UpArrow: "↑",
  DownArrow: "↓",
  LeftArrow: "←",
  RightArrow: "→",
  NumLock: "Bloq Num",
  KpReturn: "Entrar (num)",
  KpMinus: "− (num)",
  KpPlus: "+ (num)",
  KpMultiply: "× (num)",
  KpDivide: "÷ (num)",
  KpDelete: ". (num)",
};

/** Nombre legible de una tecla rdev individual. */
export function keyLabel(key: string): string {
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  if (/^Key[A-Z]$/.test(key)) return key.slice(3);
  if (/^Num\d$/.test(key)) return key.slice(3);
  if (/^Kp\d$/.test(key)) return `${key.slice(2)} (num)`;
  return key;
}

export function hotkeyLabel(keys: string[]): string {
  return keys.map(keyLabel).join(" + ");
}
