import crudo from "../../CAMBIOS.md?raw";

/** Lo que trajo una versión: el encabezado `## X.Y.Z — fecha` y sus guiones. */
export interface Cambio {
  version: string;
  fecha: string;
  bullets: string[];
}

/**
 * Lee `CAMBIOS.md`, que viaja **dentro** del binario (`?raw` lo mete en el
 * bundle). Así las novedades están siempre a mano aunque no haya internet, sin
 * pedirle nada a GitHub — y hay una sola fuente: el mismo archivo del que
 * `publicar.ps1` saca las notas del Release.
 *
 * El formato es a propósito mínimo para que un `.ps1` también pueda leerlo con
 * una expresión regular: encabezado `## X.Y.Z — fecha` y guiones debajo. Todo lo
 * demás (párrafos de introducción, otros títulos) se ignora.
 */
function parsear(texto: string): Cambio[] {
  const out: Cambio[] = [];
  for (const linea of texto.split(/\r?\n/)) {
    const cab = /^##\s+(\d+\.\d+\.\d+)\s*(?:[—–-]\s*(.*))?$/.exec(linea);
    if (cab) {
      out.push({ version: cab[1], fecha: (cab[2] ?? "").trim(), bullets: [] });
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(linea);
    if (bullet && out.length > 0) {
      out[out.length - 1].bullets.push(bullet[1].trim());
      continue;
    }
    // Continuación de un guión partido en varias líneas: se pega al anterior.
    const actual = out[out.length - 1];
    if (actual && actual.bullets.length > 0 && /^\s{2,}\S/.test(linea)) {
      actual.bullets[actual.bullets.length - 1] += " " + linea.trim();
    }
  }
  return out;
}

export const CAMBIOS: Cambio[] = parsear(crudo);

/**
 * El apartado de la versión que corre ahora mismo. Si no aparece —una compilación
 * local, o alguien que subió el número sin escribir el cambio— se devuelve el más
 * reciente, que es mejor que una pantalla vacía.
 */
export function cambioDe(version: string | null): Cambio | null {
  if (CAMBIOS.length === 0) return null;
  return CAMBIOS.find((c) => c.version === version) ?? CAMBIOS[0];
}

/** Quita el `**negritas**` del markdown: aquí se pinta como texto plano. */
export function sinMarcas(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`(.+?)`/g, "$1");
}
