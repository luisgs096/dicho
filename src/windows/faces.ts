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
  /** Vuelve a sortear la escena. Solo lo traen las historias largas de
   *  stand-by, que cambian de tirada cada vez que el HUD las saca. */
  fresco?: () => string;
  /** Pide que el HUD le mande donde esta el cursor en `--mx` y `--my`. Solo lo
   *  trae la carita de los ojos que te siguen: mientras no este a la vista, no
   *  se le pregunta a Windows nada. */
  sigue?: boolean;
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

/** El mismo sprite del revés, para el otro brazo. */
const espejo = (m: string[]) => m.map((r) => [...r].reverse().join(""));

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
/**
 * Lo que le cuelga de la boca después de la tercera arcada.
 *
 * Antes era un hilo de 1 px —`["X","X","X"]`— y a este tamaño un píxel de ancho
 * no se lee como líquido: se lee como una raya, o como suciedad de la pantalla.
 * Esto es ancho arriba (pegado al labio), estrecha, y acaba en un goterón. Ese
 * remate es lo que lo convierte en algo que **pesa**; sin él, cualquier forma
 * alargada sigue siendo una raya.
 */
const PLASTA = [
  "XXXXX",
  "XXXXX",
  ".XXXX",
  ".XXX.",
  ".XXX.",
  "XXXX.",
  "XXXX.",
];

/** El charco más grande de los tres, el de la tercera. */
const CHARCO_GRANDE = ["..XXXXXX..", ".XXXXXXXX.", "XXXXXXXXXX"];
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

/**
 * # Historias largas de stand-by
 *
 * `flip()` reparte el tiempo **en partes iguales** y tiene tope de doce cuadros.
 * Sirve para un gesto, no para una historia de un minuto: con partes iguales no
 * puedes mascar cuatro veces de un lado y dos del otro, y con doce cuadros no
 * llegas ni a la mitad.
 *
 * `secuencia()` es lo mismo pero con **duraciones libres por cuadro** y sin
 * tope. Como cada historia se sortea al vuelo, sus fotogramas no pueden vivir en
 * `FACE_CSS` -que es fijo-, asi que se generan y viajan en un `<style>` dentro
 * de la propia escena. Es legal en SVG y cada historia usa nombres propios.
 *
 * ## Lo que ensenan los tamagotchi de verdad
 *
 * El reposo es **el 90 % del tiempo** que la mascota esta a la vista, asi que es
 * donde hay que gastar el presupuesto de animacion. Y su idioma no es una
 * pelicula larga: es **un bucle corto de dos cuadros repetido un numero variable
 * de veces** -en los originales, la reaccion de "close up" alterna dos cuadros
 * tres o cuatro veces- interrumpido de vez en cuando por un evento. Los bucles
 * largos que se ven en las reimplementaciones modernas rondan los 70 s y estan
 * hechos asi: tramos largos de casi nada con dos o tres sucesos dentro.
 *
 * De ahi salen las tres reglas de estas historias:
 *
 * 1. **El bucle base es corto y se repite un numero de veces que cambia.** Lo
 *    que rompe la repeticion no es tener muchos dibujos, es que el mismo dibujo
 *    dure distinto cada vez.
 * 2. **Los eventos escalan.** Si el suceso es siempre igual, la tercera vez ya
 *    no es un suceso. Por eso la bomba crece de nivel en nivel y revienta en el
 *    tercero.
 * 3. **El final no siempre es el mismo.** Con un unico desenlace, la historia se
 *    gasta a la segunda vuelta.
 */
type Paso = { v: string; ms: number };

let seqN = 0;

/**
 * Un flipbook de duraciones libres. Devuelve el `<style>` con sus fotogramas y
 * el grupo con un `<g>` por paso.
 *
 * Igual que `flip()`, usa `steps(1, end)` y longhands, y la duracion viaja
 * **inline y literal**: en cuanto viva en una variable CSS, escribir cualquier
 * otra variable en un ancestro -`--lvl`, el volumen de la voz- recrea la
 * animacion desde cero y la historia vuelve a empezar cada fotograma.
 */
const secuencia = (pasos: Paso[]): string => {
  const total = pasos.reduce((a, x) => a + x.ms, 0);
  const id = `sq${seqN++}`;
  const seg = (total / 1000).toFixed(3);
  // Un <g> por DIBUJO, no por paso. Una historia repite mucho los mismos
  // cuadros —mascar es alternar dos— y cada paso copiaba el dibujo entero: el
  // chicle eran 83 pasos para 32 dibujos distintos, ~5.000 nodos en el DOM y
  // ~13 MB del renderer. Aquí cada dibujo sale una vez y su keyframe lleva
  // todas las ventanas en que se ve. Se ve igual: los gestos anidados arrancan
  // todos al montar, así que siguen en fase como antes.
  const tramos = new Map<string, [number, number][]>();
  let t = 0;
  for (const paso of pasos) {
    const ini = t;
    t += paso.ms;
    const l = tramos.get(paso.v) ?? [];
    const ult = l[l.length - 1];
    // Dos pasos iguales seguidos no deberían darse, pero si se dan son un tramo.
    if (ult && ult[1] === ini) ult[1] = t;
    else l.push([ini, t]);
    tramos.set(paso.v, l);
  }
  const pct = (ms: number) => ((ms / total) * 100).toFixed(4);
  let css = "";
  let cuerpo = "";
  let i = 0;
  for (const [v, l] of tramos) {
    let k = l[0][0] === 0 ? "" : "0%{opacity:0}";
    for (const [a, z] of l) {
      k += `${pct(a)}%{opacity:1}`;
      if (z < total) k += `${pct(z)}%{opacity:0}`;
    }
    if (l[l.length - 1][1] < total) k += "100%{opacity:0}";
    css += `@keyframes ${id}_${i}{${k}}`;
    cuerpo +=
      `<g style="animation-name:${id}_${i};animation-duration:${seg}s;` +
      `animation-timing-function:steps(1,end);animation-iteration-count:infinite">` +
      `${v}</g>`;
    i++;
  }
  return `<style>${css}</style><g class="seq">${cuerpo}</g>`;
};

/** Entero al azar en [0, n). */
const azar = (n: number) => Math.floor(Math.random() * n);
/** Entero al azar entre a y b, los dos incluidos. */
const entre = (a: number, b: number) => a + azar(b - a + 1);
/** Uno de la lista, al azar. */
const uno = <T,>(xs: T[]) => xs[azar(xs.length)];

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

// ─── reposo: el chicle ──────────────────────────────────────────────────────
//
// La carita de stand-by. No es un gesto, es **lo que hace cuando no pasa nada**,
// y por eso tiene que aguantar un minuto sin que se note el bucle.
//
// El ciclo es siempre el mismo y aun asi no se repite: masca una temporada,
// infla una bomba **que se ve crecer**, la revienta sin despeinarse y vuelve a
// mascar, cada vez un poco mas. Una de cada siete veces la bomba no para de
// crecer y **le revienta en la cara**: esa es la rara, la que se cuenta.
//
// # Aqui entra el color, y no rompe nada
//
// El chicle es **rosa** (`p`), y eso ya existia en el lenguaje: el vomito es
// menta, la lengua rosa y la barandilla azul. La regla que se mantiene es la de
// siempre: el color nunca *sustituye* a la forma, solo la acompana. Si le quitas
// el color, la animacion se sigue entendiendo.

/** La bolita de chicle antes de entrar en la boca. */
const CHICLE_BOLA = ["XX", "XX"];

/**
 * La escalera de la bomba: **cinco tamanos**, todos apoyados en la boca.
 *
 * Cinco y no tres porque inflar tiene que **verse**. Con tres saltos, la bomba
 * aparecia casi hecha y el crecimiento se leia como un cambio de dibujo; con
 * cinco, cada salto es pequeno y lo que se lee es que se esta inflando. Es la
 * misma razon por la que los brazos pasaron de dos poses a ocho: **una
 * alternancia no es un movimiento**.
 *
 * Van **macizas**, al reves que la boca abierta, y eso es por el color: sin
 * color, el hueco era lo unico que distinguia un volumen de una mancha; con
 * color, un aro rosa se lee como un anillo y un disco rosa como un globo.
 *
 * El brillo es un hueco de 2x1 **arriba y a la izquierda**, descentrado a
 * proposito: centrado se leeria como una pupila, que es una regla ya escrita.
 * En la mas chica no cabe y no lleva.
 *
 * Todas crecen **hacia arriba** desde la boca, porque debajo de la boca solo
 * quedan cuatro filas de lienzo y no cabe nada. Las dos mayores tapan los ojos,
 * asi que en esas los ojos se dibujan **encima**.
 */
const BOMBA_1 = [".X.", "XXX", ".X."];
const BOMBA_2 = [".XXX.", "XooXX", "XXXXX", "XXXXX", ".XXX."];
const BOMBA_3 = [
  "..XXX..",
  ".XXXXX.",
  "XooXXXX",
  "XXXXXXX",
  "XXXXXXX",
  ".XXXXX.",
  "..XXX..",
];
const BOMBA_4 = [
  "...XXX...",
  ".XXXXXXX.",
  ".XooXXXX.",
  "XXXXXXXXX",
  "XXXXXXXXX",
  "XXXXXXXXX",
  ".XXXXXXX.",
  ".XXXXXXX.",
  "...XXX...",
];
const BOMBA_5 = [
  "....XXXXX....",
  "..XXXXXXXXX..",
  ".XXXXXXXXXXX.",
  ".XXooXXXXXXX.",
  "XXXXXXXXXXXXX",
  "XXXXXXXXXXXXX",
  "XXXXXXXXXXXXX",
  ".XXXXXXXXXXX.",
  ".XXXXXXXXXXX.",
  "..XXXXXXXXX..",
  "....XXXXX....",
];

/** Cada peldano con su sitio: centrados en x=22 y apoyados en la boca (y=13). */
const ESCALERA: [string[], number, number][] = [
  [BOMBA_1, 21, 11],
  [BOMBA_2, 20, 9],
  [BOMBA_3, 19, 7],
  [BOMBA_4, 18, 5],
  [BOMBA_5, 16, 3],
];

/**
 * El reventon limpio: cuatro pares de esquirlas apuntando hacia fuera.
 *
 * Pocas y largas. La primera version era una trama tupida y salia un garabato: a
 * este tamano lo que se lee como explosion no es la cantidad de piezas, es que
 * **apunten todas desde un centro comun**.
 */
const ESQUIRLAS = [
  "..X.....X..",
  "X..X...X..X",
  "...........",
  "XX.......XX",
  "...........",
  "X..X...X..X",
  "..X.....X..",
];

/** Esquirlas chicas, para cuando revienta una bomba de las pequenas. */
const ESQUIRLAS_MINI = ["X..X..X", ".......", "X.....X", ".......", "X..X..X"];

/** El chicle pegado en la cara: solo sale cuando revienta la gigante. */
const PEGOTE_IZQ = ["XXX", ".XX"];
const PEGOTE_DER = ["XX.", "XXX"];
const PEGOTE_OJO = ["XXXXX", "XXXXX", ".XXX."];

/**
 * Mascar es **un medio circulo y una raya**, en una sola silueta.
 *
 * El carrillo es la curva -redondo por fuera, plano por dentro, que es por donde
 * se pega a la boca- y la boca es la linea casi recta que sale del otro lado. Se
 * dibujan juntos a proposito: si van en dos sprites, tarde o temprano alguien los
 * separa y vuelven a leerse como dos manchas.
 *
 * Dos intentos fallidos antes de este, y el segundo enseno lo que importa:
 * separados eran dos manchas sueltas, y **pegados pero iguales** -un bloque de
 * 3x2 para la boca y otro de 3x3 para el carrillo- tampoco se entendian. El
 * problema no era la distancia, era que **los dos eran la misma forma**: dos
 * rectangulos del mismo tamano no se reparten papeles, uno tiene que ser volumen
 * y el otro trazo.
 */
const MASCA = [
  ".XXX......",
  "XXXXXXXXXX",
  ".XXX......",
];

/**
 * El bocado, subiendo y bajando **un pixel**.
 *
 * Un flipbook dentro de otro: el de fuera cambia de carrillo, el de dentro mueve
 * la mandibula mientras ese tiempo dura. Sin el, mascar eran dos poses turnandose
 * y eso no se lee como masticar, se lee como que el bicho cambia de cara.
 */
const masca = (m: string[], x: number) =>
  flip([spr(m, x, 11), spr(m, x, 12)], ".34s");

/** Cuanto dura una mascada. Todo lo demas se mide en mascadas. */
const MASCADA_MS = 340;

/**
 * Una tanda de mascadas de un lado.
 *
 * El numero cambia cada vez y el lado se alterna. Eso es lo unico que hace que un
 * minuto de mascar no se sienta un bucle: no son dibujos distintos, es el **mismo
 * dibujo durando distinto**. Es literalmente lo que hacen los tamagotchi
 * originales, que alternan dos cuadros "tres o cuatro veces" y nunca las mismas.
 *
 * Los ojos parpadean con `blink` y no con un flipbook de cuatro poses: cuatro
 * animaciones vivas por cada una de las treinta y tantas tandas serian demasiadas
 * para una ventana que esta siempre encima. Dos hacen el mismo trabajo.
 */
const tanda = (izq: boolean, bocados: number): Paso => {
  const abierto = uno([OJO, OJO, OJO_MEDIO]);
  return {
    ms: bocados * MASCADA_MS,
    v:
      blink(
        eyes(abierto, abierto === OJO_MEDIO ? 7 : 5),
        eyes(OJO_LINEA, 7),
        `${(2.6 + azar(8) * 0.2).toFixed(1)}s`,
      ) + (izq ? masca(MASCA, 16) : masca(espejo(MASCA), 19)),
  };
};

/** Un peldano de la escalera, dibujado. Del 4 en adelante tapa los ojos. */
const peldano = (n: number, ojos: string) => {
  const [m, x, y] = ESCALERA[n];
  const bomba = spr(tint(m, "p"), x, y);
  return n >= 3 ? bomba + ojos : ojos + bomba;
};

/**
 * Inflar, que **lleva su tiempo**.
 *
 * Sube la escalera peldano a peldano hasta el tamano que le toque y **se queda
 * arriba un segundo y medio largo**. Los dos numeros importan:
 *
 * - Los peldanos son cortos (un cuarto de segundo) pero son varios, asi que lo
 *   que se ve es un globo creciendo y no un globo que aparece.
 * - El aguante es largo a proposito. Antes la bomba pasaba por pantalla en medio
 *   segundo y no daba tiempo ni a verla: la gracia de una bomba de chicle es el
 *   rato que esta ahi antes de reventar.
 *
 * Mientras aguanta, la cara sigue viva -los ojos alternan entre abiertos y
 * entornados-: una bomba quieta con una cara quieta se lee como una pausa del
 * programa, no como alguien aguantando.
 */
const inflar = (hasta: number): Paso[] => {
  // Antes de que salga nada, coge aire: la boca se hace una O. Sin este cuadro
  // la bomba aparecia de la nada, y el primer peldano -que es el mas chico-
  // pasaba tan rapido que no llegaba a leerse como un principio.
  const pasos: Paso[] = [
    { ms: 260, v: eyes(OJO_MEDIO, 7) + spr(BOCA_O, 20, 11) },
  ];
  for (let n = 0; n < hasta; n++) {
    pasos.push({
      ms: 240,
      v: peldano(n, eyes(n >= 2 ? OJO_ANCHO : OJO_MEDIO, n >= 2 ? 5 : 7)),
    });
  }
  const ojosArriba = flip(
    [eyes(OJO_ANCHO, 5), eyes(OJO_MEDIO, 7), eyes(OJO_ANCHO, 5), eyes(OJO, 5)],
    "1.2s",
  );
  pasos.push({ ms: 320, v: peldano(hasta, eyes(OJO_ANCHO, 5)) });
  pasos.push({ ms: entre(1300, 1900), v: peldano(hasta, ojosArriba) });
  return pasos;
};

/**
 * Revienta limpio: ni pegotes ni cara embarrada.
 *
 * Es lo que pasa **casi siempre**, y tiene que ser asi: si cada bomba acabara con
 * la cara llena de chicle, la vez que de verdad le revienta dejaria de significar
 * nada. Un susto de nada, se lame el labio y vuelve a mascar.
 */
const popLimpio = (hasta: number): Paso[] => {
  const [, x, y] = ESCALERA[hasta];
  const centro = x + Math.floor(ESCALERA[hasta][0][0].length / 2);
  const grande = hasta >= 3;
  const trozos = grande
    ? spr(tint(ESQUIRLAS, "p"), centro - 5, y + 1)
    : spr(tint(ESQUIRLAS_MINI, "p"), centro - 3, y);
  return [
    { ms: 260, v: trozos + eyes(OJO_ANCHO, 5) },
    { ms: 320, v: eyes(OJO_ANCHO, 5) + spr(BOCA_O, 20, 11) },
    { ms: 420, v: eyes(OJO_ARCO, 6) + spr(RAYA, 20, 12) },
  ];
};

/**
 * Y la rara: **le revienta en la cara**.
 *
 * Una de cada siete bombas. Es la unica que deja pegotes, y por eso es la que se
 * cuenta: lo que hace especial a un suceso no es que sea aparatoso, es que los
 * otros seis no lo sean. Acaba con ojos de estrella, que es el premio de
 * haberlo visto.
 */
const explota = (): Paso[] => {
  const pegotes =
    spr(tint(PEGOTE_IZQ, "p"), 14, 4) + spr(tint(PEGOTE_DER, "p"), 28, 5);
  const cara = azar(2) === 0;
  return [
    { ms: 300, v: spr(tint(ESQUIRLAS, "p"), 17, 4) + eyes(OJO_ANCHO, 5) },
    cara
      ? { ms: 820, v: pegotes + eyes(OJO_ASPA, 4) + spr(LADEADA, 19, 12) }
      : {
          ms: 820,
          v:
            spr(tint(PEGOTE_OJO, "p"), 14, 4) +
            spr(OJO_ANCHO, RX - 1, 5) +
            spr(BOCA_O, 20, 11),
        },
    { ms: 700, v: eyes(OJO_ESTRELLA, 4) + spr(SONRISA, 18, 12) },
  ];
};

/**
 * La historia entera, de unos sesenta segundos.
 *
 * Un solo ciclo que se repite -mascar, inflar, reventar- y que **nunca se repite
 * igual**: cambian cuantas tandas hay antes de cada bomba, cuantas mascadas tiene
 * cada tanda, por que lado empieza, hasta que peldano sube la bomba, cuanto
 * aguanta arriba y el ritmo de los parpadeos.
 *
 * Y las tandas **van creciendo**: la primera vez masca poco, la cuarta masca un
 * buen rato. Es lo que hace que no se sienta un metronomo.
 *
 * La bomba gigante sale **una de cada siete**, y es la unica que le explota en la
 * cara. Cuando pasa, escupe lo que queda y empieza otra vez con chicle nuevo.
 */
const construirChicle = () => {
  const pasos: Paso[] = [
    { ms: 520, v: eyes(OJO, 5) + spr(RAYA, 20, 12) + spr(tint(CHICLE_BOLA, "p"), 30, 11) },
  ];
  let izq = azar(2) === 0;
  let total = 520;
  // `nivel` cuenta las bombas desde el ultimo reventon en la cara, y sube dos
  // cosas a la vez: **masca mas rato** y **la bomba sale mas grande**. Es el arco
  // que pidio Luis -una bomba mediana, luego una mas grande, y a la tercera ya
  // anda crecido-. Se reinicia cuando le explota, para que cada tanda vuelva a
  // empezar desde abajo y el arco se note otra vez.
  let nivel = 0;
  while (total < 55000) {
    for (let t = entre(2, 3) + Math.min(nivel, 3); t > 0; t--) {
      const paso = tanda(izq, entre(2, 6));
      pasos.push(paso);
      total += paso.ms;
      izq = !izq;
    }
    const gigante = azar(7) === 0;
    // Los tamanos que revientan limpios son el de 7x7 y el de 9x9, y se suben en
    // ese orden segun el nivel. El mas chico se quedo fuera como destino: con el,
    // inflar duraba dos cuadros y volvia a pasar lo que Luis dijo -la bomba no da
    // tiempo ni a verse-. Sigue saliendo, pero **de paso**, como primer peldano
    // de la escalera. Y la gigante es la unica del ultimo peldano: la que
    // revienta en la cara tiene que ser, sin discusion, la mas grande vista.
    const hasta = gigante ? 4 : Math.min(2 + nivel, 3);
    const bomba = [...inflar(hasta), ...(gigante ? explota() : popLimpio(hasta))];
    bomba.forEach((x) => (total += x.ms));
    pasos.push(...bomba);
    if (gigante) {
      const nuevo = {
        ms: 520,
        v: eyes(OJO, 5) + spr(RAYA, 20, 12) + spr(tint(CHICLE_BOLA, "p"), 30, 11),
      };
      pasos.push(nuevo);
      total += nuevo.ms;
      nivel = 0;
    } else {
      nivel++;
    }
  }
  return secuencia(pasos);
};

/**
 * Mascando chicle: la carita de stand-by.
 *
 * `fresco` la vuelve a sortear cada vez que el HUD la saca, asi que dos reposos
 * seguidos no cuentan la misma historia. `scene` es solo la primera tirada, la
 * que se ve en el catalogo y en el manual.
 */
export const CHICLE: Variant = {
  status: "",
  scene: construirChicle(),
  fresco: construirChicle,
};

/**
 * La misma, corta: masca y saca una bomba que aguanta.
 *
 * Se queda para el catalogo y para cualquier sitio donde haga falta un bucle de
 * los de siempre. En reposo ya no se usa: ahi va la historia larga, que durante
 * un dictado corto simplemente no llega mas alla de las primeras mascadas -y eso
 * se ve bien, porque mascar es justo lo que hace cuando no pasa nada-.
 */
export const CHICLE_CORTO: Variant = {
  status: "",
  scene: `${flip(
    [
      masca(espejo(MASCA), 19) + eyes(OJO, 5),
      eyes(OJO, 5) + masca(MASCA, 16),
      eyes(OJO, 5) + spr(tint(BOMBA_2, "p"), 20, 9),
      eyes(OJO, 5) + masca(espejo(MASCA), 19),
    ],
    "1.4s",
  )}`,
};

// ─── reposo: silbando ───────────────────────────────────────────────────────

/**
 * Los labios de silbar: un aro de 3x3 con el agujero pintado del fondo.
 *
 * Hueca y no maciza, como la boca abierta del carrito. Aqui el hueco es el
 * agujero por donde sale el aire, y sin el son tres pixeles de nada.
 */
const LABIOS = ["XXX", "XoX", "XXX"];

/**
 * Las notas, **de dos tipos**: la corchea suelta (♪) y dos corcheas unidas por
 * su barra (♫).
 *
 * Antes eran la misma negra en dos tamaños, y a esta escala dos tamaños de lo
 * mismo no son dos notas: son una nota que a veces sale más chica. Lo que las
 * distingue es la **silueta** —una plica con banderín contra dos plicas con su
 * barra—, que es lo único que se lee a 48×16.
 *
 * El banderín son dos píxeles en escalera, y aquí la escalera sí vale: no es un
 * objeto recto dibujado en diagonal, es la curva del banderín. Las cabezas van a
 * la izquierda de su plica, como en la partitura.
 */
const CORCHEA = ["..XX.", "..X.X", "..X..", "XXX..", "XXX.."];
const CORCHEAS = [".XXXXX", ".X...X", ".X...X", "XX..XX", "XX..XX"];

// La mano que chasqueaba se borro el 19/09/2026, y conviene que quede escrito
// por que: a cinco pixeles, un puno con **un solo dedo levantado** no se lee
// como un chasquido, se lee como una pena de dedo. Lo vio Luis a la primera.
//
// Y no tiene arreglo por refinamiento: a esta escala cualquier silueta con un
// dedo destacado esta a un pixel del gesto obsceno, porque no hay sitio para
// dibujar la mano que lo desambigua. La regla que queda: **nada de manos con
// dedos sueltos en 48x16**; una mano aqui solo puede ser un bloque entero
// -como la que sostiene la servilleta-.
//
// El ritmo lo llevan ahora el **meneo de la cabeza** y la entrada de las notas.

/**
 * # Lo que sube flotando va por carriles
 *
 * Las notas del silbido y los ZZZ del dormido. Antes cada uno subía a su ritmo
 * desde casi la misma columna, y dos cosas que suben a ritmos distintos por el
 * mismo sitio **se atraviesan**: la rápida alcanzaba a la lenta, se montaban, y
 * dos notas encimadas son una mancha.
 *
 * Ahora cada una va por **su carril** —su columna, con un píxel de aire con la
 * de al lado— y en un carril nunca hay dos a la vez: la nota sólo se ve durante
 * el 60 % de su ciclo, que es su viaje entero, y el resto el carril está vacío.
 * Así no se tocan nunca, y no por suerte sino por construcción.
 *
 * Lo que tenían de bueno —que no suban en fila, que es lo que convierte una
 * melodía en una barra de carga— se conserva de otra forma: **cada carril lleva
 * su propio ciclo**, así que las de un lado y las del otro se van cruzando sin
 * un compás fijo.
 *
 * Y suben **a saltos de un píxel** (el keyframe asciende del CSS, con steps).
 * El linear de antes las dejaba a medio píxel casi todo el viaje, justo lo que
 * la regla de la casa prohíbe: el pixel-art deslizándose tiembla.
 */
const CARRIL_A = 33;
/** 33 + 6 de la nota más ancha + 1 del vaivén = 40 ocupado como mucho; el
 *  segundo carril empieza en 41 y acaba en 47, el borde del lienzo. */
const CARRIL_B = 41;

/**
 * Una cosa subiendo por su carril, en bucle.
 *
 * La fase de arranque va en negativo a propósito: con un retraso positivo la
 * nota se quedaría quieta y a la vista en su casilla de salida hasta que le
 * tocara, y así ya va por donde le toque desde el primer instante.
 *
 * @param y0 la fila de arriba del sprite al salir. Sube nueve filas (lo fija el
 *   keyframe), así que acaba en `y0 - 9`: con 11 llega justo al borde de arriba.
 * @param ciclo cada cuánto vuelve a salir, en ms. El viaje es el 60 %.
 */
const carril = (html: string, x: number, y0: number, ciclo: number) =>
  `<g transform="translate(${x} ${y0})"><g style="animation-name:asciende;` +
  `animation-duration:${ciclo}ms;animation-delay:-${azar(ciclo)}ms;` +
  `animation-timing-function:steps(1,end);animation-iteration-count:infinite">` +
  `${html}</g></g>`;

const COLORES_NOTA = ["p", "m", "s", "w", "a"];

/** Dos colores de nota distintos: si las dos salen iguales se leen como una. */
const dosColores = (): [string, string] => {
  const a = uno(COLORES_NOTA);
  const b = uno(COLORES_NOTA.filter((c) => c !== a));
  return [a, b];
};

/**
 * La cara de silbar: **ojos cerrados y la cabeza meneandose al ritmo**.
 *
 * Silbar se hace con los ojos cerrados -el que silba se esta escuchando a si
 * mismo-, y eso ademas resuelve el problema que tenia la cara: con los ojos
 * abiertos y quietos parecia que miraba a la nada mientras le salian notas.
 *
 * El meneo es **horizontal** y no vertical. Un cabeceo arriba-abajo se lee como
 * asentir; el vaiven lateral es el que se lee como seguir el compas. Va de un
 * pixel a cada lado y con un `translate` entero del grupo: mover cada sprite por
 * separado deja los ojos y la boca desalineados medio pixel en algun cuadro.
 */
const caraSilba = (dx: number, abre: boolean) =>
  `<g transform="translate(${dx} 0)">` +
  eyes(abre ? OJO : OJO_ARCO, abre ? 5 : 6) +
  spr(LABIOS, 21, 11) +
  `</g>`;

/**
 * El meneo: cuatro posiciones en bucle dentro de un solo paso.
 *
 * Va anidado a proposito. Si el vaiven fuera pasos de la secuencia, un minuto de
 * silbido serian trescientos pasos; asi son treinta y pico. Y como todos los
 * pasos llevan el mismo bucle a la misma duracion, **el meneo no se corta al
 * cambiar de paso**: las animaciones de CSS arrancan todas a la vez, asi que van
 * en fase aunque esten en grupos distintos.
 *
 * `abre` le mete un instante con los ojos abiertos: sin eso son cuarenta
 * segundos de una cara dormida, y la regla de la casa es que ninguna carita
 * tenga los ojos quietos.
 */
const meneo = (abre: boolean) =>
  flip(
    [caraSilba(-1, false), caraSilba(0, false), caraSilba(1, false), caraSilba(0, abre)],
    "0.84s",
  );

/**
 * Una frase: las dos notas, **cada una por su carril** y cada carril a su
 * ritmo. Qué nota va por qué lado y de qué color se sortea en cada frase.
 */
const frase = (): Paso => {
  const [a, b] = azar(2) ? [CORCHEA, CORCHEAS] : [CORCHEAS, CORCHEA];
  const [ca, cb] = dosColores();
  // Una de cada cuatro frases va con una sola nota: dos voces sin parar todo el
  // minuto también acaban sonando a bucle.
  const notas =
    carril(spr(tint(a, ca)), CARRIL_A, 11, entre(1300, 1900)) +
    (azar(4) ? carril(spr(tint(b, cb)), CARRIL_B, 11, entre(1300, 1900)) : "");
  return { ms: entre(2400, 4200), v: meneo(azar(3) === 0) + notas };
};

/** Coge aire entre frase y frase: abre los ojos y deja de silbar un momento. */
const tomaAire = (): Paso => ({
  ms: entre(700, 1300),
  v: eyes(OJO, 5) + spr(uno([RAYA, SONRISA]), 20, 12),
});

/**
 * La rara: **va a por la nota larga**.
 *
 * Una de cada seis frases. Se para el meneo -que es lo que la marca como momento
 * especial-, coge aire, aprieta los ojos y la suelta. Y hay dos finales: o le
 * sale y acaba con ojos de estrella, o **le gallea** y la nota sale torcida, en
 * naranja y en zigzag, y disimula mirando a otro lado.
 *
 * Que a veces falle es lo que hace que la otra vez valga algo.
 */
const notaLarga = (): Paso[] => {
  const logra = azar(2) === 0;
  const pasos: Paso[] = [
    { ms: 620, v: eyes(OJO_MEDIO, 7) + spr(BOCA_O, 20, 11) },
    {
      ms: 760,
      // La nota larga no sube: **se sostiene**, vibrando un píxel. Subiendo por
      // su carril, en un paso tan corto podía tocarle el tramo en que el carril
      // está vacío, y la nota larga se quedaba sin nota.
      v:
        eyes(OJO_LINEA, 7) +
        spr(BOCA_O, 20, 11) +
        flip([spr(tint(CORCHEA, "a"), CARRIL_A, 7), spr(tint(CORCHEA, "a"), CARRIL_A, 6)], ".38s"),
    },
  ];
  if (logra) {
    const [ca, cb] = dosColores();
    pasos.push({
      ms: 980,
      // Le salió: las dos notas a la vez y deprisa. El ciclo cabe en el paso,
      // así que las dos llegan a verse pase lo que pase con la fase.
      v:
        eyes(OJO_ESTRELLA, 4) +
        spr(SONRISOTA, 19, 11) +
        carril(spr(tint(CORCHEAS, ca)), CARRIL_A, 11, 900) +
        carril(spr(tint(CORCHEA, cb)), CARRIL_B, 11, 960),
    });
    pasos.push({ ms: 640, v: eyes(OJO_ARCO, 6) + spr(SONRISA, 18, 12) });
  } else {
    pasos.push({
      ms: 700,
      v: eyes(OJO_ANCHO, 5) + spr(BOCA_O, 20, 11) + spr(tint(ZIGZAG, "w"), 32, 8),
    });
    pasos.push({ ms: 900, v: eyes(OJO_MEDIO, 7) + spr(LADEADA, 19, 12) });
  }
  return pasos;
};

/** Un minuto silbando, y ninguna vuelta igual. */
const construirSilbando = () => {
  const pasos: Paso[] = [];
  let total = 0;
  while (total < 55000) {
    const f = frase();
    pasos.push(f);
    total += f.ms;
    const sigue = azar(6) === 0 ? notaLarga() : [tomaAire()];
    sigue.forEach((x) => (total += x.ms));
    pasos.push(...sigue);
  }
  return secuencia(pasos);
};

export const SILBANDO: Variant = {
  status: "",
  scene: construirSilbando(),
  fresco: construirSilbando,
};

/**
 * Silbando, corta: cuatro tiempos con las dos notas subiendo, cada una por su
 * carril y con un tiempo de desfase —la segunda sale cuando la primera va por
 * la mitad—.
 */
export const SILBANDO_CORTO: Variant = {
  status: "",
  scene: `${flip(
    [
      caraSilba(-1, false) + spr(tint(CORCHEAS, "m"), CARRIL_B, 5),
      caraSilba(0, false) + spr(tint(CORCHEA, "p"), CARRIL_A, 11),
      caraSilba(1, false) +
        spr(tint(CORCHEA, "p"), CARRIL_A, 8) +
        spr(tint(CORCHEAS, "m"), CARRIL_B, 11),
      caraSilba(0, true) +
        spr(tint(CORCHEA, "p"), CARRIL_A, 5) +
        spr(tint(CORCHEAS, "m"), CARRIL_B, 8),
    ],
    "1.6s",
  )}`,
};

// ─── reposo: dormido ────────────────────────────────────────────────────────

/**
 * Un ZZZ grande, para el ronquido que lo despierta.
 *
 * El mismo dibujo que el normal pero de 6x6: lo que dice que ese ronquido fue
 * mas fuerte no es que suene distinto -no suena-, es que **se ve mas grande**.
 */
const ZZZ_GRANDE = ["XXXXXX", "....XX", "...XX.", "..XX..", ".XX...", "XXXXXX"];

/**
 * Durmiendo: **la boca respira**.
 *
 * La burbuja de moco se borro el 20/09/2026. Era una buena idea y el problema no
 * era el dibujo: es que **salia por el mismo lado que los ZZZ** y a esa escala
 * dos cosas creciendo en el mismo rincon se leen como una sola mancha. Cuando
 * dos elementos compiten por el mismo sitio, el que se va es el que menos dice
 * -y lo que dice que esta dormido son los ZZZ, no el moco-.
 *
 * En su lugar respira con la boca, que ademas es donde tiene que estar la
 * atencion: la cara. Cuatro tiempos, de cerrada a abierta y vuelta, con la
 * cabeza subiendo y bajando un pixel. Lento a proposito -3,2 s el ciclo
 * entero-: a un segundo parecia que jadeaba, y ese numero es la mitad del
 * personaje.
 */
const durmiendo = () =>
  flip(
    [
      `<g transform="translate(0 0)">${eyes(OJO_ARCO, 6)}${spr(RAYA, 20, 12)}</g>`,
      `<g transform="translate(0 1)">${eyes(OJO_ARCO, 6)}${spr(BOCA_CHICA, 21, 12)}</g>`,
      `<g transform="translate(0 1)">${eyes(OJO_ARCO, 6)}${spr(BOCA_O, 20, 11)}</g>`,
      `<g transform="translate(0 0)">${eyes(OJO_ARCO, 6)}${spr(BOCA_CHICA, 21, 12)}</g>`,
    ],
    "3.2s",
  );

/**
 * Un ZZZ que se va flotando, cada uno por su carril y a su aire —lento, que
 * está dormido—. Mismo motor que las notas del silbido, y por lo mismo: dos ZZZ
 * subiendo a ritmos distintos por la misma columna se atravesaban.
 */
const ronquido = (i: number) =>
  carril(
    spr(tint(i % 2 ? ZZZ_MINI : ZZZ, "s")),
    i % 2 ? CARRIL_B : CARRIL_A,
    11,
    entre(2200, 3000),
  );

/** Un rato durmiendo, con los ZZZ que le toquen. */
const sueno = (zzz: number): Paso => {
  let extra = "";
  for (let k = 0; k < zzz; k++) extra += ronquido(k);
  return { ms: entre(2600, 4200), v: durmiendo() + extra };
};

/**
 * Chasquea los labios en sueños.
 *
 * Es el suceso pequeño, el que rompe el ritmo sin despertarlo: la boca se va a
 * un lado, al otro y se queda quieta. Dura poco y pasa a menudo, que es
 * justamente lo contrario que el ronquido gordo.
 */
const chasquea = (): Paso => ({
  ms: entre(900, 1400),
  v: flip(
    [
      eyes(OJO_ARCO, 6) + spr(BOCA_CHICA, 20, 12),
      eyes(OJO_ARCO, 6) + spr(BOCA_CHICA, 22, 12),
      eyes(OJO_ARCO, 6) + spr(RAYA, 20, 12),
    ],
    "0.66s",
  ),
});

/**
 * La rara: **se despierta con su propio ronquido**.
 *
 * Una de cada siete. El ZZZ sale de 6x6 en vez de 4x4, la boca se abre del todo,
 * y se despierta de golpe: tarda un momento en entender donde esta, bosteza y se
 * vuelve a dormir. Es el **unico** momento en el que abre los ojos, y por eso
 * vale la pena esperarlo.
 */
const ronquidoGordo = (): Paso[] => [
  {
    ms: 820,
    v:
      eyes(OJO_ARCO, 6) +
      spr(BOSTEZO, 19, 10) +
      carril(spr(tint(ZZZ_GRANDE, "s")), CARRIL_A, 11, 800),
  },
  { ms: 300, v: eyes(OJO_ANCHO, 5) + spr(BOCA_O, 20, 11) },
  { ms: 840, v: eyes(OJO_ANCHO, 5) + spr(BOCA_CHICA, 21, 12) },
  { ms: 960, v: eyes(OJO_MEDIO, 7) + spr(BOSTEZO, 19, 10) },
  { ms: 780, v: eyes(OJO_LINEA, 7) + spr(RAYA, 20, 12) },
];

/** Un minuto durmiendo. */
const construirDormido = () => {
  const pasos: Paso[] = [];
  let total = 0;
  let ultZzz = -1;
  while (total < 55000) {
    // Dos respiraciones seguidas no pueden salir iguales, y con ZZZ al azar
    // pasaba: `sueno(0)` dos veces es el mismo dibujo durante siete segundos, y
    // eso no se lee como respirar despacio, se lee como que se colgo. Basta con
    // obligar a que el numero de ZZZ cambie de un paso al siguiente.
    for (let n = entre(1, 3); n > 0; n--) {
      let z = azar(3);
      while (z === ultZzz) z = azar(3);
      ultZzz = z;
      const p = sueno(z);
      pasos.push(p);
      total += p.ms;
    }
    const sigue = azar(7) === 0 ? ronquidoGordo() : [chasquea()];
    sigue.forEach((x) => (total += x.ms));
    pasos.push(...sigue);
  }
  return secuencia(pasos);
};

export const DORMIDO: Variant = {
  status: "",
  scene: construirDormido(),
  fresco: construirDormido,
};

/** Dormido, corta: respira con la boca y suelta un ZZZ. */
export const DORMIDO_CORTO: Variant = {
  status: "",
  scene: `${flip(
    [
      eyes(OJO_ARCO, 6) + spr(RAYA, 20, 12),
      eyes(OJO_ARCO, 7) + spr(BOCA_CHICA, 21, 13) + spr(tint(ZZZ_MINI, "s"), 33, 10),
      eyes(OJO_ARCO, 7) + spr(BOCA_O, 20, 12) + spr(tint(ZZZ, "s"), 34, 6),
      eyes(OJO_ARCO, 6) + spr(BOCA_CHICA, 21, 12),
    ],
    "2.4s",
  )}`,
};

// La carita de dibujar se borro el 19/09/2026, el mismo dia que nacio. Dos
// motivos y los dos de Luis:
//
// - **Se pisaba con el escribano.** Ya hay una carita de pluma y pergamino
//   para corregir texto, y otra de manos tecleando para escribir. Una tercera
//   de lapiz no anade un gesto, anade una duda: el usuario no sabe si la onda
//   esta en reposo o esta haciendo algo con su texto. Una mascota puede tener
//   muchos gestos, pero no dos que signifiquen lo mismo.
// - **Y el lapiz no se leia.** Dibujado en diagonal a cuatro pixeles no
//   parecia un lapiz sino un espagueti con la punta rosa, porque un lapiz es
//   recto y una diagonal en pixel-art es una escalera. Es el mismo aprendizaje
//   que ya estaba escrito para el brazo levantado: **a esta escala la diagonal
//   no es una linea inclinada, es una escalera**, y un objeto que se reconoce
//   por ser recto no puede dibujarse en diagonal.

// ─── reposo: los ojos que te siguen ───────────────────────────────────────

/**
 * La cuenca grande, de 7x7.
 *
 * La normal es de 7x5 y su hueco mide 5x3: con una pupila de 3x2 dentro solo
 * queda sitio para moverse a los lados, no arriba y abajo. Esta tiene el hueco
 * de 5x5, asi que la pupila se mueve **un pixel en las cuatro direcciones** y el
 * ojo puede mirar a una esquina. Un ojo que solo mira a izquierda y derecha no
 * sigue a nadie: barre.
 */
const CUENCA_GRANDE = [
  "XXXXXXX",
  "X.....X",
  "X.....X",
  "X.....X",
  "X.....X",
  "X.....X",
  "XXXXXXX",
];

/**
 * Los ojos que te siguen el cursor.
 *
 * La pupila no se dibuja en un sitio distinto por cada direccion: se dibuja una
 * vez y **se mueve con un `translate` que lee `--mx` y `--my`**, dos variables
 * que el HUD actualiza quince veces por segundo con lo que le dice Windows. Es
 * el mismo mecanismo con el que el volumen de tu voz mueve las barras del DJ.
 *
 * Desde el webview no se puede saber donde esta el cursor -el HUD solo recibe
 * eventos de raton cuando esta encima de el-, asi que la posicion viene de Rust.
 * Y solo se pregunta **mientras esta carita esta a la vista**: las otras cuatro
 * de reposo no gastan nada.
 */
export const OJOS_SIGUEN: Variant = {
  status: "",
  sigue: true,
  scene: `${spr(CUENCA_GRANDE, 13, 3)}${spr(CUENCA_GRANDE, 25, 3)}
    <g class="a-pupila">${spr(PUPILA, 15, 5)}${spr(PUPILA, 27, 5)}</g>
    ${spr(SONRISA, 18, 12)}`,
};

/**
 * Y si **le das vueltas** con el raton, se marea: dos vueltas enteras alrededor
 * de la onda en tres segundos (ver VUELTAS_MAREO en Hud.tsx).
 *
 * Antes bastaba con mover el raton deprisa, y eso no era un gesto sino
 * trabajar: con un raton sensible o en una 4K los ojos se ponian en aspa sin
 * que nadie hubiera querido marearla. Dar vueltas no depende de la velocidad
 * del puntero y no se hace sin querer.
 *
 * Aspas en vez de pupilas y la cabeza dando tumbos. No lleva espiral **a
 * proposito**: el espiral ya ha fallado tres veces -a 3 px es una mancha, a 5 px
 * una letra G y a 7 px un laberinto roto- porque una espiral es una linea de
 * 1 px que se cruza consigo misma y sin medios tonos las vueltas se tocan.
 */
export const OJOS_MAREADOS: Variant = {
  status: "",
  scene: `${flip(
    [
      `<g transform="translate(-1 0)">${eyes(OJO_ASPA, 4)}${spr(ZIGZAG, 19, 12)}</g>`,
      `<g transform="translate(1 0)">${eyes(OJO_ASPA, 5)}${spr(ZIGZAG, 20, 12)}</g>`,
    ],
    ".26s",
  )}`,
};

// ─── 26 caritas: 5 por estado + el eructo, que sólo sale tras la comilona ───
// Regla nueva (28/08): **ninguna carita tiene los ojos quietos**, y el gesto de
// los ojos no se repite entre caritas. Es lo que las separa unas de otras
// cuando el accesorio se parece.
export const V: Record<FaceState, Variant[]> = {
  // Las cuatro de reposo son las **versiones cortas** de las caritas de
  // stand-by. Cortas y no de ocho tiempos porque aquí la onda sale unos
  // segundos: una historia de 4,8 s se vería siempre cortada por la mitad, que
  // es peor que no contarla. Las largas salen con la onda clavada, mirándola.
  //
  // La quinta sigue siendo la vieja —los ojos paseando dentro de la cuenca— a
  // propósito: es el hueco de **los ojos que te siguen el cursor**, que necesita
  // que Rust le mande dónde está el ratón y todavía no existe. Se queda la de
  // antes en vez de dejar cuatro, que cambiaría el reparto de los cinco estados.
  reposo: [
    // La larga, no la corta: en reposo es donde vive el stand-by. Durante un
    // dictado sale unos segundos y sólo se ve el principio -mascando-, que es
    // exactamente lo que tiene que estar haciendo cuando no pasa nada.
    { ...CHICLE, status: "Dicho" },
    { ...SILBANDO, status: "Dicho" },
    { ...DORMIDO, status: "Zzz…" },
    {
      // Hueco: aqui iba el dibujante, que se borro por pisarse con el
      // escribano. Mientras no haya quinta idea, la de siempre: respira y
      // parpadea, con un destello en el ojo mientras esta abierto.
      status: "Dicho",
      scene: `<g class="a-resp">${blink(eyes(OJO_BRILLO, 5), eyes(OJO_LINEA, 7))}${spr(SONRISA, 18, 12)}</g>`,
    },
    { ...OJOS_SIGUEN, status: "Dicho" },
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
            // En y=10, donde van las bocas de V. En y=7 —la altura de las
            // escenas del carrito, que tienen la cara más arriba— abría la
            // boca entre los dos ojos y se leía como una nariz.
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


/**
 * Los ojos del estreno: dos pantallitas con una línea barriéndolas.
 *
 * # Por qué no son un espiral, habiéndolo intentado tres veces
 *
 * El espiral es la convención universal de «mareado» y era lo que se quería.
 * **No se lee a este tamaño, y ya está medido tres veces**: a 5 px salía «una
 * letra G» (ver `OJO_ASPA`), a 3 px «una mancha» (ver `MAREO`), y a **7 px**
 * —probado en el banco, dibujándose de fuera hacia dentro y también con un
 * tramo viajando— sale un laberinto roto. El problema no es el tamaño: es que
 * una espiral es una línea de 1 px que se cruza consigo misma, y sin medios
 * tonos que separen las vueltas, las vueltas se tocan.
 *
 * # Y por qué esto sí
 *
 * Un marco hueco con una barra recorriéndolo de arriba abajo se lee como **una
 * pantalla refrescándose**, que es literalmente lo que está pasando: la app se
 * está actualizando. No es la convención de «mareado» — es la de «máquina
 * trabajando», y aquí esa es la correcta. Además encaja con el aparato: el
 * tamagotchi cuenta las cosas con casillas que se llenan, no con dibujos finos.
 */
const OJO_PANTALLA = ["XXXXX", "X...X", "X...X", "X...X", "XXXXX"];
const OJOS_GIRO = [1, 2, 3].map(
  (fila) =>
    spr(OJO_PANTALLA, LX - 1, 5) +
    spr(["XXXXX"], LX - 1, 5 + fila) +
    spr(OJO_PANTALLA, RX - 1, 5) +
    spr(["XXXXX"], RX - 1, 5 + fila),
);

/** La lengua del estreno, dando vueltas dentro de la boca abierta. */
const LENGUA_ESTRENO: [number, number][] = [
  [20, 12],
  [21, 13],
  [23, 13],
  [24, 12],
];

/** El barrido del revelado: 12 ms por diagonal, arrancando en el 87 % de 2,8 s.
 *  Va por `x + y` en coordenadas absolutas y no por índice del sprite: por
 *  índice, cada spr() empezaría en cero y los dos ojos y la boca aparecerían a
 *  la vez, como tres manchas. En diagonal hay un solo frente de onda cruzando
 *  la tira. Literales y no variables CSS, por el gotcha de siempre. */
const REVELA_PASO = 0.012;
const REVELA_INI = 2.44 - 20 * REVELA_PASO;
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
      ${flip(OJOS_GIRO, ".45s")}
      ${spr(BOSTEZO, 19, 10)}
      ${flip(
        LENGUA_ESTRENO.map(([x, y]) => spr(tint(["XX", "XX"], "p"), x, y)),
        ".56s",
      )}
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
const BRAZO_RECTO = [
  "..XXXX",
  "..XXXX",
  "...XX.",
  "...XX.",
  "...XX.",
  "...XX.",
  "...XX.",
  "...XX.",
  "...XX.",
  "...XX.",
  "...XX.",
];

/**
 * El mismo brazo, abierto: **el hombro no se mueve** —sigue en las columnas 3 y
 * 4, apoyado en la vagoneta— y lo que viaja es la mano, dos columnas hacia
 * fuera, con el antebrazo inclinándose para alcanzarla.
 *
 * Que el hombro esté clavado es lo que convierte esto en un saludo. La versión
 * anterior subía y bajaba el brazo entero dos píxeles y eso no es agitar la
 * mano: es el brazo dando botes, que es lo que hace un dibujo que tiembla.
 */
const BRAZO_ABIERTO = [
  "XXXX..",
  "XXXX..",
  ".XX...",
  ".XX...",
  "..XX..",
  "..XX..",
  "..XX..",
  "...XX.",
  "...XX.",
  "...XX.",
  "...XX.",
];

/**
 * El abanico: el brazo baja entero manteniendo el hombro donde está.
 *
 * Con las dos poses de saludar no se podía hacer —abrir y cerrar la mano no es
 * abanicarse—, así que hacen falta dos alturas más. El ciclo va
 * `ABIERTO → MEDIO → BAJO → MEDIO`, que cierra solo y no da tirones.
 */
const ABANICO_MEDIO = [
  "......",
  "......",
  "XXXX..",
  "XXXX..",
  ".XX...",
  "..XX..",
  "..XX..",
  "...XX.",
  "...XX.",
  "...XX.",
  "...XX.",
];
const ABANICO_BAJO = [
  "......",
  "......",
  "......",
  "......",
  "XXXX..",
  "XXXX..",
  ".XX...",
  "..XX..",
  "...XX.",
  "...XX.",
  "...XX.",
];

/**
 * La onda de medusa: una cresta que **recorre** el brazo de abajo arriba.
 *
 * Éste es el movimiento que no se podía fingir con dos poses. Alternar dos
 * sprites da una alternancia; una onda necesita que la curva esté en un sitio
 * distinto en cada cuadro, y por eso son cuatro. La cresta sube una fila por
 * cuadro y al cuarto vuelve a empezar, así que el bucle cierra exacto.
 *
 * La cinta serpentea entre las columnas 1-2, 2-3 y 3-4 — **pasos de una
 * columna, nunca de dos**. De dos, a este tamaño, deja de ser una curva y se
 * ve como el dibujo partiéndose.
 */
const ONDA = [
  [
    "XXXX..",
    "XXXX..",
    ".XX...",
    "..XX..",
    "...XX.",
    "..XX..",
    ".XX...",
    "..XX..",
    "...XX.",
    "..XX..",
    "...XX.",
  ],
  [
    ".XXXX.",
    ".XXXX.",
    "..XX..",
    "...XX.",
    "..XX..",
    ".XX...",
    "..XX..",
    "...XX.",
    "..XX..",
    "..XX..",
    "...XX.",
  ],
  [
    "..XXXX",
    "..XXXX",
    "...XX.",
    "..XX..",
    ".XX...",
    "..XX..",
    "...XX.",
    "..XX..",
    ".XX...",
    "..XX..",
    "...XX.",
  ],
  [
    ".XXXX.",
    ".XXXX.",
    "..XX..",
    ".XX...",
    "..XX..",
    "...XX.",
    "..XX..",
    ".XX...",
    "..XX..",
    "...XX.",
    "...XX.",
  ],
];

/**
 * La servilleta, **en la mano** y del tamaño que cabe: cinco de ancho, con la
 * banda hueca que la identifica como tela.
 *
 * Va **en celeste** y no en tinta. En tinta, servilleta, mano y antebrazo eran
 * una sola mancha negra con un bloque al final, y en el banco se leía como una
 * pistola apoyada en una mesa. Con color propio la servilleta es un objeto que
 * la mano sostiene, igual que el vómito es menta y la lengua rosa.
 */
const SERVILLETA_MANO = ["XXXXX", "XoooX", "XXXXX", "XXXXX"];

/**
 * El brazo que barre la boca con la servilleta.
 *
 * Horizontal y no en diagonal, por la regla de siempre: a esta escala una
 * diagonal es una escalera. Y resulta que además es lo correcto — pasarse el
 * antebrazo por la boca **es** un gesto horizontal.
 *
 * Sale **por la derecha**: el hombro sube de la vagoneta y el codo dobla hacia
 * la cara. Antes salía por la izquierda con la mano ya pasada de la boca, así
 * que el antebrazo la tapaba desde el primer cuadro y **nunca se veía qué
 * estaba limpiando**. Entrando por el otro lado, al empezar la boca sucia está
 * a la vista y el antebrazo sólo la cruza mientras limpia.
 *
 * El hombro se queda pegado a la vagoneta y lo que viaja es la mano, igual que
 * en el saludo y en el abanico.
 *
 * @param mano la columna izquierda de la servilleta; la mano va pegada a su
 *   derecha y el antebrazo rellena hasta el hombro.
 */
const brazoConServilleta = (mano: number) =>
  // El hombro, subiendo de la vagoneta.
  spr(Array(5).fill("XX"), 32, 9) +
  // El antebrazo, de la mano al hombro.
  spr(Array(2).fill("X".repeat(Math.max(1, 34 - (mano + 5)))), mano + 5, 8) +
  // La mano, maciza —aquí una mano sólo puede ser un bloque—, agarrando la
  // servilleta por su lado.
  spr(["XX", "XX", "XX"], mano + 4, 7) +
  // Y la servilleta delante de todo.
  spr(tint(SERVILLETA_MANO, "s"), mano, 7);

/**
 * El brazo doblado hacia abajo: agarrado a la barandilla.
 *
 * Con la mano arriba —la pose de saludar— queda **a la altura de los ojos**, y
 * entonces brazos y ojos se leen como una fila de cuatro bloques iguales en vez
 * de como una cara. Doblado despeja el renglón de los ojos y queda agarrado al
 * carrito, que es lo que toca cuando no estás saludando: vomitando, bajándote,
 * o mientras la otra mano te limpia la boca.
 */
const BRAZO_ABAJO = [
  "......",
  "......",
  "......",
  "......",
  "XXXX..",
  "XXXX..",
  ".XX...",
  "..XX..",
  "...XX.",
  "...XX.",
  "...XX.",
];

/**
 * La vagoneta, de frente.
 *
 * # Cómo se hace profundidad sin sombras
 *
 * En 1 bit no hay medios tonos, así que el truco de sombrear el frente para que
 * parezca un volumen **no existe**. Tiene que salir de las tres cosas que sí
 * funcionan a este tamaño, y aquí están las tres:
 *
 *  - **El hueco.** Un interior del color del fondo dentro de un borde macizo se
 *    lee como algo en lo que te puedes meter. Es la misma lección que arregló la
 *    bocaza: el hueco *es* la abertura.
 *  - **La silueta que estrecha.** El frente se come una columna por lado según
 *    baja. Algo que estrecha hacia abajo se aleja, y con eso deja de ser una
 *    fachada plana.
 *  - **El tapado.** La barandilla se dibuja después, así que le pisa el borde de
 *    arriba: lo de delante esconde lo de detrás.
 *
 * Antes era una raya con dos muñones y el usuario lo dijo sin rodeos — parecía
 * una repisa, no un carrito. Las cuatro filas salen de que la cara ya subió a la
 * mitad de arriba: abajo había sitio y no se estaba usando.
 */
const VAGONETA = [
  "XXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "XX.......................XX",
  ".XXXXXXXXXXXXXXXXXXXXXXXXX.",
  "..XXX.................XXX..",
];


/**
 * Un par de brazos, ya colocados y con el derecho espejado.
 *
 * El izquierdo en x=8 y el derecho en x=31 **no es a ojo**: la cara se centra en
 * x=22, el espejo de una columna `p` es `44-p`, y un sprite de 6 de ancho que
 * ocupa 8-13 tiene su espejo ocupando 31-36. Espejar el origen en vez del tramo
 * —el error fácil— deja un brazo tres píxeles más fuera que el otro, y a este
 * tamaño eso se ve.
 */
const par = (izq: string[], der: string[]) =>
  spr(izq, 8, 3) + spr(espejo(der), 31, 3);

/**
 * La barandilla de seguridad del carrito.
 *
 * Va en **azul** —el color de acento de la app— y no en rojo ni amarillo
 * chillón. No es capricho: a este tamaño, un color de alarma cruzando la cara se
 * lee como un error, y esto no es un error, es una atracción.
 *
 * Es lo único de todo el HUD que no comparte color con la tinta, y por eso
 * funciona: al levantarse se ve clarísimo qué se está moviendo.
 *
 * El centro va **más gordo**, como el acolchado de las de verdad, y engorda
 * **hacia abajo**: hacia arriba le robaría sitio a la cara, que es lo único que
 * no puede encogerse.
 */
const BARANDILLA = [
  "XXXXXXXXXXXXXXXXXXXXXXXXX",
  "X....XXXXXXXXXXXXXXX....X",
  ".....XXXXXXXXXXXXXXX.....",
];

/**
 * El escenario que comparten las escenas del arrastre: la vagoneta, la
 * barandilla bajada y los brazos, en su propio grupo para que boten como un
 * carrito.
 *
 * Antes la vagoneta salía sólo en la primera y desaparecía en las tres del
 * mareo, y eso rompía la historia: el bicho se subía a un carrito, se mareaba en
 * el vacío y vomitaba en otro sitio. Lo que cambia entre las cuatro es **la cara
 * y cómo se mueven los brazos**; el carrito se queda.
 *
 * La cara va en su propio grupo con su propia animación, así que el bamboleo del
 * carrito y el mareo de la cara **no van sincronizados**. Es a propósito: son dos
 * movimientos distintos —el riel y el estómago— y cuadrarlos los volvería uno.
 */
const escenario = (brazos: string) =>
  // El orden importa y es el del mundo real: primero el carrito, luego los
  // brazos, y **la barandilla encima de ellos** — es lo que tienes delante, así
  // que los brazos se esconden por detrás. La cara va después de todo esto, o
  // sea por encima de la barandilla: si la barra le tapa la boca, la animación
  // deja de contarse.
  `<g class="a-vagon">${spr(VAGONETA, 9, 14)}${brazos}${spr(
    tint(BARANDILLA, "a"),
    10,
    12,
  )}</g>`;

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
  // Los brazos: el izquierdo en x=8 y el derecho en x=31. **No es a ojo**: la
  // cara se centra en x=22, así que el espejo de una columna p es 44-p, y un
  // sprite de 6 de ancho que ocupa 8-13 tiene su espejo ocupando 31-36. Espejar
  // el origen en vez del tramo —el error fácil— deja un brazo más fuera que el
  // otro, y a este tamaño tres píxeles se ven.
  //
  // El saludo va **en contrafase**: cuando uno abre, el otro cierra. Los dos a
  // la vez se leen como un dibujo que se estira; alternados se leen como dos
  // manos agitándose, que es lo que hace alguien en una montaña rusa.
  // Saludo **en contrafase**: cuando uno abre, el otro cierra. Los dos a la vez
  // se leen como un dibujo que se estira; alternados, como dos manos agitándose.
  scene: `${escenario(
    flip(
      [par(BRAZO_ABIERTO, BRAZO_RECTO), par(BRAZO_RECTO, BRAZO_ABIERTO)],
      ".3s",
    ),
  )}
    <g class="a-vagon">${flip([eyes(OJO_ANCHO, 2), eyes(OJO_ANCHO, 3)], ".48s")}
    ${spr(BOCAZA_DIENTES, 17, 7)}</g>`,
};

/** Lo que quedó del vómito, verde, en la comisura. Lo usan las dos limpiadas,
 *  y va aquí arriba porque `const` no se iza: definido más abajo, el módulo
 *  reventaría al cargar. */
const RESTO = ["XX"];

/**
 * Se limpia y se le pasa: **dos versiones, y sólo se queda una**.
 *
 * Se dibujaron las dos a propósito. A 48×16 no se puede saber de antemano cuál
 * se lee mejor: una se apoya en un **objeto** (la servilleta, que hay que
 * reconocer) y la otra en el **movimiento** (la lengua dando la vuelta, que no
 * hay que reconocer pero sí seguir). Son dos apuestas distintas y la única
 * forma de decidir es verlas.
 */
/** Lo que dura cada limpiada. Una sola fuente para el flip y para el HUD, que
 *  la enseña **una vez entera** y se queda en su último cuadro: si los dos
 *  números se separan, o el HUD la corta antes del final o se queda mirando un
 *  cuadro repetido. */
const LIMPIA_SERVILLETA_MS = 1800;
const LIMPIA_LENGUA_MS = 1200;

const LIMPIADA_SERVILLETA: Variant = {
  status: "Ya, ya…",
  // El brazo libre va **apoyado**, no en alto. Con la mano arriba mientras la
  // otra te limpia la boca no se entiende qué está haciendo: parece que saluda
  // y se limpia a la vez, que son dos cosas y ninguna se lee.
  //
  // Seis tiempos y no tres: llega sucia, **dos pasadas** —ida y vuelta—, la
  // boca limpia a la vista y la sonrisa del final con su destello, el mismo
  // remate que la de la lengua. Con una sola pasada en 0,9 s no daba tiempo a
  // entender qué había pasado. Los ojos se cierran mientras se limpia: es el
  // alivio, y además deja claro que la cara sigue ahí detrás del brazo.
  scene: `<g class="a-vagon">${spr(VAGONETA, 9, 14)}${flip(
    [
      // Llega con la boca aún sucia, un resto a cada lado.
      spr(BRAZO_ABAJO, 8, 3) +
        brazoConServilleta(27) +
        eyes(OJO, 2) +
        spr(BOCA_CHICA, 21, 9) +
        spr(tint(RESTO, "m"), 18, 10) +
        spr(tint(RESTO, "m"), 24, 10),
      // Primera pasada: tapa la boca y se lleva el resto de la derecha.
      spr(BRAZO_ABAJO, 8, 3) +
        brazoConServilleta(20) +
        eyes(OJO_ARCO, 3) +
        spr(tint(RESTO, "m"), 18, 10),
      // Llega al otro lado y se lleva el de la izquierda. La boca va debajo
      // del antebrazo, que es justo lo que está limpiando.
      spr(BRAZO_ABAJO, 8, 3) + brazoConServilleta(15) + eyes(OJO_ARCO, 3),
      // Vuelta.
      spr(BRAZO_ABAJO, 8, 3) + brazoConServilleta(20) + eyes(OJO_ARCO, 3),
      // Aparta la mano: la boca, limpia.
      spr(BRAZO_ABAJO, 8, 3) +
        brazoConServilleta(27) +
        eyes(OJO_ARCO, 3) +
        spr(BOCA_CHICA, 21, 9),
      // Y se le pasó.
      par(BRAZO_ABAJO, BRAZO_ABAJO) +
        eyes(OJO_ARCO, 3) +
        spr(SONRISA, 18, 9) +
        spr(tint(CHISPITA, "w"), 33, 2),
    ],
    `${LIMPIA_SERVILLETA_MS / 1000}s`,
  )}</g>`,
};

/**
 * La boca de la lamida: un aro grande y hueco, de 13×7.
 *
 * `BOSTEZO` (7×5) se quedaba corta. A esta escena hay que meterle **la lengua
 * por dentro y los restos por el borde**, y en un aro de 7 de ancho las dos
 * cosas se tocan y se leen como una mancha.
 *
 * El hueco que ocupa no se le quitó a nadie: estaba vacío. El lienzo sigue
 * siendo el mismo de siempre —tocar el `viewBox` arrastraría `HUD_H`, el divisor
 * de `--k` y los 26 sprites, que es una remodelación y no un ajuste—.
 */
const BOCA_REDONDA = [
  "...XXXXXXX...",
  ".XXX.....XXX.",
  "XX.........XX",
  "X...........X",
  "XX.........XX",
  ".XXX.....XXX.",
  "...XXXXXXX...",
];


/** La lengua, rosa, por dentro del aro. */
const LENGUA = ["XXX", "XXX"];

/**
 * La vuelta de la lengua: seis paradas, cada una con **el resto que le toca
 * borrar** encima del borde y la lengua justo por dentro.
 *
 * El aro **no gira**. Lo que viaja es dónde está encendida la lengua, que es el
 * mismo truco del aro de los ojos en el estreno de versión — y por el mismo
 * motivo: un círculo girando a esta escala es una mancha.
 *
 * Lo que hace que se lea como *limpiar* y no como *sacar la lengua* es dónde va
 * el verde: **encima del labio**, no al lado de la cara. Un pegote suelto junto a
 * una cara es una mota; el mismo pegote sobre el borde de la boca es suciedad. Y
 * en cada cuadro se pintan **sólo los restos que faltan por limpiar**, así que la
 * cara va quedando limpia a la vista.
 */
const VUELTA: { resto: [number, number]; lengua: [number, number] }[] = [
  { resto: [23, 5], lengua: [22, 6] },
  { resto: [27, 7], lengua: [24, 7] },
  { resto: [23, 11], lengua: [22, 9] },
  { resto: [19, 11], lengua: [19, 9] },
  { resto: [16, 7], lengua: [18, 7] },
  { resto: [19, 5], lengua: [19, 6] },
];

const LIMPIADA_LENGUA: Variant = {
  status: "Ya, ya…",
  scene: `<g class="a-vagon">${spr(VAGONETA, 9, 14)}${par(BRAZO_ABAJO, BRAZO_ABAJO)}${flip(
    [
      ...VUELTA.map(
        (paso, k) =>
          eyes(OJO_ANCHO, 2) +
          spr(BOCA_REDONDA, 16, 5) +
          // Los restos que aún no ha limpiado.
          VUELTA.slice(k + 1)
            .map((r) => spr(tint(RESTO, "m"), r.resto[0], r.resto[1]))
            .join("") +
          spr(tint(LENGUA, "p"), paso.lengua[0], paso.lengua[1]),
      ),
      // Se lo traga.
      eyes(OJO_ANCHO, 2) + spr(BOCA_CHICA, 21, 8),
      // Y se le pasó: sonríe y suelta el destello de «quedó limpio». Dos
      // columnas más allá del ojo: en (31, 3) se tocaban y se leían como una
      // sola mancha, un ojo con un pegote naranja.
      eyes(OJO_ARCO, 2) +
        spr(SONRISA, 18, 8) +
        spr(tint(CHISPITA, "w"), 33, 2),
    ],
    `${LIMPIA_LENGUA_MS / 1000}s`,
  )}</g>`,
};

/**
 * Bajarse del carrito: la barandilla se levanta y el bicho se queda curioseando.
 *
 * Existe porque sin ella la transición mentía. Al soltar la onda, la carita
 * saltaba de golpe a una de reposo —y con frecuencia a la de estar dormido—, o
 * sea que el bicho pasaba de una montaña rusa a roncar en un fotograma. Esto es
 * el puente: se levanta la barandilla, se va, y lo que queda es una cara mirando
 * a los lados como quien acaba de bajarse y no sabe muy bien dónde está.
 *
 * La barandilla sube **con las manitas pegadas a ella**, como cuando te quitas
 * unos audífonos: si sube sola parece que se abre el carrito, y si suben sólo
 * las manos no se entiende qué empujan. Al llegar arriba se desvanece, y ahí se
 * queda la cara sola.
 *
 * Seis cuadros en 1,2 s, y el HUD la enseña **una sola vuelta**: es una
 * transición, no un estado.
 *
 * La boca va en **todos** los cuadros. En la primera versión sólo la tenía el
 * último y se veía exactamente como lo que era: una cara sin boca hasta que
 * terminaba de subir la barandilla.
 */
export const BAJANDO: Variant = {
  status: "Uf…",
  scene: `${spr(VAGONETA, 9, 14)}${flip(
    [
      // Agarrada, todavía abajo.
      spr(tint(BARANDILLA, "a"), 10, 12) +
        par(BRAZO_ABAJO, BRAZO_ABAJO) +
        eyes(OJO, 2) +
        spr(BOCA_CHICA, 21, 9),
      // Empieza a subir; las manos van pegadas.
      spr(tint(BARANDILLA, "a"), 10, 9) +
        par(ABANICO_MEDIO, ABANICO_MEDIO) +
        eyes(OJO, 2) +
        spr(BOCA_CHICA, 21, 9),
      spr(tint(BARANDILLA, "a"), 10, 6) +
        par(BRAZO_ABIERTO, BRAZO_ABIERTO) +
        eyes(OJO, 2) +
        spr(BOCA_CHICA, 21, 9),
      // Arriba del todo, a la altura de la cápsula.
      spr(tint(BARANDILLA, "a"), 10, 2) +
        par(BRAZO_RECTO, BRAZO_RECTO) +
        eyes(OJO, 2) +
        spr(BOCA_CHICA, 21, 9),
      // Se va, y las manos bajan.
      par(BRAZO_ABAJO, BRAZO_ABAJO) + eyes(OJO, 2) + spr(BOCA_CHICA, 21, 9),
      // Y se queda mirando a un lado: ya está en el suelo.
      eyes(OJO, 2) + spr(RAYA, 20, 9),
    ],
    "1.2s",
  )}`,
};

/**
 * En reposo, curioseando: los ojos miran a un lado y a otro.
 *
 * Es donde aterriza el bicho después de bajarse del carrito, y por eso mira
 * alrededor en vez de quedarse quieto: acaba de llegar. La pupila se desplaza
 * dentro del ojo en lugar de moverse el ojo entero — mover el ojo completo se
 * lee como que tiembla la cara, mover lo de dentro se lee como que mira.
 */
export const CURIOSEANDO: Variant = {
  status: "",
  scene: `${flip(
    [
      spr(["XXX", "X..", "X..", "XXX"], LX, 2) + spr(["XXX", "X..", "X..", "XXX"], RX, 2),
      spr(OJO, LX, 2) + spr(OJO, RX, 2),
      spr(["XXX", "..X", "..X", "XXX"], LX, 2) + spr(["XXX", "..X", "..X", "XXX"], RX, 2),
      spr(OJO, LX, 2) + spr(OJO, RX, 2),
    ],
    "2.4s",
  )}${spr(RAYA, 20, 9)}`,
};

/**
 * Las dos versiones de limpiarse, y **se quedan las dos**.
 *
 * Iban a competir y al verlas animadas ganaron las dos, así que el HUD **sortea**
 * cuál sale cada vez que el bicho acaba de vomitar. Es la misma idea que ya rige
 * las 26 caritas del dictado —cinco variantes por estado, elegidas al azar— y
 * por el mismo motivo: lo que hace que una mascota se sienta viva es que no
 * sepas exactamente qué va a hacer.
 *
 * Siempre **después del vómito**, nunca sueltas: son el final de esa historia y
 * fuera de ella no significan nada.
 *
 * La de la servilleta **no salía nunca**, aunque el sorteo era limpio. El HUD
 * dejaba la limpiada 0,9 s a la vista, y si seguías zarandeando el siguiente
 * meneo la devolvía al vómito a los 0,6: a la de la lengua le daba tiempo de
 * enseñar su vuelta, a la de la servilleta no le daba ni para una pasada. Ahora
 * el HUD la enseña **entera, una sola vez** (`ms`), se queda en su último
 * cuadro y no hay meneo que la interrumpa: es el final de la historia.
 */
export const LIMPIADAS: { nombre: string; v: Variant; ms: number }[] = [
  { nombre: "Con servilleta en la mano", v: LIMPIADA_SERVILLETA, ms: LIMPIA_SERVILLETA_MS },
  { nombre: "Con la lengua", v: LIMPIADA_LENGUA, ms: LIMPIA_LENGUA_MS },
];

export const MAREO: Variant[] = [
  {
    // 1 · Mareada. Los ojos hacen balancín en contrafase —el izquierdo arriba
    // mientras el derecho abajo— que es lo que de verdad lee como "todo me da
    // vueltas"; el espiral clásico a 3 px se convierte en una mancha. La cara
    // entera se bambolea un píxel a cada lado y dos chispas le giran encima.
    status: "Me mareas",
    // Los brazos suben y bajan **en fase**, como abanicándose. Aquí sí van a la
    // vez y no en contrafase: abanicarse es un gesto simétrico, y alternarlos
    // volvería a leerse como saludar, que es lo que hace la carita anterior.
    scene: `${escenario(
      flip(
        [
          par(BRAZO_ABIERTO, BRAZO_ABIERTO),
          par(ABANICO_MEDIO, ABANICO_MEDIO),
          par(ABANICO_BAJO, ABANICO_BAJO),
          par(ABANICO_MEDIO, ABANICO_MEDIO),
        ],
        ".56s",
      ),
    )}<g class="a-mareo">${flip(
      [
        spr(OJO, LX, 2) + spr(OJO_MEDIO, RX, 4),
        spr(OJO_MEDIO, LX, 3) + spr(OJO_MEDIO, RX, 3),
        spr(OJO_MEDIO, LX, 4) + spr(OJO, RX, 2),
        spr(OJO_MEDIO, LX, 3) + spr(OJO_MEDIO, RX, 3),
      ],
      "1.28s",
    )}${spr(ZIGZAG, 18, 9)}</g>
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
    // La onda de medusa: la pose recorre los dos brazos con un cuadro de desfase,
    // así que lo que se ve no es un sube-y-baja sino algo que **viaja** de un
    // lado al otro. Tres cuadros es el mínimo para que una onda se lea como onda.
    scene: `${escenario(
      flip(
        ONDA.map((o) => par(o, o)),
        ".6s",
      ),
    )}<g class="a-glup">${flip(
      [eyes(OJO, 2), eyes(OJO_ANCHO, 2), eyes(OJO, 2), eyes(OJO_ANCHO, 2)],
      ".64s",
    )}${flip(
      [
        spr(RAYA, 20, 9),
        // La raya de la boca sigue dentro del bulto: sin ella el hueco se leía
        // como una bocaza abierta, que es justo lo contrario de aguantarse.
        spr(CARRILLOS_MEDIO, 17, 8) + spr(RAYA, 20, 9),
        spr(CARRILLOS_LLENO, 15, 7) + spr(RAYA, 20, 9),
        spr(BOCA_CHICA, 21, 9),
      ],
      "1.28s",
    )}</g>
      <g class="a-sudor">${spr(tint(GOTA, "s"), 33, 4)}</g>`,
  },
  {
    // 3 · Ya no aguantó, y no una vez: **tres**, cada una peor que la anterior.
    //
    // Es la tercera vez que lo mareas, así que la historia no es «vomita», es
    // «vomita, coge aire, vuelve a vomitar, y la tercera es la mala». Seis
    // tiempos: tres arcadas y sus tres sueltas, la última con la boca abierta
    // del todo y la plasta colgando.
    //
    // El charco crece en tres escalones y **no se va**: los tamagotchi ponen el
    // significado en el símbolo de al lado y no en la cara, así que lo que
    // cuenta cuánto ha vomitado es el charco del suelo, no su expresión.
    status: "¡Blegh!",
    // Aquí los brazos **no se mueven**: te agarras. Un saludo mientras vomitas
    // contaría dos cosas a la vez y no se leería ninguna.
    scene: `${escenario(par(BRAZO_RECTO, BRAZO_RECTO))}
      <g class="a-arcada">${flip(
      [
        eyes(OJO_ANCHO, 2),
        eyes(OJO_ARCO, 3),
        eyes(OJO_ANCHO, 2),
        eyes(OJO_ARCO, 3),
        eyes(OJO_ANCHO, 2),
        eyes(OJO_MEDIO, 4),
      ],
      "2.4s",
    )}${flip(
      [
        // Arcada 1 y su suelta.
        spr(BOCA_O, 20, 8),
        spr(BOSTEZO, 19, 7),
        // Arcada 2, ya con la boca más abierta.
        spr(BOCA_O, 20, 8),
        spr(BOSTEZO, 19, 7),
        // Arcada 3: la mala. Boca de par en par y la plasta colgando.
        spr(BOCA_O, 20, 8),
        spr(BOSTEZO, 19, 7) + spr(tint(PLASTA, "m"), 21, 11),
        // El último cuadro: la boca ya chica, y nada más.
        //
        // Aquí hubo una manita limpiándosela y **se leía como una segunda
        // boca**: `MANO` y `BOCA_CHICA` son el mismo sprite —un bloque de
        // 3×2— y estaban a una sola columna de distancia. Dos bloques
        // idénticos separados por un píxel no son una cara limpiándose, son
        // dos bocas. Se quita y ya está: de limpiarse se encarga el cuadro
        // siguiente, que es una escena entera dedicada a eso.
      ],
      "2.4s",
    )}</g>
      <!-- Las tres sueltas. Mismo recorrido, distinto retraso y distinto
           tamaño: la primera son dos motas, la segunda tres, y la tercera es
           una sopa. Escalar el tamaño es lo que cuenta que va a peor; repetir
           lo mismo tres veces sólo contaría que se repite. -->
      <g class="v-uno">${spr(tint(PUNTO, "m"), 26, 9)}</g>
      <g class="v-uno dos">${spr(tint(PUNTO, "m"), 26, 10)}</g>
      <g class="v-dos">${spr(tint(PUFF, "m"), 26, 9)}</g>
      <g class="v-dos dos">${spr(tint(PUFF, "m"), 26, 10)}</g>
      <g class="v-dos tres">${spr(tint(PUNTO, "m"), 27, 8)}</g>
      <g class="v-tres">${spr(tint(PUFF, "m"), 26, 8)}</g>
      <g class="v-tres dos">${spr(tint(CHARCO_CHICO, "m"), 26, 10)}</g>
      <g class="v-tres tres">${spr(tint(PUFF, "m"), 27, 11)}</g>
      <g class="v-tres cuatro">${spr(tint(PUNTO, "m"), 28, 9)}</g>
      <g class="a-charco1">${spr(tint(CHARCO_CHICO, "m"), 33, 15)}</g>
      <g class="a-charco2">${spr(tint(CHARCO, "m"), 32, 15)}</g>
      <g class="a-charco3">${spr(tint(CHARCO_GRANDE, "m"), 31, 15)}</g>`,
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
const FLIP_CSS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
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
  /* Igual que el flipbook: los pasos de una historia nacen apagados y los
     enciende su propio fotograma. Sin esto se ven todos encimados el
     instante que va entre que se pinta el SVG y arranca la animacion. */
  .seq > g { opacity: 0; }
${FLIP_CSS}
  /* Una sola vuelta: las transiciones -bajarse del carrito, limpiarse- se
     ensenan una vez y se quedan en su ultimo cuadro. En bucle, el fundido de
     salida pillaba otra vez el primero: la barandilla volvia a bajar, o la boca
     volvia a estar sucia, justo al irse. Mas especifico que las reglas del
     flipbook de arriba a proposito, para ganarles sin importante. */
  .tama.una-vez .flip > g { animation-iteration-count: 1; animation-fill-mode: forwards; }
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
  /* Lo que sube por su carril (notas, ZZZ): diez casillas en el 60 % del
     ciclo, a saltos de un pixel, con un vaiven de un pixel a media subida, y
     el 40 % restante el carril vacio. Que el carril se vacie antes de volver a
     salir es lo que garantiza que dos notas no se monten nunca. La duracion NO
     va aqui: viaja inline y literal en cada carril, como en todas las caritas.
     (Ni un acento grave en estos comentarios: FACE_CSS es un template literal.) */
  @keyframes asciende {
    0% { transform: translate(0, 0); opacity: 1; }
    6% { transform: translate(0, -1px); }
    12% { transform: translate(0, -2px); }
    18% { transform: translate(1px, -3px); }
    24% { transform: translate(1px, -4px); }
    30% { transform: translate(1px, -5px); }
    36% { transform: translate(0, -6px); }
    42% { transform: translate(0, -7px); }
    48% { transform: translate(0, -8px); }
    54% { transform: translate(0, -9px); opacity: 1; }
    60%, 100% { transform: translate(0, -9px); opacity: 0; }
  }
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
    animation-duration: 2.8s;
    animation-iteration-count: 1;
    animation-fill-mode: forwards;
  }

  .u-ini { animation-name: u-ini; animation-timing-function: steps(1, end); }
  @keyframes u-ini { 0%, 6% { opacity: 1; } 7%, 100% { opacity: 0; } }

  .u-carga { opacity: 0; animation-name: u-carga; animation-timing-function: steps(1, end); }
  @keyframes u-carga { 0%, 5% { opacity: 0; } 6%, 67% { opacity: 1; } 68%, 100% { opacity: 0; } }
  /* Los dos flipbooks arrancan cuando arranca su tiempo, no cuando se monta la
     escena: si no entran a media vuelta y la tercera boca se queda fuera. Un
     ciclo de bocas y dos de ojos caben justos en los 720 ms. */
  .u-carga .flip > g { animation-delay: .17s; }

  /* La barra. Molde de .cinta —scaleX con el origen a la izquierda— pero la
     escala la pone un keyframe y no una variable. A tirones y no lisa: un
     relleno continuo se lee como decoración, a saltos se lee como trabajo.
     El .55 de opacidad NO es decoración: menta maciza contra la cara da 3,8:1
     en claro pero 1,45:1 en oscuro, donde la cara desaparecería. */
  .u-barra { position: absolute; inset: 0; z-index: -1; background: var(--m);
             opacity: .55; transform-origin: left center; transform: scaleX(0);
             animation-name: u-barra; animation-timing-function: steps(1, end); }
  @keyframes u-barra {
    0%, 6% { transform: scaleX(0); }
    14% { transform: scaleX(.11); }
    23% { transform: scaleX(.19); }
    32% { transform: scaleX(.34); }
    41% { transform: scaleX(.46); }
    50% { transform: scaleX(.58); }
    59% { transform: scaleX(.81); }
    67% { transform: scaleX(1); opacity: .55; }
    69%, 100% { transform: scaleX(1); opacity: 0; }
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
  @keyframes u-blanco { 0%, 66% { opacity: 0; } 68%, 77% { opacity: 1; } 87%, 100% { opacity: 0; } }

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
  /* Un solo recorrido para las tres sueltas: sale de la boca, describe el arco
     hacia la derecha y se apaga al llegar al suelo. En arco y no a plomo porque
     cayendo recto se sale del lienzo — la boca ya acaba en y=14 de 17. */
  @keyframes chorro { 0%, 6% { transform: translate(0, 0); opacity: 0; }
                      8% { transform: translate(0, 0); opacity: 1; }
                      12% { transform: translate(2px, 1px); }
                      16% { transform: translate(4px, 2px); }
                      20% { transform: translate(6px, 3px); }
                      24% { transform: translate(8px, 4px); opacity: 1; }
                      26%, 100% { opacity: 0; } }
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
  @keyframes charco { 0%, 22% { opacity: 0; } 26%, 100% { opacity: 1; } }
  @keyframes charco2 { 0%, 55% { opacity: 0; } 59%, 100% { opacity: 1; } }
  @keyframes charco3 { 0%, 88% { opacity: 0; } 92%, 100% { opacity: 1; } }

  @keyframes eructo { 0% { transform: translate(0, 0); opacity: 0; }
                      75% { transform: translate(0, 0); opacity: 1; }
                      81% { transform: translate(2px, -1px); opacity: 1; }
                      87% { transform: translate(4px, -2px); opacity: 1; }
                      93% { transform: translate(6px, -3px); opacity: 1; }
                      100% { transform: translate(8px, -4px); opacity: 0; } }

  .a-resp { animation: resp 2s steps(1, end) infinite; }
  .a-mira { animation: mira 2.4s steps(1, end) infinite; }
  /* La pupila que sigue al cursor. Va con TRANSICION y no con animacion porque
     lo que manda es una posicion, no un ciclo. Y la transicion corta no es
     decoracion: hace que el ojo llegue con un pelin de retraso, que es lo que lo
     hace parecer vivo en vez de pegado al raton. */
  /* La pupila salta de casilla en casilla (-1, 0, 1): el HUD sólo escribe
     enteros. Sin transición a propósito, que deslizándose pasaría por medio
     píxel igual que cualquier otro sprite. */
  .a-pupila { transform: translate(calc(var(--mx, 0) * 1px), calc(var(--my, 0) * 1px)); }
  .a-asiente { animation: asiente .8s steps(1, end) infinite; }
  .a-atento { animation: atento .9s steps(1, end) infinite; }
  .a-busca { animation: busca 1.2s steps(1, end) infinite; }
  .a-piensa { animation: piensa 1.6s steps(1, end) infinite; }
  .a-leer { animation: leer .52s steps(1, end) infinite; }
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
  .a-arcada { animation: arcada 2.4s steps(1, end) infinite; }
  /* Las tres sueltas comparten recorrido y se separan por el retraso: cada una
     sale justo cuando su arcada abre la boca (a 1/6, 3/6 y 5/6 del ciclo). */
  .v-uno, .v-dos, .v-tres {
    opacity: 0; animation-name: chorro; animation-duration: 2.4s;
    animation-timing-function: steps(1, end); animation-iteration-count: infinite;
  }
  .v-uno { animation-delay: 0s; }
  .v-dos { animation-delay: .8s; }
  .v-tres { animation-delay: 1.6s; }
  /* Dentro de cada suelta, las piezas salen escalonadas: juntas se leen como
     una bola, escalonadas como un chorro. */
  .dos { animation-delay: calc(var(--t, 0s) + .07s); }
  .v-uno.dos { --t: 0s; }
  .v-dos.dos { --t: .8s; }
  .v-tres.dos { --t: 1.6s; }
  .tres { animation-delay: calc(var(--t2, 0s) + .14s); }
  .v-dos.tres { --t2: .8s; }
  .v-tres.tres { --t2: 1.6s; }
  .cuatro { animation-delay: 1.81s; }
  /* El charco no se va: crece un escalón por arcada y se queda. Es lo que
     cuenta cuánto ha vomitado — la cara ya no puede contarlo más. */
  .a-charco1 { opacity: 0; animation: charco 2.4s steps(1, end) infinite; }
  .a-charco2 { opacity: 0; animation: charco2 2.4s steps(1, end) infinite; }
  .a-charco3 { opacity: 0; animation: charco3 2.4s steps(1, end) infinite; }

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
