/**
 * Caritas del HUD tamagotchi: sprites en mapas de texto → SVG.
 *
 * Reglas que salieron de la primera versión (todas se rompían en algún sitio):
 *  · Coordenadas enteras. Con `shape-rendering: crispEdges` un 15.5 se pinta
 *    con un píxel de otro tamaño y la carita se ve sucia.
 *  · Rejilla fija: ojos de 3 px en x=15 y x=27, cara centrada en x=22, boca
 *    entre y=11 y y=14, accesorios de x=33 en adelante. Los lentes viejos
 *    tapaban el ojo izquierdo y dejaban el derecho fuera justo por saltarse
 *    esta rejilla.
 *  · Un gesto por carita: ojos + boca + un accesorio como mucho. A ~2 px por
 *    celda, tres cosas a la vez son una mancha.
 *  · Bucle ≤1.4 s. El HUD vive 2-3 s: una animación de 4 s sólo se ve empezar.
 *  · El movimiento salta de píxel en píxel (`steps`), nunca interpola: el
 *    pixel-art deslizándose medio píxel tiembla.
 */

export type FaceState = "reposo" | "escuchando" | "pensando" | "listo" | "no-entendi";

export interface Variant {
  status: string;
  scene: string;
  sad?: boolean;
  shake?: boolean;
}


// ─── paletas del tamagotchi (mismos colores de Dicho) ───────────────────────
export const PALETA_CLARA = {
  a: "#2563eb", m: "#17b394", p: "#f06ea9", w: "#ea7317", s: "#38bdf8",
  face: "#33415c", faint: "#8296b2",
  lcd: "#d7e1f0", lcdBorder: "#bfcde2", grid: "rgba(51,65,92,.07)",
  shellA: "#cdd7e6", shellB: "#aab9d0",
  warnLcd: "#f7e3cd", warnBorder: "#ecc9a0",
};
export const PALETA_OSCURA = {
  a: "#38bdf8", m: "#2dd4b4", p: "#f472b6", w: "#fb923c", s: "#7dd3fc",
  face: "#dbe6f6", faint: "#5c6f8f",
  lcd: "#0a1322", lcdBorder: "#223052", grid: "rgba(219,230,246,.05)",
  shellA: "#263450", shellB: "#16223a",
  warnLcd: "#2b1d0e", warnBorder: "#4a3520",
};

/** Paleta como variables CSS, lista para el `style` de un contenedor. */
export const cssVars = (dark: boolean): Record<string, string> =>
  Object.fromEntries(
    Object.entries(dark ? PALETA_OSCURA : PALETA_CLARA).map(([k, v]) => [`--${k}`, v]),
  );

const PAL: Record<string, string> = {
  X: "currentColor",
  a: "var(--a)",
  m: "var(--m)",
  p: "var(--p)",
  w: "var(--w)",
  s: "var(--s)",
  o: "var(--lcd)",
};

/** Pinta un mapa de texto como rejilla de <rect> de 1×1. */
export function spr(map: string[], ox = 0, oy = 0): string {
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

/** Tiñe un sprite con otro color de la paleta. */
const tint = (map: string[], c: string) => map.map((r) => r.replace(/X/g, c));

// ─── rejilla de la cara ─────────────────────────────────────────────────────
const LX = 15; // ojo izquierdo (3 de ancho → centro en 16)
const RX = 27; // ojo derecho   (3 de ancho → centro en 28)

/** Mismo sprite en los dos ojos, centrado sobre cada uno. Anchos impares. */
const eyes = (m: string[], y: number) => {
  const ox = (3 - m[0].length) / 2;
  return spr(m, LX + ox, y) + spr(m, RX + ox, y);
};

// ─── ojos ───────────────────────────────────────────────────────────────────
const OJO = ["XXX", "XXX", "XXX", "XXX"];
const OJO_LINEA = ["XXX"];
const OJO_ARCO = [".XXX.", "X...X"];
const OJO_TRISTE = ["X...X", ".XXX."];
const CUENCA = ["XXXXXXX", "X.....X", "X.....X", "X.....X", "XXXXXXX"];
const PUPILA = ["XXX", "XXX"];

// ─── bocas (centradas en x=22) ──────────────────────────────────────────────
const SONRISA = ["X.......X", ".XXXXXXX."];
const SONRISOTA = ["XXXXXXXXX", ".XXXXXXX.", "..XXXXX..", "...XXX..."];
const BOCA_O = [".XXX.", "XXXXX", "XXXXX", ".XXX."];
const BOSTEZO = [".XXXXX.", "X.....X", "X.....X", "X.....X", ".XXXXX."];
const BOCA_CHICA = ["XXX", "XXX"];
const RAYA = ["XXXXX"];
const ZIGZAG = ["XX...XX..", "..XXX..XX"];
const LADEADA = ["XXXXXX...", "......XXX"];
/** Media sonrisa que sube por la derecha: la cara de "me puse los lentes". */
const SONRISA_LADO = ["......XXX", "XXXXXX..."];

// ─── accesorios ─────────────────────────────────────────────────────────────
/**
 * Lentes oscuros: cristales macizos sobre la rejilla de los ojos. Cristal
 * izquierdo x13-19 (ojo en 15-17), puente x20-24, cristal derecho x25-31 (ojo
 * en 27-29), patillas en x12 y x32-33. Al aterrizar tapan los ojos: ése es el
 * efecto. (En tema oscuro el LCD es oscuro y el píxel encendido es claro, así
 * que "oscuro" aquí quiere decir macizo.)
 */
const LENTES = [
  "..XXXXX.......XXXXX...",
  ".XXXXXXXXXXXXXXXXXXX..",
  "XXXXXXXX.....XXXXXXXXX",
  ".XXXXXXX.....XXXXXXX..",
  ".XXXXXXX.....XXXXXXX..",
  "..XXXXX.......XXXXX...",
];
/** Banda diagonal del color del fondo: el destello que cruza los cristales. */
const BRILLO = ["...oo", "..oo.", ".oo..", "oo..."];
const PUNTO = ["XX", "XX"];
const NOTA = ["..XX", "..XX", "..XX", "XXX.", "XXX."];
const ZZZ = ["XXXX", "..X.", ".X..", "XXXX"];
const ZZZ_MINI = ["XXX", ".X.", "XXX"];
const GOTA = [".X.", "XXX", "XXX", ".X."];
const INTERR = [".XX.", "X..X", "...X", "..X.", "....", "..X."];
const FOCO_OFF = ["..XXX..", ".X...X.", ".X...X.", ".X...X.", "..XXX..", "..XXX.."];
const FOCO_ON = ["..XXX..", ".XXXXX.", ".XXXXX.", ".XXXXX.", "..XXX..", "..XXX.."];
const PULGAR = ["..XX.", "..XX.", "XXXX.", "XXXXX", "XXXXX", ".XXXX"];
const MARACA = ["XXX", "XXX", "XXX", ".X.", ".X."];
const LUPA = [".XXX.", "X...X", "X...X", ".XXX.", "...XX", "....X"];
const LAPIZ = ["...X", "..XX", ".XX.", "XX.."];
const TECLADO = ["XXXXXXXXXXX", "X.X.X.X.X.X"];
const MANO = ["XXX", "XXX"];
const CHISPA = ["..X..", "..X..", "XXXXX", "..X..", "..X.."];
const CHISPITA = [".X.", "XXX", ".X."];
const CACHETE = ["XX", "XX"];
const MARCO = ["XXXXXXXXXXXX", "X..........X", "XXXXXXXXXXXX"];
const RUIDO_A = ["X..X...X..X", "..X...X....", "X...X....X.", ".X.....X..X"];
const RUIDO_B = [".X...X..X..", "X..X.....X.", "..X..X.X...", "X....X...X."];

// ─── motorcito de fotogramas ────────────────────────────────────────────────
/** Alterna N dibujos a partes iguales (el clásico flipbook). */
const flip = (list: string[], dur: string) =>
  `<g class="flip flip${list.length}" style="--d:${dur}">` +
  list.map((h) => `<g>${h}</g>`).join("") +
  `</g>`;

/** Parpadeo: abierto casi todo el ciclo, cerrado un instante. */
const blink = (open: string, shut: string, dur = "3.2s") =>
  `<g class="blink" style="--d:${dur}"><g>${open}</g><g>${shut}</g></g>`;

/** Guiño: como el parpadeo pero el ojo se queda cerrado un rato largo. */
const wink = (open: string, shut: string, dur = "1.6s") =>
  `<g class="wink" style="--d:${dur}"><g>${open}</g><g>${shut}</g></g>`;

/** Ocho fotogramas con un punto dando la vuelta: "cargando" de toda la vida. */
const SPINNER = ([
  [0, -3],
  [2, -2],
  [3, 0],
  [2, 2],
  [0, 3],
  [-2, 2],
  [-3, 0],
  [-2, -2],
] as [number, number][]).map(([dx, dy]) => spr(PUNTO, 40 + dx, 6 + dy));

/** El carril apagado del spinner: sin él, el punto parece un bicho suelto. */
const SPINNER_CARRIL = `<g opacity=".16">${SPINNER.join("")}</g>`;

/** Barras que suben con tu voz de verdad (--lvl lo actualiza el HUD). */
const VU = `<g class="vu">
  <rect class="v1" x="34" y="4" width="2" height="12"/>
  <rect class="v2" x="38" y="4" width="2" height="12"/>
  <rect class="v3" x="42" y="4" width="2" height="12"/>
</g>`;

// ─── 25 caritas: 5 por estado ───────────────────────────────────────────────
export const V: Record<FaceState, Variant[]> = {
  reposo: [
    {
      status: "Dicho",
      scene: `<g class="a-resp">${blink(eyes(OJO, 5), eyes(OJO_LINEA, 7))}${spr(SONRISA, 18, 12)}</g>`,
    },
    {
      status: "Dicho",
      scene: `${spr(CUENCA, 13, 4)}${spr(CUENCA, 25, 4)}
        <g class="a-mira">${spr(PUPILA, 15, 5)}${spr(PUPILA, 27, 5)}</g>
        ${spr(SONRISA, 18, 12)}`,
    },
    {
      status: "Zzz…",
      scene: `${eyes(OJO_LINEA, 7)}${spr(BOCA_CHICA, 21, 12)}
        <g class="a-zzz">${spr(ZZZ, 36, 6)}</g>
        <g class="a-zzz2">${spr(ZZZ_MINI, 42, 10)}</g>`,
    },
    {
      status: "Dicho",
      scene: `${eyes(OJO_ARCO, 6)}
        ${flip([spr(BOCA_CHICA, 21, 12), spr(BOCA_O, 20, 11)], "1s")}
        <g class="a-nota">${spr(tint(NOTA, "a"), 37, 7)}</g>`,
    },
    {
      status: "Dicho",
      scene: `${eyes(OJO_LINEA, 7)}
        ${flip([spr(BOCA_CHICA, 21, 12), spr(BOCA_O, 20, 11), spr(BOSTEZO, 19, 10)], "1.4s")}`,
    },
  ],

  escuchando: [
    {
      // Las barras siguen el volumen real de tu voz, no un bucle enlatado.
      status: "Te escucho",
      scene: `${eyes(OJO, 5)}${spr(BOCA_CHICA, 21, 12)}${VU}`,
    },
    {
      status: "Ajá, sigue…",
      scene: `<g class="a-asiente">${eyes(OJO_ARCO, 6)}${spr(SONRISA, 18, 12)}</g>`,
    },
    {
      status: "Te escucho",
      scene: `${spr(CUENCA, 13, 4)}${spr(CUENCA, 25, 4)}
        <g class="a-atento">${spr(PUPILA, 15, 5)}${spr(PUPILA, 27, 5)}</g>
        ${spr(SONRISA, 18, 12)}`,
    },
    {
      status: "Anotando…",
      scene: `${eyes(OJO, 5)}${spr(RAYA, 20, 13)}
        <g class="a-lapiz">${spr(tint(LAPIZ, "a"), 39, 8)}</g>
        <g class="a-renglon"><rect x="34" y="13" width="11" height="1" fill="var(--a)"/></g>`,
    },
    {
      // La boca se abre con el volumen: la carita "habla" contigo.
      status: "Te escucho",
      scene: `${eyes(OJO, 5)}<g class="boca-voz">${spr(BOCA_O, 20, 11)}</g>${VU}`,
    },
  ],

  pensando: [
    {
      status: "Escribiendo…",
      scene: `${spr(CUENCA, 13, 4)}${spr(CUENCA, 25, 4)}${spr(PUPILA, 15, 5)}${spr(PUPILA, 27, 5)}
        ${spr(RAYA, 20, 13)}
        <g class="a-pt1">${spr(PUNTO, 35, 12)}</g><g class="a-pt2">${spr(PUNTO, 39, 12)}</g><g class="a-pt3">${spr(PUNTO, 43, 12)}</g>`,
    },
    {
      status: "Escribiendo…",
      scene: `${eyes(OJO, 5)}${spr(RAYA, 20, 13)}
        ${SPINNER_CARRIL}${flip(SPINNER, ".8s")}`,
    },
    {
      status: "Escribiendo…",
      scene: `${eyes(OJO, 5)}${spr(BOCA_CHICA, 21, 12)}
        ${flip([spr(FOCO_OFF, 38, 4), spr(tint(FOCO_ON, "w"), 38, 4)], "1.2s")}`,
    },
    {
      // Tecleando: las manos se turnan sobre el teclado.
      status: "Escribiendo…",
      scene: `${eyes(OJO, 5)}${spr(RAYA, 20, 13)}
        ${spr(TECLADO, 34, 13)}
        ${flip(
          [
            spr(MANO, 35, 10) + spr(MANO, 40, 11),
            spr(MANO, 35, 11) + spr(MANO, 40, 10),
          ],
          ".26s",
        )}`,
    },
    {
      status: "Escribiendo…",
      scene: `${eyes(OJO_LINEA, 7)}${spr(BOCA_CHICA, 21, 12)}
        ${spr(MARCO, 34, 8)}
        <g class="a-barra"><rect x="35" y="9" width="10" height="1" fill="var(--m)"/></g>`,
    },
  ],

  listo: [
    {
      status: "¡Listo!",
      scene: `${wink(eyes(OJO, 5), spr(OJO, LX, 5) + spr(OJO_LINEA, RX, 7))}
        ${spr(SONRISA, 18, 12)}
        <g class="a-pulgar">${spr(tint(PULGAR, "a"), 39, 7)}</g>`,
    },
    {
      status: "¡Listo!",
      scene: `${eyes(OJO_ARCO, 6)}${spr(SONRISOTA, 19, 11)}
        <g class="a-chispa1">${spr(tint(CHISPA, "m"), 34, 3)}</g>
        <g class="a-chispa2">${spr(tint(CHISPITA, "m"), 42, 10)}</g>`,
    },
    {
      // La de los lentes, ahora alineada: el marco encuadra los dos ojos.
      status: "¡Listo!",
      scene: `${eyes(OJO, 5)}${spr(SONRISA_LADO, 18, 12)}
        <g class="a-lentes">${spr(LENTES, 12, 3)}
          <g class="a-brillo">${spr(BRILLO, 14, 4)}</g>
        </g>`,
    },
    {
      status: "¡Órale!",
      scene: `<g class="a-baila">${eyes(OJO_ARCO, 6)}${spr(SONRISOTA, 19, 11)}</g>
        <g class="a-mar1">${spr(tint(MARACA, "p"), 8, 8)}</g>
        <g class="a-mar2">${spr(tint(MARACA, "p"), 38, 8)}</g>`,
    },
    {
      status: "Got it!",
      scene: `${eyes(OJO_ARCO, 6)}${spr(SONRISOTA, 19, 11)}
        <g class="a-confeti">${(
          [
            ["p", -10, -6],
            ["m", 10, -7],
            ["a", -13, 3],
            ["p", 12, 4],
            ["m", -5, -10],
            ["a", 6, -10],
          ] as [string, number, number][]
        )
          .map(
            ([c, x, y], i) =>
              `<rect x="21" y="4" width="2" height="2" fill="${PAL[c]}" style="--cx:${x}px; --cy:${y}px; animation-delay:${i * 0.06}s"/>`,
          )
          .join("")}</g>`,
    },
  ],

  "no-entendi": [
    {
      status: "No escuché nada, lo siento",
      sad: true,
      shake: true,
      scene: `${eyes(OJO_TRISTE, 6)}${spr(ZIGZAG, 18, 12)}
        <g class="a-gota">${spr(tint(GOTA, "s"), 38, 4)}</g>`,
    },
    {
      status: "¿Me repites?",
      sad: true,
      // Ladear la cabeza sin rotar: un ojo sube, el otro baja y la boca se tuerce.
      scene: `${spr(OJO, LX, 6)}${spr(OJO, RX, 4)}${spr(LADEADA, 18, 12)}
        <g class="a-interr">${spr(tint(INTERR, "w"), 39, 3)}</g>`,
    },
    {
      status: "Perdón…",
      sad: true,
      scene: `${eyes(OJO_LINEA, 7)}${spr(BOCA_CHICA, 21, 12)}
        <g class="a-rubor">${spr(tint(CACHETE, "p"), 12, 9)}${spr(tint(CACHETE, "p"), 31, 9)}</g>
        <g class="a-pt1">${spr(PUNTO, 37, 12)}</g><g class="a-pt2">${spr(PUNTO, 41, 12)}</g><g class="a-pt3">${spr(PUNTO, 45, 12)}</g>`,
    },
    {
      // También se reutiliza para los errores de la app.
      status: "Señal perdida",
      sad: true,
      scene: `${eyes(OJO, 5)}${spr(RAYA, 20, 13)}
        <g opacity=".6">${flip(
          [spr(RUIDO_A, 34, 3) + spr(RUIDO_B, 35, 12), spr(RUIDO_B, 34, 3) + spr(RUIDO_A, 35, 12)],
          ".24s",
        )}</g>`,
    },
    {
      status: "¿Y tu voz?",
      sad: true,
      scene: `${spr(CUENCA, 13, 4)}${spr(CUENCA, 25, 4)}
        <g class="a-busca">${spr(PUPILA, 15, 5)}${spr(PUPILA, 27, 5)}</g>
        ${spr(BOCA_CHICA, 21, 12)}
        <g class="a-lupa">${spr(tint(LUPA, "a"), 40, 6)}</g>`,
    },
  ],
};

export const MIC_SVG = `<svg viewBox="0 0 7 13">${spr(
  [".aaa.", "aaaaa", "a.a.a", "aaaaa", "a.a.a", "aaaaa", ".aaa.", "..a..", "..a..", ".aaa."],
  1,
  1,
)}</svg>`;


/**
 * Reparte N fotogramas a partes iguales del ciclo. Se genera en vez de
 * escribirse a mano para que añadir una carita de 8 cuadros no obligue a
 * tocar el CSS (así se quedó la ruedita de "cargando").
 */
const FLIP_CSS = [2, 3, 4, 5, 6, 7, 8]
  .map((n) => {
    let css = "";
    for (let i = 0; i < n; i++) {
      const ini = ((i / n) * 100).toFixed(2);
      const fin = (((i + 1) / n) * 100).toFixed(2);
      css += `  .flip${n} > g:nth-child(${i + 1}) { animation: fl${n}_${i} var(--d, .8s) steps(1, end) infinite; }
`;
      css +=
        i === 0
          ? `  @keyframes fl${n}_0 { 0% { opacity: 1; } ${fin}%, 100% { opacity: 0; } }
`
          : i === n - 1
            ? `  @keyframes fl${n}_${i} { 0% { opacity: 0; } ${ini}%, 100% { opacity: 1; } }
`
            : `  @keyframes fl${n}_${i} { 0% { opacity: 0; } ${ini}% { opacity: 1; } ${fin}%, 100% { opacity: 0; } }
`;
    }
    return css;
  })
  .join("");

// ─── carcasa + animaciones ──────────────────────────────────────────────────
// `steps(1, end)` en casi todas: el sprite salta de píxel a píxel en vez de
// deslizarse, que es lo que hace que el pixel-art se vea limpio.
export const FACE_CSS = `
  .tama { width: 336px; height: 64px; border-radius: 999px; padding: 5px;
          background: linear-gradient(180deg, var(--shellA), var(--shellB));
          box-shadow: 0 18px 40px -18px rgba(10, 25, 60, .45), inset 0 1px 0 rgba(255,255,255,.35); }
  .screen { height: 100%; border-radius: 999px; background: var(--lcd);
            border: 1px solid var(--lcdBorder);
            box-shadow: inset 0 3px 10px rgba(10, 20, 40, .25);
            overflow: hidden; position: relative; color: var(--face);
            display: flex; align-items: center; gap: 6px; padding: 0 12px 0 12px;
            transition: background .25s; }
  .screen::before { content: ""; position: absolute; inset: 0; pointer-events: none;
    background-image: linear-gradient(var(--grid) 1px, transparent 1px),
                      linear-gradient(90deg, var(--grid) 1px, transparent 1px);
    background-size: 3px 3px; }
  .mic-px { flex-shrink: 0; height: 30px; }
  .mic-px svg { height: 100%; width: auto; shape-rendering: crispEdges; display: block; }
  .scene { flex: 1; height: 50px; min-width: 0; }
  .scene svg { width: 100%; height: 100%; shape-rendering: crispEdges; overflow: visible; display: block; }
  .status { flex-shrink: 0; max-width: 88px; text-align: right;
            font: 700 8.5px/1.3 Consolas, "Cascadia Mono", monospace;
            letter-spacing: .08em; text-transform: uppercase; color: var(--faint);
            overflow: hidden; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; }
  .status.texto { text-transform: none; letter-spacing: 0; font-weight: 600; font-size: 9.5px; }
  /* Cinta de capacidad del dictado: sale a mitad del tope y avisa en naranja
     cuando queda poco. Antes el audio de más se tiraba sin decir nada. */
  .cinta { position: absolute; left: 0; bottom: 0; height: 2px; width: 100%;
           transform-origin: left center; transform: scaleX(var(--cap, 0));
           background: var(--a); opacity: .75; }
  .cinta.alto { background: var(--w); opacity: 1; }
  .tama.sad .screen { background: var(--warnLcd); border-color: var(--warnBorder); color: var(--w); }
  .tama.sad .status { color: var(--w); }
  .tama.shake { animation: shake .5s steps(1, end); }
  @keyframes shake { 0% { transform: translateX(0); } 12% { transform: translateX(-4px); }
    24% { transform: translateX(4px); } 36% { transform: translateX(-3px); }
    48% { transform: translateX(2px); } 60% { transform: translateX(-1px); }
    72%, 100% { transform: translateX(0); } }

  .flip > g { opacity: 0; }
${FLIP_CSS}
  .blink > g:nth-child(1) { animation: blinkA var(--d) steps(1, end) infinite; }
  .blink > g:nth-child(2) { animation: blinkB var(--d) steps(1, end) infinite; }
  @keyframes blinkA { 0% { opacity: 1; } 92% { opacity: 0; } 97% { opacity: 1; } }
  @keyframes blinkB { 0% { opacity: 0; } 92% { opacity: 1; } 97% { opacity: 0; } }
  .wink > g:nth-child(1) { animation: winkA var(--d) steps(1, end) infinite; }
  .wink > g:nth-child(2) { animation: winkB var(--d) steps(1, end) infinite; }
  @keyframes winkA { 0% { opacity: 1; } 35% { opacity: 0; } 72% { opacity: 1; } }
  @keyframes winkB { 0% { opacity: 0; } 35% { opacity: 1; } 72% { opacity: 0; } }

  /* Barras y boca movidas por el volumen real de tu voz (--lvl: 0…1). */
  .vu rect { fill: var(--a); transform-box: fill-box; transform-origin: center bottom;
             transition: transform .07s linear; }
  .vu .v1 { transform: scaleY(calc(.16 + var(--lvl, .1) * .55)); }
  .vu .v2 { transform: scaleY(calc(.2 + var(--lvl, .1) * .8)); }
  .vu .v3 { transform: scaleY(calc(.16 + var(--lvl, .1) * .42)); }
  .boca-voz { transform-box: fill-box; transform-origin: center center;
              transform: scaleY(calc(.45 + var(--lvl, .1) * .9));
              transition: transform .07s linear; }

  @keyframes resp { 0% { transform: translateY(0); } 50% { transform: translateY(-1px); } }
  @keyframes mira { 0% { transform: translateX(0); } 30% { transform: translateX(-1px); }
                    60% { transform: translateX(1px); } 90% { transform: translateX(0); } }
  @keyframes asiente { 0% { transform: translateY(0); } 50% { transform: translateY(2px); } }
  @keyframes atento { 0% { transform: translate(0, 0); } 25% { transform: translate(1px, 0); }
                      50% { transform: translate(0, 1px); } 75% { transform: translate(-1px, 0); } }
  @keyframes busca { 0% { transform: translate(0, 0); } 25% { transform: translate(-1px, 1px); }
                     50% { transform: translate(1px, 0); } 75% { transform: translate(1px, 1px); } }
  @keyframes sube { 0% { transform: translate(0, 3px); opacity: 0; }
                    20%, 80% { opacity: 1; }
                    100% { transform: translate(2px, -6px); opacity: 0; } }
  @keyframes lapiz { 0% { transform: translate(0, 0); } 50% { transform: translate(-1px, 1px); } }
  @keyframes renglon { 0% { transform: scaleX(0); } 20% { transform: scaleX(.25); }
                       40% { transform: scaleX(.5); } 60% { transform: scaleX(.75); }
                       80% { transform: scaleX(1); } 90% { transform: scaleX(0); } }
  @keyframes barra { 0% { transform: scaleX(.1); } 25% { transform: scaleX(.35); }
                     50% { transform: scaleX(.6); } 75% { transform: scaleX(.85); }
                     95% { transform: scaleX(1); } }
  @keyframes punto { 0% { opacity: .18; } 25% { opacity: 1; } 60% { opacity: .18; } }
  @keyframes foco { 0% { opacity: .18; } 45% { opacity: 1; } }
  @keyframes chispa { 0% { opacity: 0; } 30% { opacity: 1; } 70% { opacity: 0; } }
  @keyframes lentes { 0% { transform: translateY(-12px); }
                      9% { transform: translateY(-4px); }
                      15% { transform: translateY(1px); }
                      19%, 100% { transform: translateY(0); } }
  /* El destello entra ya aterrizados los lentes y cruza los dos cristales. */
  @keyframes brillo { 0%, 38% { transform: translateX(0); opacity: 0; }
                      40% { transform: translateX(0); opacity: 1; }
                      42% { transform: translateX(2px); }
                      44% { transform: translateX(4px); }
                      46% { transform: translateX(6px); }
                      48% { transform: translateX(8px); }
                      50% { transform: translateX(10px); }
                      52% { transform: translateX(12px); }
                      54% { transform: translateX(14px); }
                      56% { transform: translateX(16px); opacity: 1; }
                      58%, 100% { transform: translateX(16px); opacity: 0; } }
  @keyframes pulgar { 0% { transform: translateY(5px); opacity: 0; }
                      25% { transform: translateY(0); opacity: 1; }
                      35% { transform: translateY(-1px); }
                      45%, 100% { transform: translateY(0); opacity: 1; } }
  @keyframes baila { 0% { transform: translateX(-1px); } 50% { transform: translateX(1px); } }
  @keyframes maraca { 0% { transform: translate(0, 0); } 50% { transform: translate(1px, -1px); } }
  @keyframes confeti { 0% { transform: translate(0, 0); opacity: 0; }
                       12%, 70% { opacity: 1; }
                       100% { transform: translate(var(--cx), var(--cy)); opacity: 0; } }
  @keyframes gota { 0% { transform: translateY(0); opacity: 0; }
                    20%, 85% { opacity: 1; }
                    100% { transform: translateY(9px); opacity: 0; } }
  @keyframes interr { 0% { transform: translateY(3px); opacity: 0; }
                      25% { transform: translateY(0); opacity: 1; }
                      85% { opacity: 1; } 100% { opacity: 0; } }
  @keyframes rubor { 0% { opacity: .45; } 50% { opacity: 1; } }
  @keyframes lupa { 0% { transform: translate(0, 0); } 25% { transform: translate(-4px, 2px); }
                    50% { transform: translate(-8px, 0); } 75% { transform: translate(-3px, 2px); } }

  .a-resp { animation: resp 2s steps(1, end) infinite; }
  .a-mira { animation: mira 2.4s steps(1, end) infinite; }
  .a-asiente { animation: asiente .8s steps(1, end) infinite; }
  .a-atento { animation: atento .9s steps(1, end) infinite; }
  .a-busca { animation: busca 1.2s steps(1, end) infinite; }
  .a-zzz { animation: sube 1.8s linear infinite; }
  .a-zzz2 { animation: sube 1.8s linear .9s infinite; }
  .a-nota { animation: sube 1.6s linear infinite; }
  .a-lapiz { animation: lapiz .3s steps(1, end) infinite; }
  .a-renglon { animation: renglon 1.4s steps(1, end) infinite;
               transform-box: fill-box; transform-origin: left center; }
  .a-barra { animation: barra 1.3s steps(1, end) infinite;
             transform-box: fill-box; transform-origin: left center; }
  .a-pt1 { animation: punto .9s steps(1, end) infinite; }
  .a-pt2 { animation: punto .9s steps(1, end) .15s infinite; }
  .a-pt3 { animation: punto .9s steps(1, end) .3s infinite; }
  .a-foco { animation: foco 1.2s steps(1, end) infinite; }
  .a-chispa1 { animation: chispa 1s steps(1, end) infinite; }
  .a-chispa2 { animation: chispa 1s steps(1, end) .35s infinite; }
  .a-lentes { animation: lentes 1.8s steps(1, end) infinite; }
  .a-brillo { animation: brillo 1.8s steps(1, end) infinite; }
  .a-pulgar { animation: pulgar 1.4s steps(1, end) infinite; }
  .a-baila { animation: baila .4s steps(1, end) infinite; }
  .a-mar1 { animation: maraca .4s steps(1, end) infinite; }
  .a-mar2 { animation: maraca .4s steps(1, end) .2s infinite; }
  .a-confeti rect { animation: confeti 1.4s linear infinite; }
  .a-gota { animation: gota 1.3s steps(1, end) infinite; }
  .a-interr { animation: interr 1.6s steps(1, end) infinite; }
  .a-rubor { animation: rubor 1.2s steps(1, end) infinite; }
  .a-lupa { animation: lupa 1.6s steps(1, end) infinite; }
`;

/** Nombre y momento de cada estado, para el catálogo de Ajustes. */
export const ESTADOS: { key: FaceState; titulo: string; cuando: string }[] = [
  { key: "escuchando", titulo: "Te escucho", cuando: "Mientras mantienes pulsado el atajo. Dos de estas cinco se mueven con el volumen real de tu voz." },
  { key: "pensando", titulo: "Escribiendo", cuando: "Transcribiendo y puliendo lo que dijiste (1-3 s)." },
  { key: "listo", titulo: "Listo", cuando: "Con el texto ya pegado. La cara de los lentes sale cuando el dictado va en español." },
  { key: "no-entendi", titulo: "No entendí", cuando: "El audio venía mudo o no se entendió nada." },
  { key: "reposo", titulo: "En reposo", cuando: "El instante antes de empezar a grabar." },
];
