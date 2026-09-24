/**
 * Qué cambió entre el texto que escribiste y el que devolvió el escribano.
 *
 * Se compara por **piezas**: cada palabra y cada signo por separado. Si se
 * comparara por palabras con su puntuación pegada, añadir una coma haría que
 * «jaja» y «Jaja,» contaran como palabras distintas, y casi todo el mensaje
 * saldría marcado. Así «jaja» → «Jaja,» son dos cambios pequeños: una
 * mayúscula y una coma.
 *
 * Los cambios se agrupan en tres tipos porque no pesan lo mismo:
 *  - **errata**: cambiaron las letras («peod» → «pedo»). Es lo que importa ver.
 *  - **acento**: la misma palabra con otra tilde o mayúscula («fabian» → «Fabián»).
 *  - **signo**: sólo puntuación.
 */

export type Tipo = "errata" | "acento" | "signo";
export type Cambio = { antes: string; despues: string; tipo: Tipo };
/** Un trozo del texto tal cual, con el cambio al que pertenece (o ninguno). */
export type Tramo = { texto: string; cambio: number | null };

type Pieza = { t: string; i: number };

const PIEZA = /[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu;
const LETRA = /[\p{L}\p{N}]/u;

const piezas = (s: string): Pieza[] =>
  [...s.matchAll(PIEZA)].map((m) => ({ t: m[0], i: m.index ?? 0 }));

const sinMarcas = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const letras = (ps: Pieza[]) =>
  ps.filter((p) => LETRA.test(p.t)).map((p) => p.t).join(" ");

/** Parte el texto en tramos: cada pieza con su cambio, y el espacio entre dos
 *  piezas del mismo cambio va con ellas, para que «quién sabe» se marque
 *  entero y no como dos manchas. */
function tramos(texto: string, ps: Pieza[], de: (number | null)[]): Tramo[] {
  const out: Tramo[] = [];
  const poner = (t: string, c: number | null) => {
    if (!t) return;
    const ult = out[out.length - 1];
    if (ult && ult.cambio === c) ult.texto += t;
    else out.push({ texto: t, cambio: c });
  };
  let fin = 0;
  ps.forEach((p, k) => {
    const hueco = texto.slice(fin, p.i);
    poner(hueco, k > 0 && de[k - 1] !== null && de[k - 1] === de[k] ? de[k] : null);
    poner(p.t, de[k]);
    fin = p.i + p.t.length;
  });
  poner(texto.slice(fin), null);
  return out;
}

export function comparar(original: string, corregido: string) {
  const a = piezas(original);
  const b = piezas(corregido);
  // La subsecuencia común más larga, en tabla. Un mensaje de 800 palabras son
  // ~1.000 piezas por lado: un millón de casillas, nada.
  const n = a.length;
  const m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i][j] = a[i].t === b[j].t ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);

  const deA: (number | null)[] = new Array(n).fill(null);
  const deB: (number | null)[] = new Array(m).fill(null);
  const cambios: Cambio[] = [];
  const nuevo = (antes: string, despues: string): number => {
    const tipo: Tipo =
      !antes && !despues ? "signo" : sinMarcas(antes) === sinMarcas(despues) ? "acento" : "errata";
    cambios.push({ antes, despues, tipo });
    return cambios.length - 1;
  };
  // Un tramo seguido de piezas distintas, por índice en cada lado.
  let ha: number[] = [];
  let hb: number[] = [];
  const cerrar = () => {
    if (!ha.length && !hb.length) return;
    const esPalabra = (p: Pieza) => LETRA.test(p.t);
    const pa = ha.filter((k) => esPalabra(a[k]));
    const pb = hb.filter((k) => esPalabra(b[k]));
    if (pa.length && pa.length === pb.length) {
      // Tantas palabras de un lado como del otro: se emparejan una a una. Sin
      // esto, cinco palabras corregidas seguidas —sin nada igual entre ellas—
      // salían como un único cambio gigante.
      pa.forEach((ka, x) => {
        const kb = pb[x];
        if (a[ka].t === b[kb].t) return;
        deA[ka] = deB[kb] = nuevo(a[ka].t, b[kb].t);
      });
      const signos = [...ha.filter((k) => !esPalabra(a[k])), ...hb.filter((k) => !esPalabra(b[k]))];
      if (signos.length) {
        const id = nuevo("", "");
        ha.forEach((k) => !esPalabra(a[k]) && (deA[k] = id));
        hb.forEach((k) => !esPalabra(b[k]) && (deB[k] = id));
      }
    } else {
      // «quwienadeb» → «Quién sabe»: no hay pareja posible, va entero.
      const id = nuevo(letras(ha.map((k) => a[k])), letras(hb.map((k) => b[k])));
      ha.forEach((k) => (deA[k] = id));
      hb.forEach((k) => (deB[k] = id));
    }
    ha = [];
    hb = [];
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i].t === b[j].t) {
      cerrar();
      i++;
      j++;
    } else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) {
      hb.push(j++);
    } else {
      ha.push(i++);
    }
  }
  cerrar();
  return {
    antes: tramos(original, a, deA),
    despues: tramos(corregido, b, deB),
    cambios,
  };
}
