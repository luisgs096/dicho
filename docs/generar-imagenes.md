# Regenerar las imágenes del README

Las tres imágenes (`banner.png`, `estados.png`, `caritas.png`) **no son capturas de
pantalla**: se pintan desde `src/windows/faces.ts`, el mismo archivo del que sale el HUD.
Por eso enseñan exactamente lo que ve el usuario al dictar, y por eso hay que rehacerlas
cuando se toca una carita.

## 1. Empaquetar el motor de caritas

`faces.ts` es TypeScript con `import`/`export`, así que un navegador no lo entiende tal
cual. Se aplana a un `faces.js` que deja el módulo en la variable global `FACES`:

```sh
npx esbuild src/windows/faces.ts --bundle --format=iife --global-name=FACES \
  --outfile=docs/imagenes/faces.js
```

Ese `faces.js` es un artefacto: se genera cada vez y no se commitea.

## 2. Abrir cada página y capturar

Las tres páginas de `docs/imagenes/` montan la cápsula con el mismo marcado que
`Hud.tsx` y el mismo CSS que exporta `faces.ts`. Se abren con `file://` en Chrome y se
captura **la ventana entera**, con el navegador puesto al tamaño exacto de cada una:

| Página | Tamaño de ventana | Sale en |
|---|---|---|
| `banner.html` | 1800 × 630 | `docs/banner.png` |
| `estados.html` | 1720 × 988 | `docs/estados.png` |
| `caritas.html` | 1880 × 1102 | `docs/caritas.png` |

Los tamaños son los de la página multiplicados por su `zoom` (1,5 el banner, 2 las otras
dos): así el PNG sale al doble de resolución de lo que GitHub muestra y el pixel-art se ve
limpio. Si cambia el contenido, el alto nuevo se mide con
`document.documentElement.scrollHeight` y se ajusta la ventana a esa cifra, para que no
quede una franja de fondo vacía debajo.

## Por qué hay que congelar las caritas

Un PNG no anima, y las caritas son puro fotograma: `.flip > g { opacity: 0 }` y la
animación es la que enciende el cuadro que toca. Si se captura sin más, cada carita sale en
un momento cualquiera de su bucle — y a algunas les pilla justo el cuadro en el que el
gesto todavía no ha entrado (el pulgar, la lágrima, el eructo salen tarde en su ciclo).

La función `congelar()` de `comun.js` para todas las animaciones y retrasa el reloj con un
`animation-delay` negativo, que en CSS equivale a "empieza ya empezada". Cada carita lleva
el suyo, elegido a ojo, en la tabla `RELOJ` de `caritas.html` y en `frames` de las otras
dos. Si se añade una carita hay que darle su instante; sin él usa el `-.5s` de por defecto,
que a la mayoría le sienta bien pero no a todas.

Cuidado también con qué carita va en el banner: la del DJ, con los audífonos encima, se lee
como una mancha en una imagen fija. La que está puesta (`escuchando[1]`, "Ajá, sigue…") son
dos ojos y una sonrisa, que es lo que se entiende de un vistazo.
