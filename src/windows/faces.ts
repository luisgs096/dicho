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
  pergamino: "#efe4c8", pergaminoBorde: "#d8c49a", tinta: "#4a3a22",
};
export const PALETA_OSCURA = {
  a: "#38bdf8", m: "#2dd4b4", p: "#f472b6", w: "#fb923c", s: "#7dd3fc",
  face: "#dbe6f6", faint: "#5c6f8f",
  lcd: "#0a1322", lcdBorder: "#223052", grid: "rgba(219,230,246,.05)",
  shellA: "#263450", shellB: "#16223a",
  warnLcd: "#2b1d0e", warnBorder: "#4a3520",
  // En oscuro el pergamino no puede ser papel blanco: cegaría al lado del resto
  // de la onda. Es cuero viejo con la tinta clara, al revés que en claro.
  pergamino: "#2a2114", pergaminoBorde: "#4c3d24", tinta: "#e8d9b5",
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
export function spr(
  map: string[],
  ox = 0,
  oy = 0,
  /** Estilo por píxel, en coordenadas ya desplazadas. Lo usa el revelado del
   *  estreno para repartir los retrasos; el resto de las caritas no lo pasan. */
  estilo?: (x: number, y: number) => string,
): string {
  let out = "";
  map.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      if (!PAL[c]) continue;
      const st = estilo ? ` style="${estilo(x + ox, y + oy)}"` : "";
      out += `<rect x="${x + ox}" y="${y + oy}" width="1" height="1" fill="${PAL[c]}"${st}/>`;
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

/**
 * Repertorio de ojos, sacado del vocabulario de los tamagotchi de siempre.
 * Todos de ancho impar (1, 3 o 5): `eyes()` los centra con `(3 - ancho) / 2`
 * y con ancho par saldría un desplazamiento de medio píxel.
 *
 * Alturas pensadas para que el ojo siempre acabe en y=8, que es donde acaba
 * el ojo normal: OJO/OJO_ANCHO/OJO_BRILLO en y=5, OJO_MEDIO en y=7,
 * OJO_LINEA en y=7, OJO_ARCO/OJO_TRISTE en y=6 y los de 5 filas en y=4.
 */
const OJO = ["XXX", "XXX", "XXX", "XXX"];
const OJO_LINEA = ["XXX"];
const OJO_ARCO = [".XXX.", "X...X"];
const OJO_TRISTE = ["X...X", ".XXX."];
/** Entrecerrado: sólo la mitad de abajo. El párpado a medio caer. */
const OJO_MEDIO = ["XXX", "XXX"];
/** De par en par: dos píxeles más ancho. Sorpresa, se le prendió el foco. */
const OJO_ANCHO = ["XXXXX", "XXXXX", "XXXXX", "XXXXX"];
/** Con destello: el píxel `o` es del color del LCD, o sea un hueco. */
const OJO_BRILLO = ["oXX", "XXX", "XXX", "XXX"];
const OJO_ESTRELLA = ["..X..", "X.X.X", ".XXX.", "X.X.X", "..X.."];
const OJO_CORAZON = ["XX.XX", "XXXXX", "XXXXX", ".XXX.", "..X.."];
/** Aspas: el "aquí ya no entendí nada" de toda la vida. Se probó primero un
 *  remolino, pero a 5 px se leía como una letra G. */
const OJO_ASPA = ["X...X", ".X.X.", "..X..", ".X.X.", "X...X"];
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

/**
 * Audífonos de DJ, de arriba abajo: diadema (y=2), almohadilla de la
 * coronilla y bisagras (y=3) y dos auriculares con reborde (y=4-8) a los lados de la cara, en
 * x=11-13 y x=31-33. El labio interior del auricular sólo existe en la fila
 * de arriba y en la de abajo: relleno de lado a lado se fundía con el ojo y
 * la cara parecía llevar un antifaz. Por eso también las barras de volumen
 * se corrieron a x=36. Es el único accesorio que se pinta *sobre* la cara.
 */
const AUDIFONOS = [
  "...XXXXXXXXXXXXXXXXX...",
  ".XX.....XXXXXXX.....XX.",
  "XXX.................XXX",
  "XX...................XX",
  "XX...................XX",
  "XX...................XX",
  "XXX.................XXX",
];
/**
 * Boca de Pac-Man: el vértice queda a la izquierda y la cuña abre hacia la
 * derecha, que es de donde llega tu voz. Tres cuadros = un mordisco; el ciclo
 * (.6s) es múltiplo del paso de la onda (.2s) para que cada barra entre
 * siempre en la misma fase de la mordida.
 */
const PAC_ABIERTA = ["....XXX", "..XXXXX", "XXXXXXX", "XXXXXXX", "..XXXXX", "....XXX"];
const PAC_MEDIA = [".......", ".....XX", "XXXXXXX", "XXXXXXX", ".....XX", "......."];
const PAC_CERRADA = [".......", ".......", "XXXXXXX", "XXXXXXX", ".......", "......."];
/** Burbuja del eructo: cuatro filas para que salga redonda. Con tres se
 *  leía como una cruz verde, que no es lo que queremos decir. */
const PUFF = [".XX.", "XXXX", "XXXX", ".XX."];
/**
 * La cara llena de aire, aguantando la náusea. Se probaron primero dos
 * cachetes sueltos a los lados —como el rubor, pero más grandes— y a 3 px se
 * leían como **orejas**: dos bloques flotando lejos de la boca. Lo que sí
 * funciona es hinchar toda la parte baja de la cara de un solo trazo, hueca
 * como la cuenca o el bostezo, en dos tamaños para que se vea inflarse.
 * Centradas en x=22: la mediana (11 de ancho) en x=17, la llena (15) en x=15.
 */
/** Charco: se queda en el suelo después de la arcada y no se va. Plano y ancho
 *  para que se lea como líquido y no como otra burbuja. */
const CHARCO_CHICO = ["..XX..", ".XXXX."];
const CHARCO = ["..XXXX..", ".XXXXXX.", "XXXXXXXX"];
/** Hilo que escurre de la comisura. Un píxel de ancho: más, y es un chorro. */
const ESCURRE = ["X", "X", "X"];
/** Aspa flotante: en los tamagotchi el significado va en el símbolo de al lado,
 *  no en la cara. Ésta es la de "no, olvídalo". */
const ASPA = ["X...X", ".X.X.", "..X..", ".X.X.", "X...X"];

// ─── piezas de la actualización ─────────────────────────────────────────────
/** Marco de la barra de progreso. El relleno va aparte para poder animarlo, y
 *  en la película de la actualización **es la boca** del bicho. */

const CARRILLOS_MEDIO = [".XXXXXXXXX.", "X.........X", ".XXXXXXXXX."];
const CARRILLOS_LLENO = [
  ".XXXXXXXXXXXXX.",
  "X.............X",
  "X.............X",
  ".XXXXXXXXXXXXX.",
];

// ─── motorcito de fotogramas ────────────────────────────────────────────────
//
// OJO con cómo viaja la duración. Antes iba en una variable (`style="--d:.6s"`
// en el padre, y `animation: … var(--d) …` en el CSS) y eso congelaba las
// caritas: **cualquier** escritura de otra variable CSS —`--lvl`, el volumen de
// la voz, que el HUD refresca en cada fotograma— obliga a Chromium a recalcular
// el subárbol, volver a resolver ese `var()` y **recrear la animación desde
// cero**. Ningún gesto pasaba de unos milisegundos. Ahora la duración va inline
// y literal en cada fotograma: no hay `var()` que re-resolver, así que el
// volumen puede cambiar 60 veces por segundo sin tocar los gestos.
/** Alterna N dibujos a partes iguales (el clásico flipbook). */
const flip = (list: string[], dur: string) =>
  `<g class="flip flip${list.length}">` +
  list.map((h) => `<g style="animation-duration:${dur}">${h}</g>`).join("") +
  `</g>`;

/** Parpadeo: abierto casi todo el ciclo, cerrado un instante. */
const blink = (open: string, shut: string, dur = "3.2s") =>
  `<g class="blink"><g style="animation-duration:${dur}">${open}</g>` +
  `<g style="animation-duration:${dur}">${shut}</g></g>`;

/** Guiño: como el parpadeo pero el ojo se queda cerrado un rato largo. */
const wink = (open: string, shut: string, dur = "1.6s") =>
  `<g class="wink"><g style="animation-duration:${dur}">${open}</g>` +
  `<g style="animation-duration:${dur}">${shut}</g></g>`;

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
  <rect class="v1" x="36" y="4" width="2" height="12"/>
  <rect class="v2" x="40" y="4" width="2" height="12"/>
  <rect class="v3" x="44" y="4" width="2" height="12"/>
</g>`;

// ─── 26 caritas: 5 por estado + el eructo, que sólo sale tras la comilona ───
// Regla nueva (28/08): **ninguna carita tiene los ojos quietos**, y el gesto de
// los ojos no se repite entre caritas. Es lo que las separa unas de otras
// cuando el accesorio se parece.
export const V: Record<FaceState, Variant[]> = {
  reposo: [
    {
      // Respira y parpadea, con un destello en el ojo mientras está abierto.
      status: "Dicho",
      scene: `<g class="a-resp">${blink(eyes(OJO_BRILLO, 5), eyes(OJO_LINEA, 7))}${spr(SONRISA, 18, 12)}</g>`,
    },
    {
      status: "Dicho",
      scene: `${spr(CUENCA, 13, 4)}${spr(CUENCA, 25, 4)}
        <g class="a-mira">${spr(PUPILA, 15, 5)}${spr(PUPILA, 27, 5)}</g>
        ${spr(SONRISA, 18, 12)}`,
    },
    {
      // Dormido: la línea de los ojos sube y baja un píxel, como respirando.
      status: "Zzz…",
      scene: `${flip([eyes(OJO_LINEA, 7), eyes(OJO_LINEA, 8)], "1.8s")}${spr(BOCA_CHICA, 21, 12)}
        <g class="a-zzz">${spr(ZZZ, 36, 6)}</g>
        <g class="a-zzz2">${spr(ZZZ_MINI, 42, 10)}</g>`,
    },
    {
      // Tarareando: los arcos de los ojos brincan con la nota.
      status: "Dicho",
      scene: `${flip([eyes(OJO_ARCO, 6), eyes(OJO_ARCO, 5)], ".8s")}
        ${flip([spr(BOCA_CHICA, 21, 12), spr(BOCA_O, 20, 11)], "1s")}
        <g class="a-nota">${spr(tint(NOTA, "a"), 37, 7)}</g>`,
    },
    {
      // Bostezo: el párpado va cayendo (entrecerrado → línea → apretado) al
      // mismo ritmo que se abre la boca.
      status: "Dicho",
      scene: `${flip([eyes(OJO_MEDIO, 7), eyes(OJO_LINEA, 7), eyes(OJO_ARCO, 6)], "1.4s")}
        ${flip([spr(BOCA_CHICA, 21, 12), spr(BOCA_O, 20, 11), spr(BOSTEZO, 19, 10)], "1.4s")}`,
    },
  ],

  escuchando: [
    {
      // El DJ: los audífonos y el cabeceo son de la carita, pero las barras
      // siguen siendo tus decibeles de verdad — la música es tu voz. Los ojos
      // van entrecerrados disfrutando y de vez en cuando se abren.
      status: "Te escucho",
      scene: `<g class="a-dj">${flip(
        [
          eyes(OJO_MEDIO, 7),
          eyes(OJO_ARCO, 6),
          eyes(OJO_MEDIO, 7),
          eyes(OJO_BRILLO, 5),
        ],
        "1.6s",
      )}${spr(BOCA_CHICA, 21, 12)}${spr(AUDIFONOS, 11, 2)}</g>${VU}`,
    },
    {
      // Asiente con la cabeza y remata con un pestañeo contento.
      status: "Ajá, sigue…",
      scene: `<g class="a-asiente">${blink(eyes(OJO, 5), eyes(OJO_ARCO, 6), "2.2s")}${spr(SONRISA, 18, 12)}</g>`,
    },
    {
      status: "Te escucho",
      scene: `${spr(CUENCA, 13, 4)}${spr(CUENCA, 25, 4)}
        <g class="a-atento">${spr(PUPILA, 15, 5)}${spr(PUPILA, 27, 5)}</g>
        ${spr(SONRISA, 18, 12)}`,
    },
    {
      // Anotando: baja la mirada al renglón y la vuelve a levantar.
      status: "Anotando…",
      scene: `${flip([eyes(OJO, 5), eyes(OJO, 6)], ".6s")}${spr(RAYA, 20, 13)}
        <g class="a-lapiz">${spr(tint(LAPIZ, "a"), 39, 8)}</g>
        <g class="a-renglon"><rect x="34" y="13" width="11" height="1" fill="var(--a)"/></g>`,
    },
    {
      // Comilona: la onda de tu voz entra por la derecha y el Pac-Man se la va
      // masticando. Los ojos mastican con la boca (abierto → entrecerrado →
      // apretado, los tres al mismo ritmo que el mordisco). Las barras de la
      // onda respiran con el volumen real (--lvl): lo que se come es tu voz.
      status: "Ñam, ñam…",
      scene: `${flip([eyes(OJO, 5), eyes(OJO_MEDIO, 7), eyes(OJO_ARCO, 6)], ".6s")}
        ${flip(
          [spr(PAC_ABIERTA, 19, 10), spr(PAC_MEDIA, 19, 10), spr(PAC_CERRADA, 19, 10)],
          ".6s",
        )}
        <g class="a-onda">${[3, 5, 7, 3, 5, 3, 5]
          .map(
            (h, i) =>
              `<g style="animation-delay:${(i * 0.2).toFixed(1)}s"><rect x="44" y="${
                12.5 - h / 2
              }" width="2" height="${h}"/></g>`,
          )
          .join("")}</g>`,
    },
  ],

  pensando: [
    {
      // Las pupilas se van arriba y a un lado: la pose de estar pensando.
      status: "Escribiendo…",
      scene: `${spr(CUENCA, 13, 4)}${spr(CUENCA, 25, 4)}
        <g class="a-piensa">${spr(PUPILA, 15, 6)}${spr(PUPILA, 27, 6)}</g>
        ${spr(RAYA, 20, 13)}
        <g class="a-pt1">${spr(PUNTO, 35, 12)}</g><g class="a-pt2">${spr(PUNTO, 39, 12)}</g><g class="a-pt3">${spr(PUNTO, 43, 12)}</g>`,
    },
    {
      // Los ojos suben y bajan siguiendo la vuelta de la ruedita.
      status: "Escribiendo…",
      scene: `${flip([eyes(OJO, 4), eyes(OJO, 5)], ".8s")}${spr(RAYA, 20, 13)}
        ${SPINNER_CARRIL}${flip(SPINNER, ".8s")}`,
    },
    {
      // Se le prende el foco y los ojos se abren de par en par, al mismo ritmo.
      status: "Escribiendo…",
      scene: `${flip([eyes(OJO, 5), eyes(OJO_ANCHO, 5)], "1.2s")}${spr(BOCA_CHICA, 21, 12)}
        ${flip([spr(FOCO_OFF, 38, 4), spr(tint(FOCO_ON, "w"), 38, 4)], "1.2s")}`,
    },
    {
      // Tecleando: las manos se turnan sobre el teclado y los ojos van de
      // izquierda a derecha, como quien relee lo que va escribiendo.
      status: "Escribiendo…",
      scene: `<g class="a-leer">${eyes(OJO, 5)}</g>${spr(RAYA, 20, 13)}
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
      // Concentrado: el ojo se abre a medias y se vuelve a cerrar, sin prisa.
      status: "Escribiendo…",
      scene: `${flip([eyes(OJO_LINEA, 7), eyes(OJO_MEDIO, 7)], "1.3s")}${spr(BOCA_CHICA, 21, 12)}
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
      // Ojos de estrella cuando saltan las chispas: el clásico del tamagotchi.
      status: "¡Listo!",
      scene: `${flip([eyes(OJO_ARCO, 6), eyes(OJO_ESTRELLA, 4)], "1s")}${spr(SONRISOTA, 19, 11)}
        <g class="a-chispa1">${spr(tint(CHISPA, "m"), 34, 3)}</g>
        <g class="a-chispa2">${spr(tint(CHISPITA, "m"), 42, 10)}</g>`,
    },
    {
      // La de los lentes: los ojos se abren de golpe justo antes de que le
      // caigan encima, y los cristales los tapan.
      status: "¡Listo!",
      scene: `${flip([eyes(OJO, 5), eyes(OJO_ANCHO, 5)], ".45s")}${spr(SONRISA_LADO, 18, 12)}
        <g class="a-lentes">${spr(LENTES, 12, 3)}
          <g class="a-brillo">${spr(BRILLO, 14, 4)}</g>
        </g>`,
    },
    {
      status: "¡Órale!",
      scene: `<g class="a-baila">${flip([eyes(OJO_ARCO, 6), eyes(OJO_ARCO, 5)], ".4s")}${spr(SONRISOTA, 19, 11)}</g>
        <g class="a-mar1">${spr(tint(MARACA, "p"), 8, 8)}</g>
        <g class="a-mar2">${spr(tint(MARACA, "p"), 38, 8)}</g>`,
    },
    {
      // Ojos de corazón entre el confeti: te quiere.
      status: "Got it!",
      scene: `${flip([eyes(OJO_ARCO, 6), eyes(OJO_CORAZON, 4)], "1.4s")}${spr(SONRISOTA, 19, 11)}
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
    {
      // El postre de la comilona: se comió tu voz y ahora la devuelve. Sólo
      // sale detrás de la carita del Pac-Man (el HUD las encadena), nunca al
      // azar. La boca se abre un cuarto del bucle, justo cuando sale el aire:
      // por eso son tres cuadros cerrados y uno abierto, y los ojos van
      // entrecerrados de gusto hasta que el eructo se los aprieta.
      status: "¡Provechito!",
      scene: `${flip(
        [
          eyes(OJO_MEDIO, 7),
          eyes(OJO_MEDIO, 7),
          eyes(OJO_MEDIO, 7),
          eyes(OJO_ARCO, 6),
        ],
        "1.2s",
      )}
        ${flip(
          [
            spr(BOCA_CHICA, 21, 12),
            spr(BOCA_CHICA, 21, 12),
            spr(BOCA_CHICA, 21, 12),
            spr(BOSTEZO, 19, 10),
          ],
          "1.2s",
        )}
        <g class="a-eructo">${spr(tint(PUFF, "m"), 27, 11)}</g>
        <g class="a-eructo2">${spr(tint(PUNTO, "m"), 28, 12)}</g>`,
    },
  ],

  "no-entendi": [
    {
      // Los ojos caídos se van cayendo un píxel más mientras baja la lágrima.
      status: "No escuché nada, lo siento",
      sad: true,
      shake: true,
      scene: `${flip([eyes(OJO_TRISTE, 6), eyes(OJO_TRISTE, 7)], "1.3s")}${spr(ZIGZAG, 18, 12)}
        <g class="a-gota">${spr(tint(GOTA, "s"), 38, 4)}</g>`,
    },
    {
      status: "¿Me repites?",
      sad: true,
      // Ladear la cabeza sin rotar: un ojo sube, el otro baja y la boca se
      // tuerce. El parpadeo respeta esa asimetría, cada ojo a su altura.
      scene: `${blink(
        spr(OJO, LX, 6) + spr(OJO, RX, 4),
        spr(OJO_LINEA, LX, 8) + spr(OJO_LINEA, RX, 6),
        "2.6s",
      )}${spr(LADEADA, 18, 12)}
        <g class="a-interr">${spr(tint(INTERR, "w"), 39, 3)}</g>`,
    },
    {
      // Avergonzado: no se atreve a abrir del todo los ojos.
      status: "Perdón…",
      sad: true,
      scene: `${flip([eyes(OJO_LINEA, 7), eyes(OJO_MEDIO, 7)], "1.2s")}${spr(BOCA_CHICA, 21, 12)}
        <g class="a-rubor">${spr(tint(CACHETE, "p"), 12, 9)}${spr(tint(CACHETE, "p"), 31, 9)}</g>
        <g class="a-pt1">${spr(PUNTO, 37, 12)}</g><g class="a-pt2">${spr(PUNTO, 41, 12)}</g><g class="a-pt3">${spr(PUNTO, 45, 12)}</g>`,
    },
    {
      // También se reutiliza para los errores de la app. Con el ruido, cada
      // tanto los ojos se le van en aspas.
      status: "Señal perdida",
      sad: true,
      scene: `${flip([eyes(OJO, 5), eyes(OJO, 5), eyes(OJO_ASPA, 4)], ".72s")}${spr(RAYA, 20, 13)}
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

/**
 * Caritas encadenadas: si mientras hablabas salió la comilona (`escuchando`),
 * la respuesta al terminar es el eructo (`listo`) — nunca sale por su cuenta.
 * Se exportan para que el HUD no lleve números mágicos.
 */
export const CARITA_COMILONA = 4;
export const CARITA_ERUCTO = 5;

/**
 * El mareo: tres caritas que **no salen dictando**, sólo mientras colocas la
 * onda y la zarandeas con el ratón. Cada sacudida sube un escalón y no se
 * vuelve atrás hasta que paras: la broma es que se va poniendo peor.
 *
 * Fuera del repertorio normal (`V`) a propósito: son un premio por jugar, no
 * un estado del dictado, y mezclarlas allí las sacaría al azar en mitad de tu
 * trabajo. El catálogo de Ajustes sí las enseña, en su propia sección.
 *
 * Las tres respetan la rejilla de siempre: coordenadas enteras, ojos de 3 px
 * en x=15 y x=27, cara centrada en 22, bucles ≤1,4 s y todo a `steps(1, end)`
 * para que el pixel-art no tiemble. Y cada una estrena su gesto de ojos, que
 * es la regla que las separa: **balancín** (uno sube mientras el otro baja),
 * **pulso** (se abren de golpe y vuelven) y **apretón** (un cuadro de susto y
 * el resto cerrados).
 */
/**
 * Dictado cancelado: te arrepentiste a media frase y no se transcribe nada.
 *
 * Copia la convención del P1 para el rechazo —**girar la cara**, que es como
 * el bicho dice que no cuando no quiere comer— y la de poner el significado en
 * un **símbolo al lado** en vez de en la cara. La cabeza barre de un lado a
 * otro en dos cuadros alternos repetidos cuatro veces, que es la unidad de
 * animación de los tamagotchi de siempre (dos fotogramas, 3-4 repeticiones).
 */
export const CARITA_CANCELADO: Variant = {
  status: "Cancelado",
  scene: `<g class="a-niega">${flip(
    [eyes(OJO_ARCO, 6), eyes(OJO_LINEA, 7)],
    ".72s",
  )}${spr(RAYA, 20, 12)}</g>
    <g class="a-aspa">${spr(tint(ASPA, "w"), 35, 5)}</g>`,
};

// ─── modo lectura: corregir lo que escribiste ───────────────────────────────
//
// No es un dictado, así que no puede parecerlo. Cuando Dicho corrige un texto
// que ya estaba escrito cambia de oficio y se le nota: se va el micrófono, el
// LCD se tiñe de pergamino y saca una pluma de ave.
//
// La pluma va en tres cuadros y no en dos. Con dos parecía un limpiaparabrisas;
// con tres —baja, escribe, sube— se lee que está trazando. La misma lección del
// aro de los ojos: a este tamaño lo que cuenta la historia es el movimiento, no
// el detalle del dibujo.

/** Pluma de ave: barbas anchas arriba, cañón en diagonal y punta abajo a la
 *  izquierda, que es donde toca el papel. Nueve de alto para que la silueta se
 *  lea como pluma y no como palo. */
const PLUMA = [
  "....X....",
  "...XXX...",
  "..XXXXX..",
  "..XX.XX..",
  ".XX.X.XX.",
  ".X..X..X.",
  ".XX.X.XX.",
  ".X..X..X.",
  "..X.X.X..",
  "....X....",
  "....X....",
  "...X.....",
];

/** Lentes de media luna, de bibliotecario: sólo la montura —transparentes— y
 *  puestas bajas, cortando el ojo por la mitad. Nada que ver con los LENTES
 *  oscuros de la carita del DJ, que son cristales macizos y tapan el ojo
 *  entero: aquí el ojo tiene que verse por encima, que es lo que hace que se
 *  lea "está leyendo" y no "se los puso para la foto".
 *
 *  El borde de arriba lleva `o` —color del fondo— justo donde cruza cada ojo.
 *  Sin eso, montura y ojo son del mismo color y están pegados: se funden en un
 *  borrón que parece un cubo con tapa. El hueco es lo que hace que la montura
 *  se lea POR DELANTE del ojo. Es el mismo truco del destello de OJO_BRILLO. */
const LENTES_LECTURA = [
  "XXoooXXXXXXXXXoooXX",
  "X.....X.....X.....X",
  "X.....X.....X.....X",
  ".XXXXX.......XXXXX.",
];

/** El renglón que va dejando la pluma. Crece en los tres cuadros. */
const RENGLON = ["XXXXXXXXXXX"];



/**
 * La carita mientras corrige un texto que ya estaba escrito.
 *
 * Un solo `Variant`, como `CARITA_CANCELADO`: no entra en el sorteo de las 26
 * porque no es un estado del dictado — es otro oficio.
 */
export const LEYENDO: Variant = {
  status: "Corrigiendo…",
  // Los ojos van a media asta y parpadean: leyendo, no escuchando. Ninguna
  // carita de la casa tiene los ojos quietos, y ésta tampoco.
  // El ojo va entero y parpadea —ninguna carita de la casa los tiene quietos— y
  // los lentes le cruzan por la mitad: media luna, como se leen de cerca.
  scene: `${blink(eyes(OJO, 5), eyes(OJO_LINEA, 7), "4s")}${spr(LENTES_LECTURA, 13, 6)}${spr(RAYA, 20, 13)}
    ${flip(
      [
        spr(PLUMA, 30, 2) + spr(["XXX"], 31, 15),
        spr(PLUMA, 33, 3) + spr(["XXXXXX"], 31, 15),
        spr(PLUMA, 36, 2) + spr(RENGLON, 31, 15),
      ],
      ".54s",
    )}`,
};

// ─── el estreno de versión ──────────────────────────────────────────────────
//
// Guion de Luis, en cinco tiempos y 1,8 s, todo DENTRO de la cápsula de
// siempre. Antes era una película de 6 s en una ventana cuadrada de 260x260, y
// se caía por su propio peso: al volverse cuadrada disparaba un resize, el
// resize reescribía la variable CSS --k, y escribir una custom property en un
// ancestro **recrea la animación desde cero** (el gotcha de CLAUDE.md). El
// efecto se saboteaba solo.
//
//   1 · Reposo. La cápsula como siempre, para que lo de después se lea como
//       una interrupción y no como el estado normal.
//   2 · La cápsula se llena de izquierda a derecha, verde menta, a tirones.
//       Mientras: los ojos giran y la boca pasa por tres gestos.
//   3 · Al 100 % la barra se vuelve blanca de golpe y sale la versión en grande.
//   4 · El blanco se funde con el fondo.
//   5 · Vuelve el reposo: la cara se revela píxel a píxel.

/** Ojos girando: un arco de celdas dando la vuelta a un aro de 3x3. Cuatro
 *  cuadros son una vuelta.
 *
 *  **No es un espiral dibujado**, y no por pereza: ya se probó dos veces y las
 *  dos salió mal. En OJO_ASPA está escrito que un remolino "a 5 px se leía como
 *  una letra G", y en MAREO que "el espiral clásico a 3 px se convierte en una
 *  mancha". Lo que sí lee como rotación a este tamaño es que el ojo se quede
 *  quieto y lo que se mueva sea dónde está encendido. */
const ARO = [
  ["XXX", "..X", "..."],
  ["..X", "..X", ".XX"],
  ["...", "X..", "XXX"],
  ["XX.", "X..", "X.."],
];
/** En contrafase, media vuelta de diferencia. Dos arcos girando a la vez y en
 *  la misma posición se leen como un desplazamiento lateral, no como un giro:
 *  es la misma lección del balancín de MAREO. */
const OJOS_GIRO = ARO.map((_, i) => spr(ARO[i], LX, 6) + spr(ARO[(i + 2) % 4], RX, 6));

/** El barrido del revelado: 12 ms por diagonal, arrancando en el 80 % de 1,8 s.
 *  Va por `x + y` en coordenadas absolutas y no por índice del sprite: por
 *  índice, cada spr() empezaría en cero y los dos ojos y la boca aparecerían a
 *  la vez, como tres manchas. En diagonal hay un solo frente de onda cruzando
 *  la tira. Literales y no variables CSS, por el gotcha de siempre. */
const REVELA_PASO = 0.012;
const REVELA_INI = 1.44 - 20 * REVELA_PASO;
const revelado = (x: number, y: number) =>
  `animation-delay:${(REVELA_INI + (x + y) * REVELA_PASO).toFixed(3)}s`;

/** La cara de reposo. Se pinta con el pincel que le pasen —normal o con
 *  retrasos— para no tener que dibujarla dos veces. */
const CARA_REPOSO = (px: (m: string[], ox: number, oy: number) => string) =>
  px(OJO_BRILLO, LX, 5) + px(OJO_BRILLO, RX, 5) + px(SONRISA, 18, 12);

export const ACTUALIZADO: Variant = {
  // El número va en grande dentro del destello blanco, así que aquí la
  // pantallita dice lo de siempre y entra fundiéndose con el micro.
  status: "Dicho",
  scene: `<g class="u-ini">${CARA_REPOSO(spr)}</g>
    <g class="u-carga">
      ${flip(OJOS_GIRO, ".36s")}
      ${flip([spr(ZIGZAG, 18, 12), spr(BOCA_O, 20, 11), spr(SONRISA_LADO, 18, 12)], ".72s")}
    </g>
    <g class="u-fin">${CARA_REPOSO((m, ox, oy) => spr(m, ox, oy, revelado))}</g>`,
};

/**
 * Boca abierta de risa, con los dientes en **una sola banda corrida**.
 *
 * Los dientes picados uno a uno (XoXoXoXoX) fue el primer intento y hubo que
 * tirarlo: a 11 px de ancho no se leen como dentadura, se leen como una boca
 * de terror. Una banda entera de fondo bajo el labio de arriba es como lo
 * resuelven los sprites de 8 bits de toda la vida, y además cuesta menos.
 *
 * La silueta tampoco puede ir en pico. Probada con la forma de SONRISOTA
 * —ancha arriba y estrechando hacia abajo— salía un cuenco: en una boca
 * cerrada ese pico **es** la sonrisa, pero en una abierta el pico pasa a ser el
 * hueco de dentro, y un hueco triangular no se lee como boca.
 *
 * Y lo que faltaba, que es lo que la arreglaba de verdad: **el interior va
 * hueco**. Con una banda de dientes encima de una mancha maciza sigue siendo
 * una cajita; el hueco de dentro *es* la boca abierta, y la banda pasa a ser
 * dentadura porque hay algo detrás. No es salirse del estilo — BOSTEZO, CUENCA
 * y MARCO ya se dibujan huecos.
 *
 * Detalles que no son adorno: la banda de dientes ocupa **dos filas** (con una
 * sola no tiene grosor) y las paredes también, porque el resto de la carita
 * está dibujada con trazo grueso y una pared de 1 px se ve endeble al lado.
 */
const BOCAZA_DIENTES = [
  "XXXXXXXXXXX",
  "XXXXXXXXXXX",
  "XX.......XX",
  "XX.......XX",
  ".XX.....XX.",
  "..XXXXXXX..",
];

/**
 * Brazo en alto: la manita arriba y el antebrazo bajando **recto**, pegado a
 * la cara.
 *
 * Se descartaron tres formas antes: en diagonal larga salían dos corchetes,
 * corta salían dos piedrecitas, y la manita suelta sin brazo salían dos orejas.
 * A esta escala una vertical gruesa es lo único que se lee como brazo — la
 * diagonal no es una línea inclinada, es una escalera, y una escalera no es una
 * forma sino ruido.
 *
 * Pero vertical no bastaba. De cinco filas seguía leyéndose como un corchete en
 * la esquina, y lo que lo cambió fueron dos cosas más: que sea **largo y toque
 * la vagoneta** —un brazo que no llega a ningún cuerpo es un adorno flotando— y
 * el **entalle de muñeca**, la mano 2 px más ancha con el brazo estrechando
 * detrás. Sin el entalle, mano y brazo son una sola barra.
 */
const BRAZO = [
  "XXXX",
  "XXXX",
  ".XX.",
  ".XX.",
  ".XX.",
  ".XX.",
  ".XX.",
  ".XX.",
  ".XX.",
  ".XX.",
  ".XX.",
];

/** El mismo sprite del revés, para el otro brazo. */
const espejo = (m: string[]) => m.map((r) => [...r].reverse().join(""));

/**
 * La vagoneta, a ras de suelo: los costados asomando, el borde y las ruedas.
 *
 * Empezó siendo una caja de cinco filas y había que elegir entre el carrito y
 * la cara: con la caja puesta, la cara quedaba aplastada contra ella y el
 * conjunto se leía como una carita encima de una mesa. Tres filas bastan para
 * decir "va montada en algo" y dejan el lienzo para el bicho, que es lo que
 * hay que mirar.
 */
const VAGONETA = [
  "X.........................X",
  "XXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "...XXX...............XXX...",
];

/**
 * El brazo con el que se limpia la boca, entrando desde el borde derecho: la
 * mano por delante, más gorda, y el antebrazo detrás **hasta salirse del
 * lienzo**.
 *
 * Que llegue al borde es lo que lo salva, y costó dos intentos descubrirlo. Un
 * sprite de brazo suelto a la altura de la boca no se lee como brazo: la
 * primera versión (barra con escalón) parecía una linterna y la segunda (barra
 * redondeada) parecía una segunda boca. Anclado al borde ya no hay ambigüedad —
 * es algo que **entra**, y entonces la mano de delante dice en qué dirección.
 *
 * @param x dónde queda la mano; el antebrazo rellena solo hasta el borde.
 */
const brazoLimpia = (x: number) => {
  const largo = 48 - x - 5;
  return (
    // El puño, dos filas más alto que el brazo por arriba y por abajo.
    spr([".XXX.", "XXXXX", "XXXXX", ".XXX."], x, 10) +
    // El antebrazo. La fila de arriba se salta dos píxeles justo detrás del
    // puño: ése es el entalle de la muñeca, y sin él puño y brazo se leen como
    // una sola barra.
    spr(["..".padEnd(largo, "X")], x + 5, 11) +
    spr(["X".repeat(largo)], x + 5, 12) +
    // El codo, doblando hacia abajo contra el borde. Es lo único que separa un
    // brazo cruzando la cara de un bigote puesto encima.
    spr(["XX", "XX", "XX"], 46, 13)
  );
};

/**
 * Arrastrando la onda: va montada en la vagoneta y lo está pasando bien.
 *
 * Es el **escalón cero** de la escalada del zarandeo. Arrastrándola con
 * suavidad se queda aquí; moviéndola mucho entra el mareo, que cuenta el resto
 * de la historia sin cambiar de escenario — sigue en el mismo carrito.
 *
 * Fuera de `V` como el mareo: no es un estado del dictado y no puede salir en
 * el sorteo de las 26.
 */
export const RODANDO: Variant = {
  status: "¡Yujuuu!",
  // Los brazos: el izquierdo en x=9 y el derecho en x=32. **No es a ojo**: la
  // cara se centra en x=22, así que el espejo de una columna p es 44-p, y un
  // sprite de 4 de ancho que empieza en 9 tiene su espejo empezando en 32.
  // Puesto en 35 —que es el error fácil, espejar el origen en vez del tramo—
  // el brazo derecho queda tres píxeles más fuera que el izquierdo.
  //
  // El saludo va de **dos** píxeles y no de uno. Con uno la diferencia entre los
  // dos cuadros era tan chica que no se leía como agitar la mano, se leía como
  // que el dibujo tiembla.
  scene: `<g class="a-vagon">${spr(VAGONETA, 9, 15)}
    ${flip([eyes(OJO_ANCHO, 3), eyes(OJO_ANCHO, 4)], ".48s")}
    ${spr(BOCAZA_DIENTES, 17, 9)}
    ${flip(
      [
        spr(BRAZO, 9, 3) + spr(espejo(BRAZO), 32, 5),
        spr(BRAZO, 9, 5) + spr(espejo(BRAZO), 32, 3),
      ],
      ".3s",
    )}</g>`,
};

export const MAREO: Variant[] = [
  {
    // 1 · Mareada. Los ojos hacen balancín en contrafase —el izquierdo arriba
    // mientras el derecho abajo— que es lo que de verdad lee como "todo me da
    // vueltas"; el espiral clásico a 3 px se convierte en una mancha. La cara
    // entera se bambolea un píxel a cada lado y dos chispas le giran encima.
    status: "Me mareas",
    scene: `<g class="a-mareo">${flip(
      [
        spr(OJO, LX, 5) + spr(OJO_MEDIO, RX, 7),
        spr(OJO_MEDIO, LX, 6) + spr(OJO_MEDIO, RX, 6),
        spr(OJO_MEDIO, LX, 7) + spr(OJO, RX, 5),
        spr(OJO_MEDIO, LX, 6) + spr(OJO_MEDIO, RX, 6),
      ],
      "1.28s",
    )}${spr(ZIGZAG, 18, 12)}</g>
      <g class="a-orb1">${spr(tint(CHISPITA, "w"), 37, 3)}</g>
      <g class="a-orb2">${spr(tint(CHISPITA, "w"), 37, 3)}</g>`,
  },
  {
    // 2 · Aguantándose. Cuatro tiempos que cuentan la historia entera: boca
    // sellada, se llena, se llena del todo, y el trago —los carrillos
    // desaparecen de golpe, la boca se hace chiquita y la cara baja un píxel—.
    // Los ojos pulsan de 3 a 5 px de ancho al doble de ritmo: es el esfuerzo
    // de no soltarlo. La gota de sudor, en la sien, remata la idea.
    status: "¡Aguanta!",
    scene: `<g class="a-glup">${flip(
      [eyes(OJO, 5), eyes(OJO_ANCHO, 5), eyes(OJO, 5), eyes(OJO_ANCHO, 5)],
      ".64s",
    )}${flip(
      [
        spr(RAYA, 20, 12),
        // La raya de la boca sigue dentro del bulto: sin ella el hueco se leía
        // como una bocaza abierta, que es justo lo contrario de aguantarse.
        spr(CARRILLOS_MEDIO, 17, 11) + spr(RAYA, 20, 12),
        spr(CARRILLOS_LLENO, 15, 10) + spr(RAYA, 20, 12),
        spr(BOCA_CHICA, 21, 12),
      ],
      "1.28s",
    )}</g>
      <g class="a-sudor">${spr(tint(GOTA, "s"), 33, 4)}</g>`,
  },
  {
    // 3 · Ya no aguantó. Cinco tiempos, que es una historia y no un gesto: el
    // "ay, no" con los ojos de par en par, la boca abriéndose, el chorro, y al
    // final **se limpia la boca con la manita** mientras el charco se queda ahí.
    // Los tamagotchi ponen el significado en el símbolo de al lado y no en la
    // cara: por eso el charco vive fuera, en el suelo, y no encima del bicho.
    status: "¡Blegh!",
    scene: `<g class="a-arcada">${flip(
      [
        eyes(OJO_ANCHO, 5),
        eyes(OJO_ARCO, 6),
        eyes(OJO_ARCO, 6),
        eyes(OJO_ARCO, 6),
        eyes(OJO_MEDIO, 7),
      ],
      "1.4s",
    )}${flip(
      [
        spr(BOCA_O, 20, 11),
        spr(BOSTEZO, 19, 10),
        spr(BOSTEZO, 19, 10),
        spr(BOSTEZO, 19, 10),
        // El último cuadro: la boca ya chica, y nada más.
        //
        // Aquí hubo una manita limpiándosela y **se leía como una segunda
        // boca**: `MANO` y `BOCA_CHICA` son el mismo sprite —un bloque de
        // 3×2— y estaban a una sola columna de distancia. Dos bloques
        // idénticos separados por un píxel no son una cara limpiándose, son
        // dos bocas. Se quita y ya está: de limpiarse se encarga el cuadro
        // siguiente, que es una escena entera dedicada a eso.
        spr(BOCA_CHICA, 21, 12),
      ],
      "1.4s",
    )}</g>
      <g class="a-vom1">${spr(tint(PUFF, "m"), 26, 12)}</g>
      <g class="a-vom2">${spr(tint(PUFF, "m"), 26, 12)}</g>
      <g class="a-vom3">${spr(tint(PUNTO, "m"), 26, 13)}</g>
      <g class="a-escurre">${spr(tint(ESCURRE, "m"), 25, 14)}</g>
      <g class="a-charco1">${spr(tint(CHARCO_CHICO, "m"), 31, 15)}</g>
      <g class="a-charco2">${spr(tint(CHARCO, "m"), 30, 15)}</g>`,
  },
  {
    // 4 · Se limpia y se le pasa. No es un escalón más del zarandeo —a éste no
    // se llega meneando, se llega **después** del vómito— pero vive en la misma
    // lista porque es el final de la misma historia, y así el HUD sigue
    // teniendo un solo índice que mover.
    //
    // El antebrazo cruza la boca entero en tres tiempos: llega por la
    // izquierda con la boca aún sucia, la tapa, y sale por la derecha dejándola
    // limpia. Los ojos van apretados durante la pasada y se abren al final: es
    // lo que convierte el gesto en "ya está" en vez de en un brazo que pasa.
    //
    // De aquí **no se corta a la carita de siempre**: el HUD funde la pantalla
    // (`.fundido`) y cambia por debajo. Un corte seco después de vomitar se
    // veía como un fallo de dibujo, no como que se le pasó.
    status: "Ya, ya…",
    scene: `${flip(
      [
        eyes(OJO_LINEA, 7) +
          spr(BOCA_CHICA, 21, 12) +
          spr(tint(["XXX"], "m"), 24, 14) +
          brazoLimpia(31),
        eyes(OJO_LINEA, 7) + spr(BOCA_CHICA, 21, 12) + brazoLimpia(15),
        eyes(OJO_ARCO, 6) + spr(RAYA, 20, 12) + brazoLimpia(31),
      ],
      ".9s",
    )}`,
  },
];

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
      // Longhands y no el atajo `animation`: el atajo reinicia
      // `animation-duration` a 0s y la duración viaja inline en cada fotograma.
      // El .8s de aquí es sólo el respaldo por si algún sprite no la trae.
      css += `  .flip${n} > g:nth-child(${i + 1}) { animation-name: fl${n}_${i}; animation-duration: .8s; animation-timing-function: steps(1, end); animation-iteration-count: infinite; }
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
  .tama { width: 336px; height: 74px; border-radius: 999px; padding: 5px;
          background: linear-gradient(180deg, var(--shellA), var(--shellB));
          box-shadow: 0 18px 40px -18px rgba(10, 25, 60, .45), inset 0 1px 0 rgba(255,255,255,.35); }
  .screen { height: 100%; border-radius: 999px; background: var(--lcd);
            border: 1px solid var(--lcdBorder);
            box-shadow: inset 0 3px 10px rgba(10, 20, 40, .25);
            overflow: hidden; position: relative; color: var(--face);
            /* Sin esto, el z-index:-1 de la barra del estreno se cuela por
               detrás de la carcasa y la barra no se ve. Es lo primero que hay
               que mirar si el tiempo 2 sale vacío. */
            isolation: isolate;
            display: flex; align-items: center; gap: 6px;
            /* Los 8 de abajo son el hueco de la cinta de niveles. */
            padding: 0 12px 8px 12px;
            transition: background .25s; }
  .screen::before { content: ""; position: absolute; inset: 0; pointer-events: none;
    background-image: linear-gradient(var(--grid) 1px, transparent 1px),
                      linear-gradient(90deg, var(--grid) 1px, transparent 1px);
    background-size: 3px 3px; }
  /* ── el toggle de redacción, DENTRO de la cápsula ──────────────────────
     Dos casillas contra el borde de abajo del LCD. La curvatura sale gratis:
     .screen ya es una pastilla con overflow oculto, así que los extremos los
     recorta él con su propio radio.

     Es un segmentado al estilo de los de Apple, pero traducido a pixel-art: en
     vez de un pulgar que se desliza —deslizar medio píxel hace temblar el
     dibujo— la pastilla del modo puesto aparece y desaparece de golpe, que es
     la misma regla de steps(1, end) que siguen las caritas.

     En reposo no es un menú: es UNA RAYITA encendida en la casilla del modo
     puesto, izquierda o derecha, con el color de ese modo. Se lee de un vistazo
     sin robarle sitio a la carita. Al pasar el ratón por cualquier parte de la
     cápsula salen los dos nombres con su pastilla.

     Mientras dictas se queda quieta: se sigue viendo, para saber en qué modo
     estás, pero no se despliega ni acepta clics. Cambiar de modo a mitad de un
     dictado no tendría a qué aplicarse. */
  .niveles { position: absolute; left: 0; right: 0; bottom: 0; z-index: 2;
             display: flex; height: 7px; padding: 0 14px; background: transparent;
             transition: height .16s ease-out, background-color .16s; }
  .tama:hover .niveles:not(.quieta), .clasico:hover .niveles:not(.quieta) {
             height: 15px; background: color-mix(in srgb, var(--lcdBorder) 70%, transparent); }
  .niv { flex: 1; display: flex; align-items: center; justify-content: center;
         position: relative; background: transparent; border: 0; padding: 0;
         cursor: pointer; }
  .niv:disabled { cursor: default; }
  /* La pastilla del segmentado. Sólo existe desplegado: en reposo la rayita ya
     dice cuál está puesto y una pastilla de 7 px sería una mancha. */
  .niv::before { content: ""; position: absolute; inset: 1px 3px; border-radius: 999px;
                 background: transparent; }
  .tama:hover .niveles:not(.quieta) .niv[data-on]::before,
  .clasico:hover .niveles:not(.quieta) .niv[data-on]::before {
                 background: color-mix(in srgb, var(--c, var(--a)) 20%, transparent); }
  .tama:hover .niveles:not(.quieta) .niv:hover:not(:disabled):not([data-on])::before,
  .clasico:hover .niveles:not(.quieta) .niv:hover:not(:disabled):not([data-on])::before {
                 background: rgba(127, 145, 175, .22); }
  /* La rayita de reposo, en el color del modo: es lo único que se ve sin ratón
     y por eso cada modo lleva el suyo — si no, izquierda y derecha se
     distinguirían sólo por la posición. */
  .niv-luz { position: relative; height: 2px; width: 34%; border-radius: 2px;
             background: transparent; transition: opacity .12s; }
  .niv[data-on] .niv-luz { background: var(--c, var(--a)); }
  .tama:hover .niveles:not(.quieta) .niv-luz,
  .clasico:hover .niveles:not(.quieta) .niv-luz { opacity: 0; }
  .niv-txt { position: absolute; inset: 0; display: flex; align-items: center;
             justify-content: center; opacity: 0; transition: opacity .16s;
             font: 700 7px/1 Consolas, "Cascadia Mono", monospace;
             letter-spacing: .14em; text-transform: uppercase;
             color: var(--faint); }
  .tama:hover .niveles:not(.quieta) .niv-txt,
  .clasico:hover .niveles:not(.quieta) .niv-txt { opacity: 1; }
  .niv[data-on] .niv-txt { color: var(--c, var(--a)); }
  .niv:disabled .niv-txt { opacity: 0; }
  .tama:hover .niveles:not(.quieta) .niv:disabled .niv-txt,
  .clasico:hover .niveles:not(.quieta) .niv:disabled .niv-txt { opacity: .3; }

  .mic-px { flex-shrink: 0; height: 30px; }
  .mic-px svg { height: 100%; width: auto; shape-rendering: crispEdges; display: block; }
  .scene { flex: 1; height: 50px; min-width: 0; transition: opacity .2s ease-in-out; }
  /* Salir del mareo no es cambiar de carita: es fundir y volver. El HUD pone
     la clase fundido, espera a que la pantalla llegue a cero, cambia la escena por
     debajo y lo quita. Sin esto el bicho pasaba de vomitar a sonreír en un
     fotograma y se leía como un fallo de dibujo. */
  .tama.fundido .scene { opacity: 0; }
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
  /* Pergamino: el mismo truco que la carita triste, pero para el modo lectura. El LCD se
     tiñe de papel viejo y la carita se dibuja en tinta. Que el fondo cambie es
     medio efecto — el otro medio es que desaparezca el micrófono. */
  .tama.leyendo .screen { background: var(--pergamino); border-color: var(--pergaminoBorde); color: var(--tinta);
                          /* El hueco de los sprites se pinta con --lcd. En modo
                             lectura el fondo es papel, así que --lcd tiene que
                             serlo también o los huecos saldrían azules encima
                             del pergamino. */
                          --lcd: var(--pergamino); }
  .tama.leyendo .status { color: var(--tinta); opacity: .75; }
  .tama.sad .status { color: var(--w); }
  .tama.shake { animation: shake .5s steps(1, end); }
  @keyframes shake { 0% { transform: translateX(0); } 12% { transform: translateX(-4px); }
    24% { transform: translateX(4px); } 36% { transform: translateX(-3px); }
    48% { transform: translateX(2px); } 60% { transform: translateX(-1px); }
    72%, 100% { transform: translateX(0); } }

  .flip > g { opacity: 0; }
${FLIP_CSS}
  .blink > g { animation-duration: 3.2s; animation-timing-function: steps(1, end); animation-iteration-count: infinite; }
  .blink > g:nth-child(1) { animation-name: blinkA; }
  .blink > g:nth-child(2) { animation-name: blinkB; }
  @keyframes blinkA { 0% { opacity: 1; } 92% { opacity: 0; } 97% { opacity: 1; } }
  @keyframes blinkB { 0% { opacity: 0; } 92% { opacity: 1; } 97% { opacity: 0; } }
  .wink > g { animation-duration: 1.6s; animation-timing-function: steps(1, end); animation-iteration-count: infinite; }
  .wink > g:nth-child(1) { animation-name: winkA; }
  .wink > g:nth-child(2) { animation-name: winkB; }
  @keyframes winkA { 0% { opacity: 1; } 35% { opacity: 0; } 72% { opacity: 1; } }
  @keyframes winkB { 0% { opacity: 0; } 35% { opacity: 1; } 72% { opacity: 0; } }

  /* Barras y boca movidas por el volumen real de tu voz (--lvl: 0…1). */
  .vu rect { fill: var(--a); transform-box: fill-box; transform-origin: center bottom;
             transition: transform .07s linear; }
  .vu .v1 { transform: scaleY(calc(.16 + var(--lvl, .1) * .55)); }
  .vu .v2 { transform: scaleY(calc(.2 + var(--lvl, .1) * .8)); }
  .vu .v3 { transform: scaleY(calc(.16 + var(--lvl, .1) * .42)); }
  /* La onda que se come el Pac-Man también respira con tu voz: la barra viaja
     en el <g> y el nivel escala el <rect>, así los dos transforms conviven. */
  .a-onda rect { fill: var(--a); transform-box: fill-box; transform-origin: center center;
                 transform: scaleY(calc(.4 + var(--lvl, .1) * .85));
                 transition: transform .07s linear; }

  @keyframes resp { 0% { transform: translateY(0); } 50% { transform: translateY(-1px); } }
  @keyframes mira { 0% { transform: translateX(0); } 30% { transform: translateX(-1px); }
                    60% { transform: translateX(1px); } 90% { transform: translateX(0); } }
  @keyframes asiente { 0% { transform: translateY(0); } 50% { transform: translateY(2px); } }
  @keyframes atento { 0% { transform: translate(0, 0); } 25% { transform: translate(1px, 0); }
                      50% { transform: translate(0, 1px); } 75% { transform: translate(-1px, 0); } }
  /* Mirada pensativa: las pupilas se van arriba y a la izquierda. Arrancan
     en y=6 justo para poder subir sin montarse en el borde de la cuenca. */
  @keyframes piensa { 0% { transform: translate(0, 0); } 30% { transform: translate(0, -1px); }
                      60% { transform: translate(-1px, -1px); } 85% { transform: translate(0, -1px); } }
  /* Releer lo que va saliendo: los ojos barren de izquierda a derecha. */
  @keyframes leer { 0% { transform: translateX(-1px); } 25% { transform: translateX(0); }
                    50% { transform: translateX(1px); } 75% { transform: translateX(0); } }
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

  /* Cabeceo del DJ: sólo baja y va hacia la izquierda. Si se moviera a la
     derecha, el auricular (x=33) chocaría con la primera barra (x=34). */
  @keyframes dj { 0% { transform: translate(0, 0); } 25% { transform: translate(0, 1px); }
                  50% { transform: translate(0, 0); } 75% { transform: translate(-1px, 1px); } }
  /* La onda entra por x=44 y avanza 3 px cada 0.2 s hasta pegarse a la boca
     (x=26), donde desaparece: siete pasos, siete barras, un desfile seguido. */
  @keyframes onda { 0% { transform: translateX(0); opacity: 1; }
                    14.3% { transform: translateX(-3px); opacity: 1; }
                    28.6% { transform: translateX(-6px); opacity: 1; }
                    42.9% { transform: translateX(-9px); opacity: 1; }
                    57.1% { transform: translateX(-12px); opacity: 1; }
                    71.4% { transform: translateX(-15px); opacity: 1; }
                    85.7% { transform: translateX(-18px); opacity: 1; }
                    100% { transform: translateX(-18px); opacity: 0; } }
  /* El eructo aparece al 75 % del bucle, que es cuando la boca se abre. */
  /* El "no" de toda la vida: la cabeza barre de un lado a otro. Tres píxeles
     de recorrido, que con uno parecía un temblor y no una negación. */
  @keyframes niega { 0% { transform: translateX(-3px); } 50% { transform: translateX(3px); } }
  /* El aspa entra de golpe, late una vez y se queda: es la que da el mensaje. */
  @keyframes aspa { 0% { opacity: 0; } 12% { opacity: 1; } 24% { opacity: .35; }
                    36%, 100% { opacity: 1; } }

  /* ── el estreno de versión ────────────────────────────────────────────────
     Un solo reloj de 1,8 s y cada capa entra y sale por porcentajes de ese
     mismo reloj. Las duraciones van literales y con longhands, nunca con el
     atajo animation: el atajo reinicia animation-duration a 0s, y una duración
     en var() se recrearía entera cada vez que algo escriba otra variable CSS.

       0-10 %   reposo, para que lo siguiente se lea como interrupción
       10-50 %  la barra cruza a tirones; ojos girando y tres bocas
       50-64 %  destello blanco con la versión en grande
       64-80 %  el blanco se funde con el fondo
       80-100 % la cara se revela píxel a píxel                              */
  .u-ini, .u-carga, .u-fin, .u-barra, .u-blanco, .u-entra {
    animation-duration: 1.8s;
    animation-iteration-count: 1;
    animation-fill-mode: forwards;
  }

  .u-ini { animation-name: u-ini; animation-timing-function: steps(1, end); }
  @keyframes u-ini { 0%, 10% { opacity: 1; } 11%, 100% { opacity: 0; } }

  .u-carga { opacity: 0; animation-name: u-carga; animation-timing-function: steps(1, end); }
  @keyframes u-carga { 0%, 9% { opacity: 0; } 10%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
  /* Los dos flipbooks arrancan cuando arranca su tiempo, no cuando se monta la
     escena: si no entran a media vuelta y la tercera boca se queda fuera. Un
     ciclo de bocas y dos de ojos caben justos en los 720 ms. */
  .u-carga .flip > g { animation-delay: .18s; }

  /* La barra. Molde de .cinta —scaleX con el origen a la izquierda— pero la
     escala la pone un keyframe y no una variable. A tirones y no lisa: un
     relleno continuo se lee como decoración, a saltos se lee como trabajo.
     El .55 de opacidad NO es decoración: menta maciza contra la cara da 3,8:1
     en claro pero 1,45:1 en oscuro, donde la cara desaparecería. */
  .u-barra { position: absolute; inset: 0; z-index: -1; background: var(--m);
             opacity: .55; transform-origin: left center; transform: scaleX(0);
             animation-name: u-barra; animation-timing-function: steps(1, end); }
  @keyframes u-barra {
    0%, 10% { transform: scaleX(0); }
    16% { transform: scaleX(.14); }
    22% { transform: scaleX(.22); }
    29% { transform: scaleX(.48); }
    36% { transform: scaleX(.55); }
    43% { transform: scaleX(.84); }
    50% { transform: scaleX(1); opacity: .55; }
    52%, 100% { transform: scaleX(1); opacity: 0; }
  }

  /* El destello, con el número dentro: así se funden juntos sin un segundo
     keyframe. El color del texto va literal y no en var(--face) porque en tema
     oscuro --face es casi blanco y desaparecería sobre el destello. */
  .u-blanco { position: absolute; inset: 0; z-index: 1; display: flex;
              align-items: center; justify-content: center;
              background: #fff; color: #16223a; opacity: 0;
              font: 700 24px/1 Consolas, "Cascadia Mono", monospace;
              letter-spacing: .04em;
              animation-name: u-blanco; animation-timing-function: linear; }
  @keyframes u-blanco { 0%, 49% { opacity: 0; } 50%, 64% { opacity: 1; } 80%, 100% { opacity: 0; } }

  /* El revelado: cada píxel se enciende con su propio retraso. Un fundido corto
     y no un salto — a pelo con steps se lee como tartamudeo. */
  .u-fin rect, .u-px { opacity: 0; animation-name: u-px; animation-duration: .09s;
    animation-timing-function: linear; animation-iteration-count: 1;
    animation-fill-mode: forwards; }
  @keyframes u-px { from { opacity: 0; } to { opacity: 1; } }

  /* Lo que vuelve fundiéndose al final: el micro, el texto y la cinta. */
  .u-entra { opacity: 0; animation-name: u-entra; animation-timing-function: linear; }
  @keyframes u-entra { 0%, 80% { opacity: 0; } 100% { opacity: 1; } }

  /* ── el mareo, sólo al zarandear la onda mientras la colocas ───────────── */
  /* Bamboleo: un píxel a cada lado. Con dos ya no parecía mareo sino temblor. */
  @keyframes vagoneta { 0% { transform: translateY(0); }
                        25% { transform: translate(1px, -1px); }
                        50% { transform: translateY(0); }
                        75% { transform: translate(-1px, 1px); } }
  @keyframes mareo { 0% { transform: translateX(-1px); } 25% { transform: translateX(0); }
                     50% { transform: translateX(1px); } 75% { transform: translateX(0); } }
  /* Las chispas dan la vuelta por las cuatro esquinas de un cuadrado de 4 px:
     en pixel-art un círculo de verdad se sale de la rejilla entera. */
  @keyframes orbita { 0% { transform: translate(0, 0); } 25% { transform: translate(4px, 2px); }
                      50% { transform: translate(0, 4px); } 75% { transform: translate(-4px, 2px); } }
  /* El trago: la cara aguanta arriba y en el último cuarto baja de golpe. */
  @keyframes glup { 0%, 74% { transform: translateY(0); }
                    75%, 88% { transform: translateY(1px); }
                    89%, 100% { transform: translateY(0); } }
  /* La gota de sudor resbala y desaparece antes de llegar a la boca. */
  @keyframes sudor { 0% { transform: translateY(0); opacity: 0; }
                     20% { opacity: 1; } 50% { transform: translateY(2px); }
                     80% { transform: translateY(4px); opacity: 1; }
                     100% { transform: translateY(5px); opacity: 0; } }
  /* La arcada: se echa atrás para tomar impulso y luego va hacia adelante. */
  @keyframes arcada { 0%, 20% { transform: translate(0, 0); }
                      25% { transform: translate(0, -1px); }
                      30%, 100% { transform: translate(0, 1px); } }
  /* El chorro sale en el mismo cuadro en que la boca se abre (20 %) y describe
     un arco hacia la derecha y abajo. En arco y no en caída recta porque la
     pantalla sólo tiene 16 px de alto (y=2 a 17) y la boca ya acaba en y=14:
     cayendo a plomo se salía del lienzo antes de leerse. */
  @keyframes vomito { 0%, 18% { transform: translate(0, 0); opacity: 0; }
                      20% { transform: translate(0, 0); opacity: 1; }
                      32% { transform: translate(2px, 1px); }
                      44% { transform: translate(4px, 2px); }
                      56% { transform: translate(6px, 3px); }
                      68% { transform: translate(8px, 4px); opacity: 1; }
                      76%, 100% { transform: translate(9px, 5px); opacity: 0; } }
  /* El hilo que queda colgando de la comisura, y que se corta al limpiarse. */
  @keyframes escurre { 0%, 24% { transform: scaleY(0); opacity: 0; }
                       28% { transform: scaleY(.34); opacity: 1; }
                       44% { transform: scaleY(.67); }
                       60%, 74% { transform: scaleY(1); opacity: 1; }
                       78%, 100% { transform: scaleY(1); opacity: 0; } }
  /* El charco no se va: aparece cuando aterriza el primer chorro, crece con el
     segundo y se queda hasta el final del ciclo. */
  @keyframes charco { 0%, 36% { opacity: 0; } 40%, 100% { opacity: 1; } }
  @keyframes charco2 { 0%, 60% { opacity: 0; } 64%, 100% { opacity: 1; } }

  @keyframes eructo { 0% { transform: translate(0, 0); opacity: 0; }
                      75% { transform: translate(0, 0); opacity: 1; }
                      81% { transform: translate(2px, -1px); opacity: 1; }
                      87% { transform: translate(4px, -2px); opacity: 1; }
                      93% { transform: translate(6px, -3px); opacity: 1; }
                      100% { transform: translate(8px, -4px); opacity: 0; } }

  .a-resp { animation: resp 2s steps(1, end) infinite; }
  .a-mira { animation: mira 2.4s steps(1, end) infinite; }
  .a-asiente { animation: asiente .8s steps(1, end) infinite; }
  .a-atento { animation: atento .9s steps(1, end) infinite; }
  .a-busca { animation: busca 1.2s steps(1, end) infinite; }
  .a-piensa { animation: piensa 1.6s steps(1, end) infinite; }
  .a-leer { animation: leer .52s steps(1, end) infinite; }
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
  .a-dj { animation: dj .8s steps(1, end) infinite; }
  .a-niega { animation: niega .36s steps(1, end) infinite; }
  .a-aspa { opacity: 0; animation: aspa 1.44s steps(1, end) infinite; }
  /* El carrito sobre el riel: sube y baja un píxel en diagonal, que es lo que
     lee como "va rodando" sin mover la cara de sitio. */
  .a-vagon { animation: vagoneta .48s steps(1, end) infinite; }
  .a-mareo { animation: mareo .32s steps(1, end) infinite; }
  .a-orb1 { animation: orbita 1.28s steps(1, end) infinite; }
  /* Media vuelta por detrás: se leen como una sola chispa dando vueltas. */
  .a-orb2 { opacity: .55; animation: orbita 1.28s steps(1, end) .64s infinite; }
  .a-glup { animation: glup 1.28s steps(1, end) infinite; }
  .a-sudor { opacity: 0; animation: sudor 1.28s steps(1, end) infinite; }
  .a-arcada { animation: arcada 1.4s steps(1, end) infinite; }
  .a-vom1, .a-vom2, .a-vom3 { opacity: 0; animation: vomito 1.4s steps(1, end) infinite; }
  /* Escalonados por medio paso cada uno: se leen como un chorro y no como tres
     bolas sueltas. */
  .a-vom2 { animation-delay: .06s; }
  .a-vom3 { animation-delay: .12s; }
  .a-escurre { opacity: 0; transform-box: fill-box; transform-origin: center top;
               animation: escurre 1.4s steps(1, end) infinite; }
  .a-charco1 { opacity: 0; animation: charco 1.4s steps(1, end) infinite; }
  .a-charco2 { opacity: 0; animation: charco2 1.4s steps(1, end) infinite; }

  .a-onda > g { opacity: 0; animation: onda 1.4s steps(1, end) infinite; }
  .a-eructo, .a-eructo2 { opacity: 0; animation: eructo 1.2s steps(1, end) infinite; }
  /* Dos pasos exactos (2 × 6 % de 1,2 s) por detrás de la burbuja grande:
     la chica va saliendo de la boca mientras la otra ya se aleja. */
  .a-eructo2 { animation-delay: .144s; }
`;

/** Nombre y momento de cada estado, para el catálogo de Ajustes. */
export const ESTADOS: { key: FaceState; titulo: string; cuando: string }[] = [
  { key: "escuchando", titulo: "Te escucho", cuando: "Mientras mantienes pulsado el atajo. El DJ y la comilona se mueven con el volumen real de tu voz." },
  { key: "pensando", titulo: "Escribiendo", cuando: "Transcribiendo y puliendo lo que dijiste (1-3 s)." },
  { key: "listo", titulo: "Listo", cuando: "Con el texto ya pegado. La de los lentes sale cuando el dictado va en español, y el eructo sólo si antes te salió la carita comilona." },
  { key: "no-entendi", titulo: "No entendí", cuando: "El audio venía mudo o no se entendió nada." },
  { key: "reposo", titulo: "En reposo", cuando: "El instante antes de empezar a grabar." },
];
