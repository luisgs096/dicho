import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { RecordingState } from "../types";

function hudLog(msg: string) {
  invoke("hud_log", { msg }).catch(() => {});
}

// ─── paletas del tamagotchi (mismos colores de Dicho) ───────────────────────
const LIGHT = {
  a: "#2563eb", m: "#17b394", p: "#f06ea9", w: "#ea7317",
  face: "#33415c", faint: "#8296b2",
  lcd: "#d7e1f0", lcdBorder: "#bfcde2", grid: "rgba(51,65,92,.07)",
  shellA: "#cdd7e6", shellB: "#aab9d0",
  warnLcd: "#f7e3cd", warnBorder: "#ecc9a0",
};
const DARK = {
  a: "#38bdf8", m: "#2dd4b4", p: "#f472b6", w: "#fb923c",
  face: "#dbe6f6", faint: "#5c6f8f",
  lcd: "#0a1322", lcdBorder: "#223052", grid: "rgba(219,230,246,.05)",
  shellA: "#263450", shellB: "#16223a",
  warnLcd: "#2b1d0e", warnBorder: "#4a3520",
};

// ─── mini-motor de sprites (idéntico a los mockups aprobados) ───────────────
const PAL: Record<string, string> = {
  X: "currentColor", a: "var(--a)", m: "var(--m)", p: "var(--p)", w: "var(--w)", s: "#38bdf8",
};
function spr(map: string[], ox = 0, oy = 0): string {
  let out = "";
  map.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      if (PAL[c])
        out += `<rect x="${x + ox}" y="${y + oy}" width="1" height="1" fill="${PAL[c]}"/>`;
    }
  });
  return out;
}

const EY = ["XXX", "XXX", "XXX", "XXX"];
const EYS = ["XXX"];
const EYH = [".XX.", "X..X"];
const SOCK = ["XXXXX", "X...X", "X...X", "X...X", "XXXXX"];
const PUP = ["XX", "XX"];
const SMILE = ["X......X", ".XXXXXX."];
const GRIN = [".XXXXXX.", "X......X", ".XXXXXX."];
const OSM = ["XX", "XX"];
const OBIG = [".XXX.", "X...X", "X...X", ".XXX."];
const FLAT = ["XXXXXX"];
const ZIG = ["XX..XX..XX", "..XX..XX.."];
const R_EYE = 28;

const eyesAt = (m: string[], y = 5) => spr(m, 15, y) + spr(m, 28, y);

const P = {
  nota: ["...a", "...a", "...a", "aaa.", "aaa."],
  gota: ["..s..", "..s..", ".sss.", "sssss", ".sss."],
  bomba: [".pppp.", "pp.ppp", "pppppp", "pppppp", "pppppp", ".pppp."],
  remo: [".X.", "XXX", ".X."],
  burpN: [".mm.", "mmmm", ".mm."],
  lentes: ["XXXXXXXXXXXXXXXX", "..XXXXX..XXXXX..", "..XXXXX..XXXXX.."],
  interr: ["wwww", "...w", "..ww", ".w..", "....", ".w.."],
  cachp: ["pp", "pp"],
  puntos: ["X.X.X"],
  maraca: ["mmm", "mmm", "mmm", ".X.", ".X."],
  pulgar: ["..a.", ".aa.", "aaaa", "aaaa", ".aa."],
  chispa: [".m.", "mmm", ".m."],
  miga: ["a"],
  zeta: ["XXX", ".X.", "XXX"],
  zetaS: ["XX", "XX"],
  mosca: [".m.", "mmm", ".m."],
  oreja: ["..XX", ".X..", "X...", "X...", ".X..", "..XX"],
  lapiz: ["..a", ".aa", "aa."],
  engra: ["..X..", ".XXX.", "XX.XX", ".XXX.", "..X.."],
  foco: [".www.", "w...w", "w...w", ".www.", "..X..", "..X.."],
  lupaP: [".aaa.", "a...a", "a...a", ".aaa.", "...aa", "....a"],
  ruido: ["X..X...X..X", "..X...X....", "X...X....X.", ".X.....X..X"],
  ruido2: [".X...X..X..", "X..X.....X.", "..X..X.X...", "X....X...X."],
};

const frames = (list: string[], dur: string) =>
  `<g class="frames frames${list.length}" style="--d:${dur}">` +
  list.map((h) => `<g>${h}</g>`).join("") + `</g>`;

// ─── 25 variaciones: 5 por estado ───────────────────────────────────────────
interface Variant {
  status: string;
  scene: string;
  sad?: boolean;
  shake?: boolean;
}
type FaceState = "reposo" | "escuchando" | "pensando" | "listo" | "no-entendi";

const V: Record<FaceState, Variant[]> = {
  reposo: [
    { status: "Dicho",
      scene: `<g class="a-bob">${eyesAt(EYH, 6)}${frames([spr(OSM, 21, 12), spr(OBIG, 20, 11)], ".9s")}</g>
        <g class="a-notes1">${spr(P.nota, 36, 8)}</g><g class="a-notes2">${spr(P.nota, 41, 11)}</g>` },
    { status: "Dicho",
      scene: `${frames([eyesAt(EY) + spr(FLAT, 19, 13), eyesAt(EYS, 7) + spr(FLAT, 19, 14)], ".6s")}
        <g class="a-bubble">${spr(P.bomba, 27, 11)}</g>` },
    { status: "Dicho",
      scene: `${spr(SOCK, 14, 4)}${spr(SOCK, 27, 4)}<g class="a-wander">${spr(PUP, 15.5, 5.5)}${spr(PUP, 28.5, 5.5)}</g>${spr(SMILE, 19, 12)}` },
    { status: "Zzz…",
      scene: `<g class="a-bob" style="animation-duration:3s">${eyesAt(EYS, 7)}${spr(OSM, 21, 12)}</g>
        <g class="a-zzz1">${spr(P.zeta, 36, 7)}</g><g class="a-zzz2">${spr(P.zetaS, 41, 10)}</g>` },
    { status: "Dicho",
      scene: `${spr(SOCK, 14, 4)}${spr(SOCK, 27, 4)}<g class="a-chase">${spr(PUP, 15.5, 5.5)}${spr(PUP, 28.5, 5.5)}</g>
        ${spr(SMILE, 19, 12)}<g class="a-fly">${spr(P.mosca, 38, 9)}</g>` },
  ],
  escuchando: [
    { status: "Te escucho",
      scene: `${eyesAt(EY)}${frames([spr(GRIN, 18, 11), spr(["XXXXXXXX"], 18, 13), spr(OBIG, 20, 11)], ".55s")}
        <g class="a-crumb1">${spr(P.miga, 10, 13)}</g><g class="a-crumb2">${spr(P.miga, 8, 15)}</g><g class="a-crumb3">${spr(P.miga, 9, 11)}</g>` },
    { status: "Te escucho",
      scene: `${eyesAt(EYS, 7)}${spr(OSM, 21, 12)}<g class="a-ear">${spr(P.oreja, 38, 5)}</g>` },
    { status: "Ajá, sigue…",
      scene: `${frames([eyesAt(EY, 4) + spr(SMILE, 19, 11), eyesAt(EY, 6) + spr(SMILE, 19, 13)], ".65s")}
        <g class="a-sparkle1">${spr(P.chispa, 37, 6)}</g><g class="a-sparkle2">${spr(P.chispa, 41, 12)}</g>` },
    { status: "Te escucho",
      scene: `${spr(["XXXX"], 14, 2)}${spr(["XXXX"], 28, 2)}
        ${frames([eyesAt(EY), spr(["XXXX", "XXXX", "XXXX", "XXXX", "XXXX"], 14, 4) + spr(["XXXX", "XXXX", "XXXX", "XXXX", "XXXX"], 27, 4)], ".8s")}
        ${spr(OSM, 21, 13)}` },
    { status: "Anotando…",
      scene: `${eyesAt(EY, 6)}${spr(FLAT, 19, 13)}
        <g class="a-pencil">${spr(P.lapiz, 38, 11)}</g>
        <g class="a-writeline"><rect x="33" y="15" width="10" height="1" fill="var(--a)"/></g>` },
  ],
  pensando: [
    { status: "Escribiendo…",
      scene: `${spr(SOCK, 14, 4)}${spr(SOCK, 27, 4)}
        <g class="a-spin">${spr(P.remo, 15, 5)}</g><g class="a-spin" style="animation-delay:.14s">${spr(P.remo, 28, 5)}</g>
        ${spr(["XXX.....", "...XXX.."], 19, 13)}` },
    { status: "Escribiendo…",
      scene: `${eyesAt(EY, 4)}${spr(FLAT, 19, 13)}
        <g class="a-gear1">${spr(P.engra, 34, 2)}</g><g class="a-gear2">${spr(P.engra.map((r) => r.replace(/X/g, "m")), 40, 5)}</g>` },
    { status: "Escribiendo…",
      scene: `${eyesAt(EYS, 8)}${spr(OSM, 21, 12)}
        ${frames([spr(["XXX"], 16, 17), spr(["XXX"], 27, 17)], ".3s")}` },
    { status: "Escribiendo…",
      scene: `${frames([eyesAt(EY), eyesAt(["XXX", "XXX"], 6)], "1.1s")}${spr(FLAT, 19, 13)}
        <g class="a-bulb">${spr(P.foco, 37, 2)}</g>` },
    { status: "Escribiendo…",
      scene: `${frames([spr(["XXXX"], 14, 2) + spr(["XXXX"], 28, 2), spr([".XXX"], 14, 3) + spr(["XXX."], 28, 3)], "1s")}
        ${eyesAt(EY)}${spr(FLAT, 19, 13)}
        <g class="a-dot1">${spr(["XX", "XX"], 36, 9)}</g><g class="a-dot2">${spr(["XX", "XX"], 40, 9)}</g><g class="a-dot3">${spr(["XX", "XX"], 44, 9)}</g>` },
  ],
  listo: [
    { status: "¡Listo!",
      scene: `<g class="a-spin">${spr(P.chispa, 14, 4)}</g><g class="a-spin" style="animation-delay:.2s">${spr(P.chispa, 28, 4)}</g>
        ${frames([spr(SMILE, 19, 12), spr(GRIN, 18, 11)], ".5s")}
        <g class="a-confetti">${[["p", "-9px", "-7px"], ["m", "9px", "-8px"], ["a", "-11px", "2px"], ["p", "11px", "3px"], ["m", "-4px", "-10px"], ["a", "5px", "-11px"]]
          .map(([c, x, y]) => `<rect x="23" y="9" width="1.4" height="1.4" fill="${PAL[c]}" style="--cx:${x}; --cy:${y}"/>`).join("")}</g>` },
    { status: "¡Listo!",
      scene: `${frames([eyesAt(EYS, 7) + spr(["XX........XX"], 13, 10) + spr(FLAT, 19, 13), eyesAt(EY) + spr(OBIG, 20, 11), eyesAt(EYH, 6) + spr(SMILE, 19, 12)], "3.6s")}
        <g class="a-burp">${spr(P.burpN, 34, 7)}</g>` },
    { status: "¡Listo!",
      scene: `${eyesAt(EY)}<g class="a-glasses">${spr(P.lentes, 14, 4)}</g>
        ${spr(["XXXXXX..", "......XX"], 19, 12)}` },
    { status: "¡Órale!",
      scene: `<g class="a-dance">${eyesAt(EYH, 6)}${spr(GRIN, 18, 11)}</g>
        <g class="a-maraca1">${spr(P.maraca, 8, 7)}</g><g class="a-maraca2">${spr(P.maraca, 37, 9)}</g>` },
    { status: "Got it!",
      scene: `${frames([eyesAt(EY), spr(["XXXX"], 14, 6) + spr(EY, R_EYE, 5)], "1.4s")}
        ${spr(["XXXXXX..", "......XX"], 19, 12)}
        <g class="a-thumb">${spr(P.pulgar, 38, 8)}</g>` },
  ],
  "no-entendi": [
    { status: "No escuché nada, lo siento", sad: true, shake: true,
      scene: `${spr(["XX..", "..XX"], 13, 2)}${spr(["..XX", "XX.."], 29, 2)}
        <g class="a-tremble">${eyesAt(EY)}</g>${spr(ZIG, 18, 13)}
        <g class="a-dropfall">${spr(P.gota, 36, 3)}</g>` },
    { status: "¿Me repites?", sad: true,
      scene: `<g class="a-tilt">${spr(["XXXX", "XXXX", "XXXX", "XXXX"], 14, 4)}${spr(PUP, 28, 6)}${spr(OSM, 21, 13)}</g>
        <g class="a-qpop">${spr(P.interr, 38, 3)}</g>` },
    { status: "Perdón…", sad: true,
      scene: `${eyesAt(["XX", "XX"], 7)}<g class="a-blush">${spr(P.cachp, 12, 9)}${spr(P.cachp, 32, 9)}</g>
        ${spr(["XXXX"], 20, 13)}<g class="a-sorry">${spr(P.puntos, 37, 6)}</g>` },
    { status: "Señal perdida", sad: true,
      scene: `${eyesAt(EY)}${spr(FLAT, 19, 13)}
        <g opacity=".55">${frames([spr(P.ruido, 33, 3) + spr(P.ruido2, 34, 12), spr(P.ruido2, 33, 3) + spr(P.ruido, 34, 12)], ".2s")}</g>` },
    { status: "¿Y tu voz?", sad: true,
      scene: `${spr(SOCK, 14, 4)}${spr(SOCK, 27, 4)}
        <g class="a-chase" style="animation-duration:3.2s">${spr(PUP, 15.5, 5.5)}${spr(PUP, 28.5, 5.5)}</g>
        ${spr(OSM, 21, 13)}<g class="a-lupa">${spr(P.lupaP, 40, 5)}</g>` },
  ],
};

const MIC_SVG = `<svg viewBox="0 0 7 13">${spr([".aaa.", "aaaaa", "a.a.a", "aaaaa", "a.a.a", "aaaaa", ".aaa.", "..a..", "..a..", ".aaa."], 1, 1)}</svg>`;

/// Heurística ligera para la reacción por idioma del estado "listo".
function detectLang(text: string): "es" | "en" | null {
  const t = ` ${text.toLowerCase()} `;
  if (/[áéíóúñ¿¡]/.test(t)) return "es";
  const es = (t.match(/ (el|la|los|las|que|de|en|un|una|para|con|por|esta|pero|como) /g) || []).length;
  const en = (t.match(/ (the|and|is|are|to|of|in|that|it|for|with|this|was) /g) || []).length;
  if (es >= 2 && es > en) return "es";
  if (en >= 2 && en > es) return "en";
  return null;
}

function pick(state: FaceState, text?: string): number {
  if (state === "listo") {
    const lang = detectLang(text ?? "");
    const pool = lang === "es" ? [0, 1, 2, 3] : lang === "en" ? [0, 1, 2, 4] : [0, 1, 2];
    return pool[Math.floor(Math.random() * pool.length)];
  }
  return Math.floor(Math.random() * V[state].length);
}

const stateFor = (rec: RecordingState): FaceState => {
  switch (rec.state) {
    case "recording": return "escuchando";
    case "processing": return "pensando";
    case "done": return "listo";
    case "empty": return "no-entendi";
    default: return "reposo";
  }
};

const CSS = `
  .tama { width: 336px; height: 64px; border-radius: 999px; padding: 5px;
          background: linear-gradient(180deg, var(--shellA), var(--shellB));
          box-shadow: 0 18px 40px -18px rgba(10, 25, 60, .45), inset 0 1px 0 rgba(255,255,255,.35); }
  .screen { height: 100%; border-radius: 999px; background: var(--lcd);
            border: 1px solid var(--lcdBorder);
            box-shadow: inset 0 3px 10px rgba(10, 20, 40, .25);
            overflow: hidden; position: relative; color: var(--face);
            display: flex; align-items: center; gap: 8px; padding: 0 16px 0 14px;
            transition: background .25s; }
  .screen::before { content: ""; position: absolute; inset: 0; pointer-events: none;
    background-image: linear-gradient(var(--grid) 1px, transparent 1px),
                      linear-gradient(90deg, var(--grid) 1px, transparent 1px);
    background-size: 3px 3px; }
  .mic-px { flex-shrink: 0; height: 32px; }
  .mic-px svg { height: 100%; width: auto; shape-rendering: crispEdges; display: block; }
  .scene { flex: 1; height: 44px; min-width: 0; }
  .scene svg { width: 100%; height: 100%; shape-rendering: crispEdges; overflow: visible; display: block; }
  .status { flex-shrink: 0; max-width: 96px; text-align: right;
            font: 700 8.5px/1.3 Consolas, "Cascadia Mono", monospace;
            letter-spacing: .08em; text-transform: uppercase; color: var(--faint);
            overflow: hidden; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; }
  .status.texto { text-transform: none; letter-spacing: 0; font-weight: 600; font-size: 9.5px; }
  .tama.sad .screen { background: var(--warnLcd); border-color: var(--warnBorder); color: var(--w); }
  .tama.sad .status { color: var(--w); }
  .tama.shake { animation: shake .55s ease-in-out; }

  .frames > g { opacity: 0; }
  .frames2 > g:nth-child(1) { animation: f2a var(--d, .8s) linear infinite; }
  .frames2 > g:nth-child(2) { animation: f2b var(--d, .8s) linear infinite; }
  @keyframes f2a { 0%, 49.9% { opacity: 1; } 50%, 100% { opacity: 0; } }
  @keyframes f2b { 0%, 49.9% { opacity: 0; } 50%, 100% { opacity: 1; } }
  .frames3 > g:nth-child(1) { animation: f3a var(--d, .9s) linear infinite; }
  .frames3 > g:nth-child(2) { animation: f3b var(--d, .9s) linear infinite; }
  .frames3 > g:nth-child(3) { animation: f3c var(--d, .9s) linear infinite; }
  @keyframes f3a { 0%, 33.2% { opacity: 1; } 33.3%, 100% { opacity: 0; } }
  @keyframes f3b { 0%, 33.2% { opacity: 0; } 33.3%, 66.5% { opacity: 1; } 66.6%, 100% { opacity: 0; } }
  @keyframes f3c { 0%, 66.5% { opacity: 0; } 66.6%, 100% { opacity: 1; } }

  @keyframes shake { 0%, 100% { transform: translateX(0); }
    15% { transform: translateX(-5px); } 30% { transform: translateX(4px); }
    45% { transform: translateX(-3px); } 60% { transform: translateX(2px); } 75% { transform: translateX(-1px); } }
  @keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-1px); } }
  @keyframes notes { 0% { transform: translate(0, 2px); opacity: 0; } 20% { opacity: 1; }
                     100% { transform: translate(3px, -8px); opacity: 0; } }
  @keyframes bubble { 0%, 52% { transform: scale(0); opacity: 0; } 62% { transform: scale(.5); opacity: 1; }
                      78% { transform: scale(1); } 83% { transform: scale(1.18); }
                      85%, 100% { transform: scale(0); opacity: 0; } }
  @keyframes wander { 0%, 22% { transform: translate(0, 0); } 30%, 45% { transform: translate(-1.7px, .4px); }
                      55%, 72% { transform: translate(1.7px, -.3px); } 80%, 100% { transform: translate(0, 0); } }
  @keyframes zzz { 0% { transform: translate(0, 2px); opacity: 0; } 25% { opacity: 1; }
                   100% { transform: translate(4px, -9px); opacity: 0; } }
  @keyframes fly { 0%, 100% { transform: translate(0, 0); } 25% { transform: translate(10px, -5px); }
                   50% { transform: translate(3px, -9px); } 75% { transform: translate(-7px, -3px); } }
  @keyframes chase { 0%, 100% { transform: translate(0, 0); } 25% { transform: translate(1.4px, -.7px); }
                     50% { transform: translate(.4px, -1.2px); } 75% { transform: translate(-1px, -.4px); } }
  @keyframes crumbs { 0% { transform: translate(-13px, -1px); opacity: 0; } 22% { opacity: 1; }
                      85% { transform: translate(0, 0); opacity: 1; } 100% { transform: translate(1px, 1px); opacity: 0; } }
  @keyframes earpulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.18); } }
  @keyframes pencil { 0%, 100% { transform: translate(0, 0) rotate(0deg); } 50% { transform: translate(2px, .5px) rotate(7deg); } }
  @keyframes writeline { 0% { transform: scaleX(.08); } 88% { transform: scaleX(1); } 100% { transform: scaleX(.08); } }
  @keyframes spin4 { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @keyframes spinback { from { transform: rotate(360deg); } to { transform: rotate(0deg); } }
  @keyframes bulb { 0%, 38%, 100% { opacity: .12; } 48%, 90% { opacity: 1; } }
  @keyframes dots3 { 0%, 100% { opacity: .15; } 30% { opacity: 1; } }
  @keyframes confetti { 0%, 10% { transform: translate(0, 0); opacity: 0; } 16% { opacity: 1; }
                        55% { opacity: 1; } 72%, 100% { transform: translate(var(--cx), var(--cy)); opacity: 0; } }
  @keyframes burp { 0%, 38% { transform: translate(0, 0) scale(0); opacity: 0; }
                    46% { transform: translate(1px, -2px) scale(.7); opacity: 1; }
                    64% { transform: translate(3px, -6px) scale(1.1); opacity: .9; }
                    80%, 100% { transform: translate(5px, -10px) scale(1.25); opacity: 0; } }
  @keyframes glasses { 0%, 8% { transform: translateY(-14px); opacity: 0; } 14% { opacity: 1; }
                       28% { transform: translateY(1px); } 34%, 94% { transform: translateY(0); opacity: 1; }
                       100% { transform: translateY(0); opacity: 0; } }
  @keyframes tilt { 0%, 12% { transform: rotate(0deg); } 26%, 80% { transform: rotate(8deg); } 94%, 100% { transform: rotate(0deg); } }
  @keyframes qpop { 0%, 20% { transform: scale(0); opacity: 0; } 32% { transform: scale(1.25); opacity: 1; }
                    40%, 82% { transform: scale(1); opacity: 1; } 95%, 100% { transform: scale(0); opacity: 0; } }
  @keyframes blush { 0%, 100% { opacity: .4; } 50% { opacity: .95; } }
  @keyframes sorry { 0%, 18% { opacity: 0; transform: translateY(2px); } 30%, 85% { opacity: 1; transform: translateY(0); } 100% { opacity: 0; } }
  @keyframes dance { 0%, 100% { transform: translateX(0) rotate(0deg); }
                     25% { transform: translateX(-2px) rotate(-4deg); } 75% { transform: translateX(2px) rotate(4deg); } }
  @keyframes maraca { 0%, 100% { transform: rotate(-16deg); } 50% { transform: rotate(16deg); } }
  @keyframes thumb { 0%, 18% { transform: translateY(4px); opacity: 0; } 32% { opacity: 1; }
                     40%, 100% { transform: translateY(0); opacity: 1; } }
  @keyframes tremble { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-.5px); } 75% { transform: translateX(.5px); } }
  @keyframes dropfall { 0% { transform: translateY(-2px); opacity: 0; } 25% { opacity: 1; }
                        100% { transform: translateY(4px); opacity: 0; } }
  @keyframes sparkle { 0%, 100% { opacity: .2; transform: scale(.7); } 50% { opacity: 1; transform: scale(1.1); } }
  @keyframes lupa { 0%, 100% { transform: translate(0, 0); } 45% { transform: translate(-17px, 1px); } }

  .a-bob { animation: bob 1.8s ease-in-out infinite; }
  .a-notes1 { animation: notes 2.2s ease-out infinite; }
  .a-notes2 { animation: notes 2.2s ease-out 1.1s infinite; }
  .a-bubble { animation: bubble 5s ease-in-out infinite; transform-box: fill-box; transform-origin: left center; }
  .a-wander { animation: wander 6s ease-in-out infinite; }
  .a-zzz1 { animation: zzz 2.6s ease-out infinite; }
  .a-zzz2 { animation: zzz 2.6s ease-out 1.3s infinite; }
  .a-fly { animation: fly 4s ease-in-out infinite; }
  .a-chase { animation: chase 4s ease-in-out infinite; }
  .a-crumb1 { animation: crumbs 1.2s linear infinite; }
  .a-crumb2 { animation: crumbs 1.2s linear .4s infinite; }
  .a-crumb3 { animation: crumbs 1.2s linear .8s infinite; }
  .a-ear { animation: earpulse .8s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
  .a-pencil { animation: pencil .35s ease-in-out infinite; transform-box: fill-box; transform-origin: center bottom; }
  .a-writeline { animation: writeline 2.4s linear infinite; transform-box: fill-box; transform-origin: left center; }
  .a-spin { animation: spin4 1.1s steps(8) infinite; transform-box: fill-box; transform-origin: center; }
  .a-gear1 { animation: spin4 2.2s steps(8) infinite; transform-box: fill-box; transform-origin: center; }
  .a-gear2 { animation: spinback 2.2s steps(8) infinite; transform-box: fill-box; transform-origin: center; }
  .a-bulb { animation: bulb 2.4s ease-in-out infinite; }
  .a-dot1 { animation: dots3 1.2s ease-in-out infinite; }
  .a-dot2 { animation: dots3 1.2s ease-in-out .25s infinite; }
  .a-dot3 { animation: dots3 1.2s ease-in-out .5s infinite; }
  .a-confetti rect { animation: confetti 3s ease-out infinite; }
  .a-burp { animation: burp 3.6s ease-in-out infinite; }
  .a-glasses { animation: glasses 4s ease-in-out infinite; }
  .a-tilt { animation: tilt 3.4s ease-in-out infinite; transform-box: fill-box; transform-origin: center 80%; }
  .a-qpop { animation: qpop 3.4s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
  .a-blush { animation: blush 1.6s ease-in-out infinite; }
  .a-sorry { animation: sorry 3.4s ease-in-out infinite; }
  .a-dance { animation: dance .7s ease-in-out infinite; transform-box: fill-box; transform-origin: center bottom; }
  .a-maraca1 { animation: maraca .34s ease-in-out infinite; transform-box: fill-box; transform-origin: center bottom; }
  .a-maraca2 { animation: maraca .34s ease-in-out .17s infinite; transform-box: fill-box; transform-origin: center bottom; }
  .a-thumb { animation: thumb 3s ease-out infinite; }
  .a-tremble { animation: tremble .18s linear infinite; }
  .a-dropfall { animation: dropfall 1.5s ease-in .3s infinite; }
  .a-sparkle1 { animation: sparkle 1.4s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
  .a-sparkle2 { animation: sparkle 1.4s ease-in-out .7s infinite; transform-box: fill-box; transform-origin: center; }
  .a-lupa { animation: lupa 3.2s ease-in-out infinite; }
`;

export default function Hud() {
  const [rec, setRec] = useState<RecordingState>({ state: "idle" });
  const [variant, setVariant] = useState(0);
  const [dark, setDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

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
      const face = stateFor(e.payload);
      const idx = pick(face, e.payload.state === "done" ? e.payload.text : undefined);
      setVariant(idx);
      hudLog(`evento ${e.payload.state} → carita ${face}[${idx}]`);
    });
    return () => {
      unState.then((f) => f());
    };
  }, []);

  const pal = dark ? DARK : LIGHT;
  const vars = useMemo(
    () =>
      ({
        "--a": pal.a, "--m": pal.m, "--p": pal.p, "--w": pal.w,
        "--face": pal.face, "--faint": pal.faint,
        "--lcd": pal.lcd, "--lcdBorder": pal.lcdBorder, "--grid": pal.grid,
        "--shellA": pal.shellA, "--shellB": pal.shellB,
        "--warnLcd": pal.warnLcd, "--warnBorder": pal.warnBorder,
      }) as React.CSSProperties,
    [pal],
  );

  const face = stateFor(rec);
  const isError = rec.state === "error";
  // En error se reutiliza la carita de "señal perdida" con el mensaje real.
  const v = isError ? V["no-entendi"][3] : (V[face][variant] ?? V[face][0]);
  const sad = isError || v.sad;
  const status = isError
    ? rec.message
    : rec.state === "done"
      ? rec.text
      : v.status;

  return (
    <div className="flex h-screen w-screen items-center justify-center" style={vars}>
      <style>{CSS}</style>
      <div className={`tama ${sad ? "sad" : ""} ${v.shake && !isError ? "shake" : ""}`}>
        <div className="screen" style={{ color: sad ? pal.w : pal.face }}>
          <span
            className="mic-px"
            dangerouslySetInnerHTML={{ __html: MIC_SVG }}
          />
          <span className="scene">
            <svg
              viewBox="0 0 48 20"
              dangerouslySetInnerHTML={{ __html: v.scene }}
            />
          </span>
          <span className={`status ${rec.state === "done" || isError ? "texto" : ""}`}>
            {status}
          </span>
        </div>
      </div>
    </div>
  );
}
