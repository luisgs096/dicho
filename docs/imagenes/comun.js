/* Piezas compartidas por las tres páginas que se convierten en PNG del README.
   Todo sale de faces.ts: lo que se ve aquí es exactamente lo que ve el usuario. */

const VARS = Object.entries(FACES.cssVars(false))
  .map(([k, v]) => `${k}:${v}`)
  .join(";");

/** La cápsula completa, igual que la monta Hud.tsx. */
function capsula(v, opts = {}) {
  const sad = opts.sad ? "sad" : "";
  const texto = opts.texto ? "texto" : "";
  return `<div class="tama ${sad}" style="${VARS}" id="${opts.id || ""}">
    <div class="screen">
      <span class="mic-px">${FACES.MIC_SVG}</span>
      <span class="scene"><svg viewBox="0 2 48 16">${v.scene}</svg></span>
      <span class="status ${texto}">${v.status}</span>
    </div>
  </div>`;
}

/** Sólo la pantalla, para la rejilla de las 26. */
function mini(v, opts = {}) {
  return `<div class="mini ${opts.sad ? "sad" : ""}" style="${VARS}" id="${opts.id || ""}">
    <svg viewBox="0 2 48 16">${v.scene}</svg>
  </div>`;
}

/**
 * Un PNG no anima: hay que congelar cada carita en un fotograma donde se le vea
 * el gesto. Se pausa todo y se retrocede el reloj con un delay negativo — por
 * eso cada carita lleva el suyo, según en qué punto de su bucle luce mejor.
 */
function congelar(reglas) {
  const css = Object.entries(reglas)
    .map(([id, t]) => `#${id} * { animation-delay: ${t} !important; }`)
    .join("\n");
  document.head.insertAdjacentHTML(
    "beforeend",
    `<style>
       * { animation-play-state: paused !important; animation-delay: -.5s !important; }
       ${css}
     </style>`,
  );
}

const CSS_BASE = `
  ${FACES.FACE_CSS}
  * { box-sizing: border-box; }
  body { margin: 0; zoom: 2;
         font-family: "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif;
         -webkit-font-smoothing: antialiased; }
  .mini { border-radius: 12px; background: var(--lcd); border: 1px solid var(--lcdBorder);
          box-shadow: inset 0 3px 10px rgba(10, 20, 40, .25); color: var(--face);
          position: relative; overflow: hidden; display: flex; align-items: center;
          padding: 0 8px; width: 136px; height: 58px; }
  .mini::before { content: ""; position: absolute; inset: 0; pointer-events: none;
    background-image: linear-gradient(var(--grid) 1px, transparent 1px),
                      linear-gradient(90deg, var(--grid) 1px, transparent 1px);
    background-size: 3px 3px; }
  .mini svg { width: 100%; height: 46px; shape-rendering: crispEdges; display: block; }
  .mini.sad { background: var(--warnLcd); border-color: var(--warnBorder); color: var(--w); }
`;
