export type EngineKind = "parakeet" | "groq";
export type PolishKind = "rules" | "groq_llm" | "groq_estructurado";
export type HudStyle = "tamagotchi" | "classic";

/** Dónde quedó el HUD, en fracción del hueco libre de la pantalla (0-1). */
export interface HudPos {
  fx: number;
  fy: number;
}

export interface AppSettings {
  hotkey: string[];
  /** Tecla para cancelar a media grabación. `null` la desactiva. */
  cancelar: string | null;
  /** Atajo para corregir lo que tengas seleccionado. Vacío = apagado. */
  corregir_atajo: string[];
  engine: EngineKind;
  polish: PolishKind;
  language: string;
  no_traducir: boolean;
  /** Deja el dictado en el portapapeles al terminar, para volver a pegarlo. */
  copiar_al_portapapeles: boolean;
  /** Ids de las secciones plegadas (se guardan las cerradas, no las abiertas). */
  secciones_plegadas: string[];
  corregir_al_escribir: boolean;
  apps_sin_correccion: string[];
  hud_enabled: boolean;
  hud_style: HudStyle;
  /** Un rincón por pantalla, por tamaño del área de trabajo ("3840x2040"). */
  hud_posiciones: Record<string, HudPos>;
  hud_arrastrable: boolean;
  /** La cinta de niveles debajo de la onda. */
  hud_niveles: boolean;
  /** Clavada: la onda se queda a la vista siempre, no sólo mientras dictas. */
  hud_pin: boolean;
  /** Lo transparente que se pone clavada y en reposo. 1 = opaca. */
  hud_opacidad_reposo: number;
  /** Con qué versión arrancó la última vez; así se sabe si acabas de actualizar. */
  ultima_version_vista: string;
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
  | { state: "recording"; max_seconds?: number }
  | { state: "processing"; motivo?: string }
  | { state: "done"; text: string }
  /** Hubo grabación pero no se entendió nada. */
  | { state: "empty" }
  /** Te arrepentiste a media frase: el audio se tiró sin transcribir. */
  | { state: "cancelado" }
  /** Corrigiendo un texto que ya estaba escrito: la onda se pone en modo
   *  lectura —pluma y pergamino— porque no está escuchando nada. */
  | { state: "corrigiendo" }
  /** Primer arranque tras actualizar: la carita lo celebra una vez. */
  | { state: "actualizado"; version: string }
  | { state: "error"; message: string };

/** Corrección del diccionario en un dictado. */
export interface Correction {
  term: string;
  replacement: string;
  /** Cuántas veces hacía falta corregir, contadas sobre el texto crudo. */
  count: number;
  /** Cuántas llegaron de verdad al texto final. Con 0, el modelo la ignoró. */
  aplicadas: number;
}

export interface HistoryItem {
  id: number;
  ts: number;
  raw: string;
  polished: string;
  engine: string;
  /** Cuánto hablaste, no cuánto tardó en procesarse. */
  duration_ms: number;
  corrections: Correction[];
  /** "reglas" | "estandar" | "editor". Ausente en los dictados anteriores a la
   *  0.11: no se guardaba y no hay de dónde deducirlo. */
  polish_mode: string | null;
  stt_ms: number | null;
  polish_ms: number | null;
}

/** Listas con las que se analiza un dictado, servidas por Rust (ver
 *  `listas_analisis`) para no duplicarlas aquí. */
export interface ListasAnalisis {
  muletillas: string[];
  anglicismos: string[];
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
  IntlBackslash: "< >",
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
