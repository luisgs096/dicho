# Dicho (codename mike) — notas de trabajo

App Tauri 2 + React 19 + Tailwind 4 de dictado push-to-talk para Windows. Ver README.md
para la descripción funcional. El usuario (luisg) dicta en español/spanglish y prueba la
app dictándole a Claude; prioriza soluciones locales y gratuitas.

## Cuando luisg diga "cierre"

Lo lleva la skill **`cierre`** (`~/.claude/skills/cierre/`): ahí está el procedimiento
entero y la plantilla. Lo esencial, por si la skill no está a mano:

Pide un **checkpoint escrito aquí**, no un resumen en el chat — trabaja con instancias que
no comparten memoria, así que lo que no quede en el `.md` se pierde. Vive en la sección
`## Checkpoint` de este archivo, **una sola**, y se **reescribe entera** cada vez:
consolidar, no apilar. Los títulos de sus subsecciones son un contrato con la skill de
status, que los lee para saber dónde estamos parados; no cambiarles el nombre.

Lo que **no** va en el checkpoint: los gotchas que costaron descubrir van a "Convenciones y
gotchas", y los cambios de arquitectura al "Mapa del código". El checkpoint es estado, no
conocimiento. Y se commitea con el resto.

## Mapa del código

- `src-tauri/src/pipeline.rs` — hilo central. Mientras grabas drena el micro cada 400 ms,
  remuestrea a 16 kHz de forma incremental y va soltando **trozos a transcribir en
  caliente** (20-55 s, cortados en tus pausas): al soltar la tecla sólo falta el último,
  así que un dictado de 10 min responde casi como uno de 20 s. Tope duro de 10 min: al
  llegar se autodetiene y transcribe lo grabado (antes tiraba el audio de más en
  silencio). Luego: compuerta de silencio (rms máx por ventana < 0.0012 → estado `empty`)
  → filtro de alucinaciones → polish → inyectar → historial. Carga perezosa de Parakeet (al pulsar el atajo, en hilo
  aparte) y liberación a los 10 s sin dictar. `diag()` escribe a
  `%APPDATA%/dev.mike.app/dicho.log` (sobrevive en release; cada dictado loguea su rms).
  `show_hud()` coloca el HUD en el **monitor activo** y deja un hilo
  vigilante (tick de 70 ms y luego 250 ms) que reafirma el topmost y lo recoloca
  si cambias de pantalla o de DPI. Dónde exactamente lo decide `place_hud()`:
  donde el usuario lo haya soltado arrastrándolo, o abajo-centro si nunca lo
  movió. Eso vive en `settings.hud_posiciones`: **una por pantalla** (la clave
  es el tamaño de su área de trabajo) y en **fracción del hueco libre**, no en
  píxeles. Así colocarlo en la 4K no lo mueve en el portátil, y el rincón
  elegido significa lo mismo en las dos.
  **El modo de colocación se borró el 17/09/2026** y con él `modo_colocar()`,
  el comando `hud_colocar` y la bandera `COLOCANDO`. Existía porque la onda sólo
  se arrastraba dándole permiso; desde que se arrastra siempre no decidía nada.
  Lo que sí heredó su trabajo: `hide_hud_later` y el final del estreno ahora
  miran `ARRASTRANDO`, que es lo que de verdad no se puede interrumpir — una
  onda que se esconde mientras la llevas agarrada.
- `src-tauri/src/chunker.rs` — dónde partir el audio: corta en pausas (4 ventanas de
  100 ms bajo un umbral relativo al pico del hablante), nunca en seco. Con tests.
- `src-tauri/src/overlay.rs` — Win32 (windows-sys): área de trabajo del monitor de
  la ventana en primer plano (`GetForegroundWindow` → `MonitorFromWindow` →
  `rcWork`) y `SetWindowPos(HWND_TOPMOST, SWP_NOACTIVATE)`. Con dos pantallas el
  HUD salía siempre en el primario: parecía que no aparecía. También
  `arrastrar_con_cursor()`, que pega la ventana al cursor hasta que se suelta el
  botón: el arrastre nativo (`start_dragging()` → `WM_NCLBUTTONDOWN`) no sirve
  porque abre un bucle modal que **activa** la ventana, y el HUD es no activable
  a propósito para no robarle el foco a lo que estás escribiendo.
- `src-tauri/src/polish/groq.rs` — el pulido con IA, en **dos niveles**
  (`Nivel::Ordenado` y `Nivel::Estructurado`). Lo único que cambia entre ellos es
  el encargo del prompt y las guardas, pero el contrato es distinto: ordenar
  promete **tus palabras**, estructurar promete **tu idea** y para eso puede
  reescribir. Dos redes, y la segunda hubo que inventarla:
  `desvia_demasiado()` mira el tamaño (techo igual en los dos; suelo a la mitad
  en ordenado, a un sexto en estructurado, que para eso se pide) e
  `inventa_demasiado()` mira **de quién son las palabras**. La segunda existe
  porque con datos reales la longitud no separa: de los once dictados que el
  modelo contestó, tres quedaron en proporciones de 0,20 · 0,29 · 0,29 — justo
  lo que mide un buen resumen de un divague. Lo que sí los separa es que
  reordenar usa las palabras del hablante y contestar trae otras nuevas, así que
  se cuenta qué fracción de las palabras de 5+ letras ya estaba en el dictado.
  **Por debajo de una cuarta parte** se descarta y cae al pulido por reglas. El
  umbral era la mitad y se bajó midiendo: con el encargo de redactar, un buen
  texto usa sinónimos, y tres dictados reales dieron 44 %, 61 % y 73 % de
  palabras propias — al 50 % el primero se tiraba a la basura. Abajo hay sitio de
  sobra: cuando el modelo contesta en vez de escribir, el solape real es 0-10 %.
  Los conectores no cuentan (lista `ANDAMIO`): desde que el Editor tiene el
  encargo de cambiar muletillas por conectores, castigarlos sería castigar justo
  lo que se le pidió.
- `src-tauri/src/autotype.rs` + `ortografia.rs` — **corregir mientras escribes**
  (LABS, apagado de fábrica). Se cuelga del hook que ya existe en `hotkey.rs`:
  ya estábamos mirando cada tecla del sistema, así que abrir un segundo hook
  sería pagar dos veces. El hook sólo **decide**; teclear lo hace un hilo aparte,
  porque lo que corra dentro del callback bloquea el teclado de todo el sistema.
  Las teclas se traducen a texto con `rdev::Keyboard` + `KeyboardState::add()`,
  que pasa por `ToUnicodeEx` y por tanto respeta el layout real: acentos, ñ y
  teclas muertas salen bien sin mapear nada a mano.
  **La invariante de `ortografia.rs` es lo que hace esto seguro**: la tabla sólo
  puede poner tildes, nunca cambiar una letra, y hay un test que lo comprueba
  entrada por entrada. Corregir «qeu» por «que» obliga a adivinar qué quisiste
  escribir, y adivinar mal mientras escribes es peor que no corregir. La tabla
  deja fuera a propósito todo lo ambiguo —«hacia», «sabia», «seria», «cuando»,
  «titulo», «publico»—, donde la forma sin tilde también es palabra válida.
  El diccionario personal del usuario manda sobre la tabla y sí admite cambiar
  una palabra por otra, porque lo escribió él.
- `src-tauri/src/hotkey.rs` — hook global rdev; lee `settings.hotkey` en cada evento →
  cambios de atajo aplican en vivo sin reiniciar. **Escape mientras grabas manda
  `Cmd::Cancel`**: se tira el audio y no se transcribe nada. Ojo con la trampa —
  al cancelar el atajo *sigue apretado*, así que hay una bandera
  `esperando_soltar`; sin ella `all_down` seguiría siendo cierto y arrancaría un
  dictado nuevo en el acto.
- **La ventana del HUD mide 104 de alto** (96 → 112 → 104). Arriba asoma el botón
  del menú, que al pasarle el ratón crece y saca halo; el aire **no se reparte a
  medias**: la cápsula va pegada abajo (`items-end` + `pb-2`), así que quedan 22 px
  arriba y 8 abajo, y el halo se queda a 8,7 px del techo. **Ese número está en dos
  sitios y tienen que ir a la par**: `HUD_H` en `pipeline.rs` y el divisor de `--k`
  en `Hud.tsx`, que traduce el lienzo real a escala. Cambiar uno solo hace que todo
  el contenido crezca o encoja en esa proporción.
- **El menú vive en la onda, no en Ajustes** (`MenuOnda` en `Hud.tsx`). **Dos
  botones y ya** —clavarla y devolverla a su sitio—, los dos a la vista en
  cuanto le pasas el ratón por encima. Hubo un tercero (*cambiarla de sitio*) y
  un **+** que los desplegaba en abanico, y los dos se fueron el 17/09/2026 por
  el mismo motivo: la onda se arrastra sola, así que el modo sobraba y el
  abanico escondía dos botones detrás de un clic de más. Clavada
  (`settings.hud_pin`) la onda no se esconde nunca —`hide_hud_later` la deja en
  reposo en vez de ocultarla— y **atrapa el ratón sí o sí**, porque si no su
  propio menú sería un dibujo. En reposo se vela a `hud_opacidad_reposo`.
- `src-tauri/src/sync.rs` — OAuth Desktop de Google (PKCE + loopback, tokens en el
  Administrador de credenciales, servicio keyring `mike-dictado`) y sync de
  diccionario+historial como JSON en el appDataFolder de Drive, con fusión sin
  duplicados. Requiere client_id/secret que el usuario crea una vez (form guiado en
  Perfil). **Aún sin probar de punta a punta: falta que el usuario cree su cliente OAuth.**
- `src-tauri/src/store.rs` — SQLite (`mike.db`): history, dictionary, meta (email de
  Google, last_sync). La tabla `history` guarda, además del crudo y el pulido,
  **qué modo redactó de verdad** (`polish_mode`: el que salió, no el que se pidió —
  si el Editor se cae y entra el Estándar, se anota el Estándar) y los dos tiempos
  (`stt_ms`, `polish_ms`). Las columnas se añaden con `ALTER TABLE` cuyo error se
  ignora: no hay sistema de migraciones y para esto no hace falta. `Store::init_en`
  recibe una **carpeta**, no el `AppHandle`, porque tiene que poder correr antes de
  que Tauri construya la aplicación (ver el gotcha de `state()`).
  `add_history` recibe una struct `NuevoDictado` y no ocho parámetros posicionales:
  con tres enteros seguidos nadie acierta el orden y el compilador no avisa.
- `src/windows/TarjetaDictado.tsx` — una tarjeta del historial. Un renglón siempre
  visible (fecha, modo, cuántas correcciones) y el detalle detrás de un botón "i":
  los chips de corrección, los tiempos desglosados, las muletillas y los
  anglicismos. Al pasar el ratón por un indicador se resalta en el texto lo que
  cuenta, cada uno con su color, y si lo suyo vive en el otro texto la tarjeta
  cambia sola — las muletillas sólo existen en el crudo, las correcciones sólo en
  el final. Nada de esto guarda posiciones: los tramos se buscan cuando hacen
  falta. Ojo con el borde de palabra: el de JavaScript sólo cuenta ASCII, así que
  hay un `conBordes()` propio o "más bien" y "¿sabes?" no se cuentan jamás.
- `src/windows/Settings.tsx` — ventana principal con sidebar de tres: **Inicio**
  (editor visual del atajo con teclado laptop/extendido + la onda flotante entera:
  vista previa, "Ver las 26 caritas", "Mover la onda flotante", "Devolverla a su
  sitio" e interruptor de arrastrable), Diccionario, Historial (chips de correcciones
  + filtro), y **Ajustes** anclado abajo con lo de debajo del capó (motores, "no
  traducir", modelo local, key de Groq, cuenta de Google, autostart, novedades y
  actualizaciones). El reparto es deliberado: en Inicio lo que se usa a diario y se
  ve; en Ajustes lo que se toca una vez. Ojo: `update()` en este archivo es el que
  guarda **ajustes**, no el de versiones; el de versiones se destructura como
  `actualizacion`/`buscarActualizacion`.
- `herramientas/banco-de-prompts.py` — corre varias formulaciones del prompt contra
  dictados reales de `mike.db` y mide cuánto cambian de verdad (palabras, ratio,
  suspensivos, muletillas que sobreviven, si la salida es idéntica al crudo). Existe
  porque afinar un prompt a ojo no funciona: el modo Editor "parecía cambiar poco" y
  resultó que devolvía el dictado **idéntico** en dos de tres casos. Lee la key del
  Administrador de credenciales y nunca la imprime. Su cabecera documenta las tres
  trampas —el 403 de Groq a `Python-urllib`, los 6.000 tokens/minuto del plan gratis, y
  volcar el prompt compilado con `cargo test --lib volcado -- --ignored` en vez de
  copiarlo a mano—.
- `CAMBIOS.md` + `src/windows/cambios.ts` — qué trajo cada versión, en guiones. **Una
  sola fuente para dos consumidores**: la app lo importa con `?raw`, así que viaja
  dentro del binario y se lee sin internet (Ajustes → "Novedades de esta versión"), y
  `publicar.ps1` saca de ahí las notas del Release. El formato es mínimo a propósito
  —`## X.Y.Z — fecha` y guiones— para que una expresión regular de PowerShell también
  lo entienda. Si falta el apartado de la versión que se publica, `publicar.ps1`
  **aborta antes de compilar**, que enterarse a los 40 minutos es tirar el build.
- `src/windows/VistaPrevia.tsx` — los dos estilos de onda, animados y en el mismo
  punto del recorrido (te escucho → escribiendo → listo → no entendí), para elegir
  viendo en vez de leyendo una lista. Reusa `faces.ts`, o sea que enseña exactamente
  lo que saldrá al dictar. A tamaño real y sin escalar: el pixel-art se deforma.
- `src/windows/updater.ts` — hook `useUpdater()`: consulta la release más reciente al
  abrir Ajustes (callado si no hay nada o no hay internet, ruidoso sólo si el usuario
  pulsó el botón), descarga con progreso e instala. La verificación de firma la hace
  el plugin de Tauri, no este código.
- `src/windows/Animaciones.tsx` — catálogo modal de las 26 caritas, animándose de verdad.
  Importa `V`/`MIC_SVG`/`FACE_CSS` de `faces.ts`, o sea que muestra exactamente lo que
  verá el usuario al dictar; si se añade una carita, aparece aquí sola.
- `src/windows/faces.ts` — motor de caritas: sprites en mapas de texto, las 26
  escenas y el CSS (carcasa + animaciones). Reglas: coordenadas enteras, rejilla
  fija (ojos de 3 px en x=15 y x=27, cara centrada en 22), un gesto por carita,
  bucles ≤1,4 s y movimiento a `steps(1, end)` para que el pixel-art no tiemble.
  Desde el 28/08 hay dos reglas más: **ninguna carita tiene los ojos quietos** y
  el gesto de ojos no se repite entre caritas (es lo que las distingue cuando el
  accesorio se parece). El repertorio sale del vocabulario tamagotchi —abierto,
  con destello, de par en par, entrecerrado, cerrado, contento, caído, estrella,
  corazón, aspa— y **todos son de ancho impar**: `eyes()` centra con
  `(3 - ancho) / 2`, así que un ancho par los dejaría a medio píxel.
  Exporta `CARITA_COMILONA`/`CARITA_ERUCTO`, los dos índices que el HUD encadena,
  **`ACTUALIZADO`** (el estreno de versión: un solo reloj CSS de **1,8 s**,
  `forwards`, y todo **dentro de la cápsula normal**. Cinco tiempos: reposo →
  la cápsula se llena de izquierda a derecha en verde menta mientras los ojos
  giran y la boca pasa por tres gestos → destello blanco con el número de
  versión en grande → el blanco se funde → la cara se revela **píxel a píxel**.
  En el estilo clásico es igual pero al final se revelan las cinco barritas.
  Tres cosas que costó aprender:
  **(a)** la versión anterior era una película de 6 s en una ventana cuadrada de
  260×260 y **se saboteaba sola** — al volverse cuadrada disparaba un `resize`,
  el `resize` reescribía `--k`, y escribir una custom property en un ancestro
  recrea la animación desde cero. Por eso desapareció el modo cine, y no sólo
  por gusto.
  **(b)** los "ojos en espiral" **no son un espiral**: es un arco recorriendo un
  aro de 3×3 en un flipbook de 4 cuadros, en contrafase entre los dos ojos. El
  espiral dibujado ya falló dos veces, y está escrito en `OJO_ASPA` ("a 5 px se
  leía como una letra G") y en `MAREO` ("a 3 px se convierte en una mancha").
  **(c)** el revelado va por diagonal `x+y` en coordenadas **absolutas**, no por
  índice del sprite: por índice cada `spr()` reinicia en cero y los dos ojos y la
  boca aparecerían a la vez, como tres manchas. Para eso `spr()` acepta un cuarto
  parámetro opcional con el estilo por píxel.
  Y dos detalles que rompen en silencio: `.screen` necesita `isolation: isolate`
  o el `z-index:-1` de la barra se cuela detrás de la carcasa y **la barra no se
  ve**; y el `.55` de opacidad de la barra no es decoración, es contraste —
  menta maciza contra la cara da 1,45:1 en tema oscuro y la cara desaparece)
  **`RODANDO`** (la montaña rusa: sale mientras arrastras la onda — manitas en
  alto agitándose, bocaza abierta riendo y una vagoneta debajo) y **`MAREO`**,
  que ahora son **cuatro** y no tres: al zarandearla sube de mareada →
  aguantándose → vomita, y al acabar el vómito encadena sola con **limpiarse la
  boca con una servilleta** antes de fundir a una carita normal.

  Cuatro lecciones de dibujar la montaña rusa, todas pagadas en el banco de
  pruebas y todas del mismo tipo — **a 48×16 px el detalle no se lee, la
  silueta sí**:
  - **Los dientes van en una banda corrida.** Picados uno a uno (`XoXoXoXoX`) el
    usuario los describió como *"muy creepy"*: a 11 px de ancho eso no es una
    dentadura, es una boca de terror.
  - **Una boca abierta no puede tener la silueta de una cerrada.** Se probó con
    la forma de `SONRISOTA` —ancha arriba, en pico hacia abajo— y salía un
    cuenco. En una boca cerrada el pico **es** la sonrisa; en una abierta el
    pico pasa a ser el hueco de dentro, y un hueco triangular no se lee como
    boca. Rectángulo con las esquinas comidas.
  - **Y va hueca por dentro.** Es la que más costó ver: con la banda de dientes
    encima de una mancha maciza seguía siendo una cajita. El hueco *es* la boca
    abierta, y la banda sólo pasa a leerse como dentadura cuando hay algo
    detrás. No es una excepción al estilo — `BOSTEZO`, `CUENCA` y `MARCO` ya se
    dibujan huecos.
  - **Un brazo levantado tiene que llegar a algún sitio.** De cinco filas
    flotando arriba seguía siendo un corchete en la esquina; de once, naciendo
    pegado a la vagoneta, ya es un brazo. Y necesita el **entalle de muñeca**
    (la mano 2 px más ancha, el brazo estrechando detrás): sin él, mano y brazo
    son una sola barra.
  - **El espiral no se lee. Punto.** Es la convención universal de «mareado» y se
    ha intentado **tres veces**: a 3 px sale «una mancha» (`MAREO`), a 5 px «una
    letra G» (`OJO_ASPA`), y a **7 px** —probado en el banco, dibujándose de
    fuera hacia dentro y también con un tramo viajando— sale un laberinto roto.
    El problema no es el tamaño y por eso agrandarlo no lo arregla: **una espiral
    es una línea de 1 px que se cruza consigo misma**, y sin medios tonos que
    separen las vueltas, las vueltas se tocan. Lo que sí funciona para «esto está
    trabajando» es un marco hueco con una barra recorriéndolo — se lee como una
    pantalla refrescándose, que además es lo que de verdad está pasando.
  - **Un hueco suelto dentro de un bloque macizo se lee como un ojo.** Medido
    probándole un brillo a los ojos anchos: el píxel apagado los convertía en
    gafas huecas, no en ojos con luz. A este tamaño el ojo gana siempre, así que
    un detalle interior tiene que ser una **línea que cruce** —como la banda de
    dientes— y nunca un punto aislado.
  - **Saludar no es subir y bajar el brazo entero.** Con los dos cuadros
    separados por un píxel la mano no se lee agitándose, se lee temblando; y
    subiendo el brazo completo dos píxeles se lee dando botes. Lo que sí se lee
    es **el hombro clavado y la mano barriendo dos columnas**, con el antebrazo
    inclinándose para alcanzarla, y los dos brazos **en contrafase** — uno abre
    mientras el otro cierra. Los dos a la vez se leen como un dibujo que se
    estira.
  - **Un brazo levantado es una vertical gruesa, no una diagonal.** Se
    descartaron tres: en diagonal larga salían dos corchetes, corta salían dos
    piedrecitas, y la manita suelta sin brazo salían dos orejas. La diagonal a
    esta escala no es una línea inclinada, es una escalera.
  - **Un objeto suelto a la altura de la boca se lee como otra boca.** Le pasó
    al antebrazo con el que se limpiaba: como sprite suelto parecía primero una
    linterna y luego una segunda boca, y sólo funcionaba anclándolo al borde del
    lienzo, para que se leyera como algo que *entra*.
    Lo que lo resolvió del todo fue cambiar de objeto: una **servilleta** no
    necesita el truco del borde porque tiene identidad propia —las dos bandas
    que la cruzan— y no es un trozo de cuerpo que tenga que venir de algún
    sitio. Cuando una forma necesita un apaño para leerse, a veces el apaño no
    es la respuesta: es que la forma está mal elegida.

  Y una regla de proceso: **el carrito no puede ganarle sitio a la cara**. La
  primera vagoneta era una caja de cinco filas y el conjunto se leía como una
  carita encima de una mesa; tres filas dicen lo mismo y dejan el lienzo para el
  bicho.

  Las tres del mareo salen al zarandear la onda mientras la arrastras. Van **fuera de `V`** a propósito, que
  si no saldrían al azar en mitad de un dictado. Dos aprendizajes de dibujarlas:
  los cachetes sueltos a los lados se leen como **orejas** —hay que hinchar toda
  la parte baja de la cara de un trazo, y dejar la raya de la boca dentro para que
  no parezca una bocaza— y el chorro tiene que salir **en arco hacia la derecha**,
  porque cayendo a plomo se sale del lienzo (la boca ya acaba en y=14 de 17).
  El detector del zarandeo vive en Rust (`overlay::Meneo`, con 4 tests): durante
  el arrastre la ventana persigue al cursor, así que **visto desde el webview el
  ratón no se mueve ni un píxel**.
  **De la limpiada no se sale con un corte**: el HUD pone la clase `fundido`, la
  pantalla baja a opacidad 0 en 200 ms, se cambia la escena por debajo y vuelve
  a subir. Pasar de vomitar a sonreír en un fotograma se veía como un fallo de
  dibujo y no como que se le pasó — el mismo motivo por el que existe el
  destello de `relevo` entre escalón y escalón.
  Se previsualiza con `npx esbuild src/windows/faces.ts --bundle --format=iife
  --global-name=FACES` + una página que pinte `FACES.V`.
- **El stand-by son historias de un minuto, no gestos de cinco segundos**
  (`secuencia()` en `faces.ts`). `flip()` reparte el tiempo en partes iguales y
  tiene tope de doce cuadros: sirve para un gesto, no para una historia. Con
  partes iguales no puedes mascar cuatro veces de un lado y dos del otro.
  `secuencia()` es lo mismo con **duraciones libres por cuadro y sin tope**, y
  como cada historia se sortea al vuelo, sus fotogramas **no pueden vivir en
  `FACE_CSS`** —que es fijo—: se generan y viajan en un `<style>` dentro de la
  propia escena, con nombres propios por tirada.
  Las cuatro historias (`CHICLE`, `SILBANDO`, `DORMIDO` y los ojos que siguen al
  cursor) traen **`fresco`**, una función que vuelve a sortear la escena. El HUD
  la llama en un `useMemo` con clave `[face, variant, isError]`: **sin el memo, la
  escena cambiaría en cada render** y React reescribiría el interior del `<svg>`
  sesenta veces por segundo, reiniciando la historia en cada fotograma.
  Lo que hace que un minuto no se sienta un bucle no es tener muchos dibujos: es
  que **el mismo dibujo dure distinto cada vez**. Es lo que hacen los tamagotchi
  de verdad, que alternan dos cuadros "tres o cuatro veces" y nunca las mismas, y
  es también por qué el reposo se lleva el presupuesto de animación: es el 90 %
  del tiempo que la mascota está a la vista.
  **El truco que lo abarata**: el meneo de cabeza del silbido, la respiración del
  dormido y la mandíbula del chicle van **anidados dentro de cada paso**, no como
  pasos sueltos —un minuto de vaivén serían trescientos pasos y así son treinta—.
  Y no se cortan al cambiar de paso porque las animaciones de CSS **arrancan
  todas a la vez**, así que van en fase aunque estén en grupos distintos.
- `src-tauri/src/commands.rs` — `hud_cursor` devuelve dónde está el cursor
  **respecto al centro de la onda**, de -1 a 1. Existe porque desde el webview no
  se puede saber: el HUD sólo recibe eventos de ratón cuando el cursor está
  encima de él. Lo pregunta la carita de los ojos que te siguen cada 70 ms y
  **sólo mientras esa carita está a la vista**; las otras cuatro no gastan nada.
  El divisor es una **distancia fija de 600 px** y no el tamaño de la pantalla:
  así los ojos llegan al tope del recorrido a un palmo de la onda, en vez de
  necesitar cruzar un 4K entero para que la pupila se mueva un píxel.
- `src/windows/Hud.tsx` — HUD con dos estilos conmutables desde Ajustes
  (`settings.hud_style`, evento `settings-changed` para refrescar al vuelo). Se
  agarra por cualquier punto: el `pointerdown` sólo dispara `hud_arrastrar` y el
  seguimiento del cursor lo hace Win32, no el webview. Escucha `hud-colocar`
  para saber si está en modo colocación (aro punteado + "Arrástrame"):
  - `tamagotchi` (default): pantalla LCD pixel (viewBox `0 2 48 16`), 26 caritas =
    5 variaciones × 5 estados elegidas al azar por transición, reacción por idioma
    en "listo" (heurística es/en sobre el texto). La variable CSS `--lvl` lleva el
    volumen real del micro a las caritas reactivas (barras del DJ y onda del Pac-Man).
    La 26ª es el **eructo**, que no entra en el sorteo: `comioRef` recuerda si la
    carita de "te escucho" fue la comilona y sólo entonces `pick("listo")` lo devuelve.
  - `classic`: pill claro + 5 barras movidas por `audio-level` (rAF); en `empty` las
    barras se pintan naranjas, el fondo se tiñe, vibra y dice "Perdón, no escuché…".

## Convenciones y gotchas

- **`state()` de Tauri no devuelve un error: aborta el proceso.** Si un comando
  pide un estado que todavía no se registró con `manage()`, no hay `Result` que
  mirar — el proceso muere. Y el síntoma es de los peores: **la app se cierra
  sola, unas veces sí y otras no, sin dejar una línea en el log** porque muere
  antes de escribirla.
  La causa de que haya carrera es que la ventana `main` **nace visible**, así que
  su webview empieza a cargar en cuanto Tauri la crea —antes de que corra el
  `setup`— y llama a comandos nada más montarse. Cualquier `manage()` dentro del
  `setup` es una ruleta.
  La regla que queda: **el estado que un comando pueda pedir se registra en el
  Builder, no en el `setup`** (ver `run()` en `lib.rs`, que construye el Store y
  los ajustes antes de que exista ninguna ventana). Y donde eso no se pueda,
  `try_state` y degradar, nunca `state`.
  Dos trampas al diagnosticarlo, las dos pagadas el 16/09/2026:
  - **En debug no pasa nunca.** Es una carrera y el release llega antes. Un
    "no reproduce" en debug no significa nada.
  - **El ejecutable instalado no lleva símbolos** y el backtrace sale entero en
    `<unknown>`. El de `target/release` sí los tiene, por su `.pdb` al lado: hay
    que reproducirlo desde ahí. Eso fue lo que dio el nombre de la función.
- **Arreglar la mitad de una función es no arreglarla.** El mismo 16/09 se cambió
  `sync::status` a `try_state` y se dio el fallo por cerrado, pero **la primera
  línea de esa función llama a `credentials()`**, que seguía con `state()`. Nunca
  se llegaba al arreglo. Antes de dar por resuelto un crash, mirar a quién llama
  la función arreglada **antes** del punto que se tocó.
- Comentarios, commits y UI en español.
- La app instalada vive en `%LOCALAPPDATA%\Dicho\mike.exe` (NSIS per-user); el Run key
  de autostart apunta ahí. Los builds debug NUNCA tocan el autostart (guard).
- Instancia única por identifier `dev.mike.app`: cerrar Dicho antes de `tauri dev`.
- Ciclo de entrega usado: **cerrar `mike.exe` primero** (`Stop-Process`), `npm run tauri
  build` → instalar silencioso con `/S` → relanzar `mike.exe`. Si no se cierra antes, el
  instalador deja los archivos nuevos pero el proceso viejo sigue atendiendo el atajo y
  las pruebas mienten: se comprueba con
  `[Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($exe)).Contains("<cadena nueva>")`.
  La instalación mata la app en uso: avisar al usuario.
- **Publicar una versión para los demás**: `.\publicar.ps1 -Version X.Y.Z -Notas "…"`.
  Sube el número en los tres sitios (tauri.conf.json, package.json, Cargo.toml), compila
  firmando, arma `latest.json` y crea el Release en GitHub. La app consulta
  `releases/latest/download/latest.json` al abrir Ajustes.
- **La clave privada del updater vive en `%USERPROFILE%\.tauri\dicho.key`, fuera del
  repo.** Si se pierde, ninguna copia ya instalada podrá volver a actualizarse nunca:
  habría que reinstalar a mano en cada equipo. Conviene copiarla a un gestor de
  contraseñas. La pública va en `tauri.conf.json` y sí es publicable.
- El updater exige que el repo de GitHub sea **público**: los assets de un repo privado
  piden token y la app no lleva ninguno.
- WebView2 no reescala su lienzo cuando la ventana salta a un monitor con otro DPI:
  la ventana crece pero la web se queda pintando en una esquina. Hay que estirarlo a
  mano con `webview.set_bounds(...)` (`hud.as_ref(): &Webview`, sin necesitar la
  feature `unstable` de Tauri); eso además le actualiza el `devicePixelRatio`.
- **De ese mismo desfase salen barras de scroll que no se van** (visto en la
  0.7.0, arreglado en la 0.8.0). Mientras WebView2 anda con el lienzo viejo, el
  contenido escalado se desborda y Windows le mete barras de las de verdad
  —las que reservan 15 px— dentro del HUD: dos rayas en los costados y la
  carita encogida. No son las barras que aparecen al pasar el ratón, se quedan
  puestas: medido `scroll=360x96 client=345x81` bastante después del salto,
  frente a `scroll == client` siempre con el arreglo. Se corta de raíz con
  `html, body, #root { overflow: hidden }` en el CSS del **HUD**, nunca en
  `index.css`, que se comparte con la ventana de Ajustes y ésa sí necesita
  deslizarse. El HUD ahora se autodelata: si `scrollWidth` no cuadra con
  `clientWidth`, su log escribe `DESBORDE`.
- Traducción indeseada: **es Whisper, no el pulido**
 (medido: 0 de 120 dictados cambian de
  idioma entre `raw` y `polished` en `mike.db`). Whisper fija un idioma por ventana de 30 s
  y traduce el resto. Mitigaciones: no mandar nunca `language` (fijarlo empeora), `prompt`
  con una **muestra real de spanglish** en vez de instrucciones (el prompt guía estilo y
  ortografía, no obedece órdenes) y troceo por pausas para que cada trozo decida idioma.
  Interruptor `no_traducir` en Ajustes.
- Límites de Groq (plan gratis): 25 MB por archivo y **20 peticiones/minuto**. Trocear al
  soltar la tecla las reventaría; trocear mientras hablas sale a ~3/min.
- reqwest 0.13: `.form()`/`.query()` son features (`form`, `query`) — ya activadas.
- **BOM y PowerShell 5.1, en las dos direcciones** (los dos fallos de `publicar.ps1` el
  27/08):
  - Un `.ps1` **sin** BOM se lee como ANSI: un `—` en UTF-8 se convierte en `â€"`, y ese
    `"` final cierra la cadena y rompe el parseo. Los `.ps1` con acentos van con BOM.
  - `Set-Content -Encoding utf8` **añade** BOM, y ni el `JSON.parse` de Node
    (`package.json`) ni `serde_json` (`latest.json`) lo toleran. Para JSON hay que usar
    `[IO.File]::WriteAllText($ruta, $texto, (New-Object System.Text.UTF8Encoding($false)))`.
  - Antes de lanzar un script largo, validarlo gratis con
    `[System.Management.Automation.Language.Parser]::ParseFile(ruta, [ref]$null, [ref]$errs)`.
- **Firmar el updater desde un script: tres trampas encadenadas** (los tres fallos de la
  0.2.0 el 27/08). La clave `dicho.key` **no tiene contraseña**, pero:
  - Tauri exige que `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` **exista** aunque esté vacía. Si
    falta, abre un prompt interactivo que un script no puede contestar y muere con
    `failed to decode secret key: Wrong password for that key`.
  - Y **PowerShell no sabe crear una variable vacía**: `$env:X = ""` la *borra*. .NET sí,
    con `ProcessStartInfo.EnvironmentVariables["X"] = ""`, así que el build se lanza por
    ahí. Comprobable en 5 s sin compilar nada: pasarle la variable a
    `node -e "console.log(process.env.X === '' )"`.
  - Ese `ProcessStartInfo` tiene que apuntar a **`cmd.exe /c npm run …`**, no a `npm.cmd`
    a secas: lanzado directo, npm resuelve mal su propia carpeta y busca `npm-cli.js`
    dentro del proyecto (`Cannot find module 'C:\dev\Mike\node_modules\npm\bin\npm-cli.js'`).
  Además se re-firma aparte al terminar (`tauri signer sign … --password=""`, con el `=`
  **pegado**: separado, clap se come el argumento siguiente y toma la ruta del instalador
  como password). Es barato y garantiza que el `.sig` corresponde al instalador recién
  construido; un `.sig` viejo rompe la actualización en silencio.
- **Las notas del release van por archivo, no como argumento** (el fallo de la
  0.7.0, 28/08). PowerShell 5.1 no sabe pasarle a un `.exe` una cadena con
  comillas dentro: la parte en trozos, y `gh release create` toma las palabras
  sueltas como si fueran assets que subir. El síntoma no menciona ni comillas ni
  notas —``no matches found for `la` ``, por un "Mover la onda flotante" que
  llevaba el texto— y salta **después** de compilar y firmar, o sea con 5 min de
  build ya gastados. Se arregla con `--notes-file`, que no tiene nada que citar.
  Ojo si vuelve a pasar algo parecido: el instalador y el `.sig` ya están hechos
  y son válidos, así que basta con crear el release a mano en vez de repetir
  todo el `publicar.ps1`.
- **Nunca pongas la duración de una animación en una variable CSS** (el fallo de
  las caritas, 14/09). Los gestos se declaraban
  `animation: fl3_0 var(--d) steps(1, end) infinite`. Cuando algo escribe **otra**
  variable en la carita o en un ancestro —`--lvl`, el volumen de la voz— Chromium
  recalcula el subárbol, vuelve a resolver ese `var()` y **recrea la animación
  desde cero**. Como el HUD refresca `--lvl` en cada fotograma mientras grabas,
  **los gestos llevaban congelados desde siempre durante el dictado**: sólo se
  movían las dos caritas reactivas, que no usan `animation` sino un `transform`
  que lee la variable. Nadie lo vio porque el HUD sale pocos segundos; en la
  pantalla de Inicio, con la carita fija a la vista, saltó enseguida.
  Arreglado de raíz: la duración va **inline y literal** en cada fotograma
  (`style="animation-duration:.6s"`) y el CSS usa longhands (`animation-name`,
  `-duration`, `-timing-function`, `-iteration-count`) en vez del atajo, que
  reinicia la duración a 0. Medido después: **103 de 103 animaciones siguen
  avanzando** con `--lvl` escribiéndose a 60 fps.
  Se diagnostica en 10 s sin mirar nada a ojo:
  `el.getAnimations({subtree:true})[0].currentTime` dos veces seguidas — si no
  avanza o va hacia atrás, es esto.
- **Ni un backtick dentro de `FACE_CSS`, ni siquiera en un comentario CSS.**
  Es un template literal de JavaScript: un acento grave lo **cierra ahí mismo**,
  y lo que sigue se parsea como código. El error no menciona CSS ni backticks —
  sale un `TS2339: Property 'fundido' does not exist on type '"\n .tama {…'`,
  o sea TypeScript intentando leer una propiedad sobre la cadena que acaba de
  cerrar. Ya ha pasado **cuatro veces**, siempre por citar el nombre de una
  clase entre acentos graves. Si hay que nombrar una clase en un comentario de
  ahí dentro, se escribe a pelo. **Van cinco**, y la quinta (20/09/2026) fue en
  el comentario de un keyframe recién añadido: el fallo no se olvida, se repite.
- **Redibujar React también los reinicia**: la escena entra por
  `dangerouslySetInnerHTML`, así que cada render reescribe el interior del `<svg>`
  y se lleva por delante los `<g>` que llevan las animaciones. Un componente que
  pinte caritas debe redibujarse **sólo cuando la carita cambia**.
- **El Release se crea sobre un commit que GitHub ya tiene que conocer** (el fallo de
  la 0.8.2, 14/09). `gh release create` sin `--target` pone el tag en la rama por
  defecto: publicando desde una rama, el tag apuntaría a un `main` sin ese código y el
  Release mentiría sobre lo que contiene. Con `--target` hay dos trampas encadenadas,
  y las dos dan el mismo mensaje —`Release.target_commitish is invalid`— **después** de
  compilar y firmar:
  - El SHA tiene que ir **completo**. Abreviado (`c9f3a06`) también lo rechaza.
  - Y el commit tiene que estar **empujado**. Un `git push` que faltaba tira los 40
    minutos de build. Ya hay guarda al principio de `publicar.ps1`
    (`git branch -r --contains HEAD`), probada en las dos direcciones.

  Si vuelve a pasar: el instalador y el `.sig` ya están hechos y son válidos, así que
  se crea el release a mano con los artefactos de `target/release/bundle/nsis` en vez
  de repetir la compilación.
- **No canalizar la salida de `publicar.ps1`.** Un `*>&1 | Tee-Object` convierte cada línea
  que Tauri escribe en stderr (hasta un `Info` inocuo) en `NativeCommandError` y aborta el
  script. Es la misma trampa que `2>&1` sobre ejecutables nativos en PowerShell 5.1.
- En Bash, `cmd | tail` se traga el exit code: usar `set -o pipefail`.
- **El `target/` guarda rutas absolutas: mover la carpeta del proyecto lo rompe.**
  El proyecto vivió un tiempo en `C:\dev\Proyectos Personales\Mike` y hoy está de
  vuelta en `C:\dev\Mike`;
  los artefactos viejos seguían apuntando a la ruta vieja y el build moría con
  `failed to read plugin permissions: ... C:\dev\Mike\...` (os error 3), un
  mensaje que no menciona la mudanza por ningún lado. Se arregla con
  `cargo clean` del perfil afectado — y son dos: `cargo clean -p tauri` sólo
  limpia **debug**, para release hace falta `--release`. La cura completa fue
  `cargo clean --release` (3,6 GB, ~40 min de recompilación).
- **`aws-lc-sys` necesita NASM y este equipo no lo tiene.** Sale al reconstruir
  desde cero (antes vivía de un artefacto cacheado de hace meses):
  `NASM command not found`. En vez de instalar NASM se usa la salida oficial del
  crate, `AWS_LC_SYS_PREBUILT_NASM=1`, que ya está puesta en `publicar.ps1`.
  Ojo: sus `.o` los compila con el crate `cc`, que **no cachea entre intentos**,
  así que un build cortado a la mitad reempieza de cero.
- **Compilar en limpio dura más que el límite por comando de una sesión.** Un
  build completo de release son ~45 min y los comandos mueren a los 10. La
  salida es desprender el proceso: un `.cmd` lanzado con
  `Start-Process explorer.exe -ArgumentList "…\lanzar.cmd"`, que redirige a un
  log y deja un archivo centinela al terminar; luego se espera con un
  `until [ -f centinela ]` que sí se puede rearmar. Comprobado: así aguantó
  40 min de compilación mientras la sesión iba y venía. Redirigir el proceso
  entero a un archivo (`> log 2>&1` desde cmd) **no** es lo mismo que canalizar
  en PowerShell, así que no cae en la trampa del `NativeCommandError`.
- **`Start-Process explorer.exe -ArgumentList mike.exe` no basta para relanzar
  Dicho** (28/08): la app arranca, se ve viva unos segundos y muere en cuanto
  termina el comando. Lo que sí funciona es el mismo rodeo del `.cmd`: un
  archivo con `start "" "%LOCALAPPDATA%\Dicho\mike.exe"` lanzado por explorer.
  Se verifica en **dos llamadas separadas**: dentro de la misma sigue vivo
  aunque esté condenado.
- **El instalador con `/S` puede dejar el `mike.exe` viejo** (28/08). Salió con
  código 0, actualizó el registro y el `uninstall.exe` a 0.6.0… y no tocó el
  binario, que se quedó en 0.5.0 con su fecha vieja, con la app cerrada y sin
  nada bloqueándolo. Relanzarlo con `/P /R` (pasivo, el mismo modo que usa el
  updater) sí lo reemplazó. **No basta con el código de salida**: hay que
  comprobar `(Get-Item $exe).VersionInfo.FileVersion` después de instalar.
  Y ojo, la otra comprobación documentada —buscar una cadena nueva dentro del
  exe— **no sirve para cambios de frontend**: los assets van comprimidos dentro
  del binario, así que `Contains("<texto de la UI>")` da falso aunque el build
  sea el correcto. Para UI, la versión es el único discriminador fiable.
- **El instalador NSIS no vuelve a abrir la app si la encuentra abierta.** Trae un `/R`
  para relanzarla y el plugin del updater se lo pasa (`installMode: passive` →
  `["/P", "/R"]`), pero sólo surte efecto si Dicho ya está cerrado cuando arranca el
  instalador. Al actualizar desde dentro de la app lo encuentra vivo, entra por
  `CheckIfAppIsRunning` → `KillProcessCurrentUser`, y por ese camino el relanzamiento no
  llega. Comprobado en las dos direcciones, y la prueba sirve para validar cualquier
  arreglo futuro:
  - App **cerrada** antes de lanzar el instalador con `/P /R /UPDATE /ARGS` → **vuelve
    sola** (queda su arranque en `dicho.log`).
  - Instalador lanzado y app cerrada 300 ms después (= actualización real) → **no vuelve**.

  Por eso el relanzamiento lo programa la app antes de instalar
  (`commands::programar_relanzamiento`). Ojo al probarlo: **no se puede simular desde una
  sesión automatizada**. Lanzar el vigilante con `Start-Process` lo mete en el job object
  de la sesión y muere con el comando; lanzarlo por `Invoke-CimMethod Win32_Process Create`
  lo pone en la sesión 0, donde una app gráfica no arranca. Lo que sí se puede validar sin
  lanzar nada es el script en sí: `script_relanzador()` tiene test propio que lo vuelca a
  disco para pasarlo por `[Parser]::ParseFile`.
- **Relanzar Dicho desde una sesión automatizada**: `Start-Process mike.exe` a secas no
  vale — el proceso hereda el job object de la sesión y Windows lo mata en cuanto termina
  el comando. Parece un crash de la app y no lo es. Hay que re-parentarlo:
  `Start-Process explorer.exe -ArgumentList $exe`.
- **…y ni aun así, si hereda una tubería que va a morir** (15/09). Lanzada desde una
  sesión automatizada, Dicho hereda el `stdout`/`stderr` de ese comando; cuando el
  comando termina, la tubería se cierra y **el siguiente apunte de `env_logger`
  revienta contra un descriptor muerto**: `0xc0000409` en el visor de eventos, que
  es el abort de Rust. Parece que la versión recién publicada está rota —cuatro
  crashes seguidos, ninguno con línea en `dicho.log` porque muere antes— y no lo
  está. La prueba que lo separa: lanzarla **con la salida redirigida a un archivo**
  (`start "" /b mike.exe > salida.txt 2>&1` dentro de un `.cmd` que abra explorer).
  Si así vive, era la tubería. Al usuario no le pasa: al arrancar desde el menú o
  desde el Run key no hay tubería que cerrar.
- **Arrastre libre = umbral obligatorio.** La onda se agarra por cualquier
  punto y siempre, sin modo de edición. Lo que antes lo impedía está escrito en
  el código que se borró: «era fácil desplazarla sin querer al ir a pulsar su
  menú». La cura no es un modo, es un **umbral de seis píxeles**
  (`UMBRAL_ARRASTRE` en `overlay.rs`): por debajo de eso la ventana no se mueve,
  así que un clic sigue siendo un clic y llega limpio al toggle de niveles o a
  los botones del menú. Dos cosas cuelgan de ese umbral y conviene no romperlas:
  - `arrastrar_con_cursor` **devuelve `None` si nunca se cruzó**. Sin eso, cada
    clic en la cápsula reescribiría `hud_posiciones` y guardaría los ajustes
    enteros — un `settings-changed` por clic.
  - Al cruzarlo se reposiciona el origen (`c0 = c`); si no, la onda pega un
    salto de seis píxeles justo al empezar a moverse.
  Y el webview se entera por el evento **`hud-arrastre`** (true al cruzar, false
  al soltar), no por el `pointerdown`: es lo que enciende el aro punteado y la
  carita de la montaña rusa, y por eso no salen al hacer un clic normal.
- **En el navegador no se puede saber si estás en un campo de contraseña.**
  Windows sólo lo contesta cuando el control es **nativo**: un `EDIT` con estilo
  de contraseña devuelve el carácter de relleno a `EM_GETPASSWORDCHAR`. Chrome,
  Edge, Electron y cualquier app que se dibuje su propia interfaz son **una sola
  superficie de dibujo** para el sistema; el campo vive dentro y Win32 no lo ve.
  No hay API que lo arregle, así que cualquier cosa que mire el teclado tiene que
  asumirlo y decirlo — no esconderlo. Lo que sí protege en `autotype.rs`: la
  lista de apps vetadas, y que la tabla de correcciones sólo contenga palabras
  castellanas (una contraseña no lo es).
  Y al preguntarlo, **`SendMessageTimeout` y nunca `SendMessage`**: el mensaje va
  a la ventana de otro proceso, y a secas se queda esperando a que conteste — una
  app colgada colgaría con ella el hilo que pregunta.
- **Un `expect` dentro de un hilo de fondo se lleva funciones que no son suyas.**
  `Corrector::nuevo` abría el teclado de rdev con `expect`, y ese hilo es el del
  hook global: si fallaba, moría el hook y con él **el atajo de dictar**, la
  función principal de la app, por culpa de una de laboratorio que no pudo
  arrancar. Va en `Option` y degrada. Regla: en un hilo que sostiene algo más que
  su propia tarea, no hay `unwrap` ni `expect` que valga.
- **Nada de manos con dedos sueltos a 48×16** (20/09/2026). La mano que
  chasqueaba los dedos en el silbido era un puño con **un dedo levantado**, y a
  cinco píxeles eso no se lee como un chasquido: se lee como una peineta. Lo vio
  luisg a la primera. Y **no tiene arreglo por refinamiento**: a esta escala
  cualquier silueta con un dedo destacado está a un píxel del gesto obsceno,
  porque no hay sitio para dibujar la mano que lo desambigua. Una mano aquí sólo
  puede ser un bloque entero, como la que sostiene la servilleta.
- **Un objeto que se reconoce por ser recto no puede dibujarse en diagonal**
  (19/09/2026). El lápiz del dibujante iba en diagonal a cuatro píxeles y salía
  «un espagueti con la punta rosa». Es el mismo aprendizaje que ya estaba escrito
  para el brazo levantado y no se aplicó: **a esta escala una diagonal no es una
  línea inclinada, es una escalera**.
- **Dos gestos que significan lo mismo son un gesto de más.** La carita de
  dibujar se borró el mismo día que nació: ya hay una de pluma y pergamino para
  corregir y otra de manos tecleando para escribir, y una tercera de lápiz no
  añadía un gesto sino una duda. Una mascota puede tener muchos gestos, pero no
  dos que signifiquen lo mismo.
- **Dos cosas creciendo en el mismo rincón se leen como una sola mancha**
  (20/09/2026). La burbuja de moco del dormido salía por el mismo lado que los
  ZZZ. El dibujo estaba bien; el sitio no. Cuando dos elementos compiten por el
  mismo hueco, **el que se va es el que menos dice**.
- **Dos formas iguales no se reparten papeles.** Mascar chicle no se entendía
  siendo un bloque de 3×2 para la boca y otro de 3×3 para el carrillo, ni
  separados ni pegados. El problema no era la distancia: **era que los dos eran
  la misma forma**. Uno tiene que ser volumen y el otro trazo — una curva contra
  una raya de un píxel sí se leen.
- **Dos pasos idénticos seguidos son un paso desperdiciado, y se ven.** En el
  dormido, dos respiraciones seguidas podían salir iguales: siete segundos del
  mismo dibujo no se leen como respirar despacio, se leen como que se colgó. Toda
  historia larga necesita una comprobación de que ningún paso repite al anterior
  — se mide con las huellas de sus `<rect>`, no a ojo.
- **`const` no se iza: el orden dentro de `faces.ts` importa.** `V` nombra las
  caritas de reposo, así que tienen que estar **definidas antes**. Si viven mil
  líneas más abajo, el módulo revienta al cargar con un `ReferenceError` — y el
  compilador **no avisa**, lo dice el navegador con la ventana en blanco.
- **El HUD atrapa el ratón o lo deja pasar, pero no a medias.** Nació siendo un
  cristal (`set_ignore_cursor_events(true)` → `WS_EX_TRANSPARENT`) para no comerse
  los clics de lo que hubiera debajo, y eso es justo lo que impedía arrastrarlo.
  No hay forma de hacer transparente sólo una parte de la ventana, así que es un
  ajuste (`hud_arrastrable`, encendido por defecto) y no una decisión nuestra.
  Lo que **no** hace falta sacrificar es el foco: `set_focusable(false)` es
  `WS_EX_NOACTIVATE`, y una ventana así recibe los mensajes de ratón sin
  activarse. Comprobado en las dos direcciones (28/08), y con
  `WindowFromPoint`, que se salta las ventanas transparentes al ratón, se ve sin
  ni siquiera pinchar:
  - `hud_arrastrable` **encendido** → bajo el centro del HUD contesta el HUD, se
    arrastra, y `GetForegroundWindow()` no cambia.
  - **apagado** → contesta la ventana de abajo y arrastrarlo no lo mueve.
- **PowerShell 5.1 no es DPI-aware y Windows le miente con las coordenadas.** En
  el monitor del usuario (125 %) `GetWindowRect` del HUD devolvía (844,986) 360x96
  cuando la app lo había puesto en (1055,1233) 450x120: son las mismas cifras
  divididas entre 1,25. Los clics de prueba caían 200 px arriba y "no pasaba
  nada". La cura es una línea al principio del script:
  `SetProcessDpiAwarenessContext(-4)` (per-monitor v2) y ya se trabaja en píxeles
  de verdad, los mismos que loguea `dicho.log`. Y ojo con otra de PowerShell:
  `FindWindow($null, "titulo")` **no encuentra nada** porque marshala el `$null`
  como cadena vacía y busca una clase llamada ""; hay que enumerar con
  `EnumWindows`.
- **La prueba E2E del atajo no es muda: Dicho pega texto de verdad.** Mantener
  el atajo unos segundos graba la habitación, y un rms de 0,03 pasa de sobra la
  compuerta de silencio (0,0012): Whisper alucina sobre ese ruido —salieron
  "Thank you." y una frase en chino— y la app lo inyecta **en la ventana que
  tengas enfocada**. Antes de simular el atajo hay que mandar el foco a una
  ventana de usar y tirar (`System.Windows.Forms.Form` + el truco del ALT) y
  borrar después esas entradas del historial. Sólo es inofensivo si el rms sale
  por debajo del umbral, y eso no se puede dar por hecho.
- Test E2E sin tocar el mic: simular el atajo con `keybd_event` (P/Invoke) y verificar
  la cadena en `dicho.log` (rms 0 → evento empty → carita). El Notepad de Win11 no
  expone `MainWindowHandle`: para elegir en qué monitor cae el foco, crear un
  `System.Windows.Forms.Form` en la posición deseada y robarle el foco con el truco
  del ALT (`keybd_event(0x12)` antes de `SetForegroundWindow`, si no Windows lo ignora).

## Checkpoint — 21 de septiembre de 2026

### Estado

| | |
|---|---|
| Versión publicada | **v0.15.0**, con las cuatro comprobaciones en verde (se sirve desde `releases/latest/download/`, sin BOM, `signature` idéntica al `.sig` local, SHA256 del `.exe` publicado igual al firmado). Antes, el mismo día, la **0.14.0**, también verificada |
| Versión en uso | luisg tenía la **0.13.0** al empezar la sesión. La 0.15.0 le llega al abrir Ajustes — **falta confirmar que la instaló** |
| Repo | `main` al día y empujado, y **es la única rama que queda**: las cinco mezcladas se borraron el 21/09 con el visto bueno de luisg (dos de ellas también en GitHub) |
| Pruebas | `cargo test --lib` → **52 pasan, 0 fallan, 1 ignorada** (la ignorada vuelca el prompt del Editor a disco para probarlo a mano: `-- --ignored`) |
| Tipos y build | `npx tsc --noEmit` y `npm run build`, limpios |
| Árbol de trabajo | limpio |
| Pendiente crítico | respaldar `dicho.key` — **sólo puede hacerlo luisg**, y sigue sin hacerse desde el 27/08 |

### Qué pasó en la última sesión

Sesión larga y de una sola cosa: **el reposo**. Se rehízo entero, dos veces, y
acabó siendo un motor nuevo.

**1 · De gestos de cinco segundos a historias de un minuto.** Las caritas de
reposo eran bucles cortos y luisg las quería largas y que no se notara el bucle.
El primer intento —cuatro caritas de ocho tiempos— no valía, y la razón está en
el motor: `flip()` reparte el tiempo en partes iguales y tiene tope de doce
cuadros, así que no puedes mascar cuatro veces de un lado y dos del otro. De ahí
salió **`secuencia()`**: duraciones libres por cuadro, sin tope, con los
fotogramas generados al vuelo dentro de la propia escena.

Lo que hizo que funcionara fue **la investigación de los tamagotchi de verdad**,
que luisg pidió expresamente: su idioma no es una película larga, es **un bucle
corto de dos cuadros repetido un número variable de veces**, interrumpido por
sucesos que escalan. Los originales alternan dos cuadros "tres o cuatro veces" y
nunca las mismas. De ahí las tres reglas que rigen las cuatro historias: el bucle
base dura distinto cada vez, los sucesos escalan, y el final no siempre es el
mismo.

**2 · Las cinco caritas de stand-by, cerradas.** Masca chicle, silba, duerme, te
sigue con la mirada, y respira (la quinta es la de siempre, de relleno).

- **El chicle** costó tres versiones. La primera tenía la boca y el carrillo como
  dos bloques iguales y no se entendía; la segunda ya era medio círculo y raya
  pero la bomba pasaba por pantalla en medio segundo. La tercera es la buena:
  escalera de cinco tamaños que **se ve crecer**, aguanta arriba 1,3-1,9 s, y
  revienta limpio casi siempre — **una de cada siete le explota en la cara**.
- **El silbido** perdió la mano que chasqueaba los dedos (ver gotchas: a cinco
  píxeles era una peineta) y ganó los ojos cerrados y el meneo de cabeza.
- **El dormido** perdió la burbuja de moco, que competía con los ZZZ por el mismo
  rincón, y ahora respira con la boca.
- **Los ojos que te siguen** fue la única que necesitó Rust.
- **El dibujante se borró el mismo día que nació**: se pisaba con el escribano.

**3 · Dos versiones publicadas**, la 0.14.0 y la 0.15.0, las dos verificadas con
las cuatro comprobaciones.

### Lo que funciona y está probado

Todo lo de las historias está medido sobre **400 tiradas de cada una**, no a ojo:

| | Duración | El suceso raro | Tiradas distintas |
|---|---|---|---|
| Chicle | 55-70 s | le explota 1 de cada 6,9 bombas | 400/400 |
| Silbando | 55-62 s | la nota larga 1 de cada 6,2 frases | 400/400 |
| Dormido | 55-69 s | se despierta 1 de cada 6,7 sucesos | 400/400 |

Y en las tres: **cero pasos repetidos seguidos** y **cero píxeles fuera del
lienzo**. Comprobado además en el navegador que **avanzan de verdad** y que en
cada instante hay **exactamente un paso visible** — el chicle va por el paso 13 a
los 10 s, por el 55 a los 40 s y por el 74 a los 54 s.

- **Los ojos que siguen al cursor** se probaron en el manual, que alimenta las
  mismas dos variables de CSS desde el ratón de la página. En la app la posición
  viene de Rust; el mecanismo que lee la carita es idéntico.
- **Las dos versiones publicadas**, cada una con las cuatro comprobaciones de
  firma, BOM y SHA256 contra lo que descarga la app.
- **52 tests de Rust**, tsc y build limpios.

**No verificado todavía**, y se dice porque no se pudo probar:

- **Ninguna de las caritas nuevas se ha visto dentro de la app.** Se han visto en
  el manual, que usa el mismo `faces.ts`, pero el HUD es otra ventana: falta que
  luisg instale la 0.15.0 y deje la onda clavada un minuto.
- **El seguimiento del cursor nunca se ha ejecutado con Rust de por medio.** El
  comando compila y el cableado está, pero `hud_cursor` no se ha llamado una sola
  vez en vivo.
- **La corrección al vuelo** (LABS) sigue sin probarse desde el 17/09.

### Siguiente paso inmediato

**Que Dicho domine los registros del habla.** Lo pidió luisg y es lo primero de
su lista: que entienda y sepa producir español profesional, organizado, informal
y slang —mexicano— y que combine lo que haga falta según el input, **sin
interruptor**. Es trabajo de prompt, y aquí eso **no se hace a ojo**: se hace con
`herramientas/banco-de-prompts.py` contra sus ~750 dictados reales, que ya son un
corpus de cómo habla él. El precedente manda: el modo Editor "parecía cambiar
poco" y resultó que devolvía el dictado **idéntico** en dos de tres casos.

Justo detrás va **personalizar el Editor con su propio historial**, que es la
otra mitad del mismo problema y usa el mismo banco.

### Lo que viene, por orden de valor

1. **Los registros del habla** (ver el siguiente paso inmediato).
2. **Personalizar el Editor con el historial del propio usuario.** No hace falta
   Google: los ~750 dictados están en `mike.db`, en este disco. La forma barata es
   meter tres o cuatro de sus textos ya redactados en el prompt como referencia
   de voz.
3. **Purga del historial.** `mike.db` crece sin tope y cada fila pesa más desde la
   0.11. Necesita que luisg decida la política.
4. **BYOK: una casilla genérica "compatible con OpenAI"** (URL base + key +
   modelo). Hoy Groq es la única opción y su plan gratis puede cambiar.
5. **Sincronización con Google de punta a punta.** El código está entero y con
   tests; bloqueado por el cliente OAuth que sólo puede crear luisg.
6. **Vocabulario propio en el prompt del STT.** El diccionario llega al pulido
   pero **no** al `prompt` de Whisper, así que hoy sólo corrige la palabra
   *después* de oírla mal. Cuidado: ese mismo prompt es lo que frena la
   traducción, así que hay que medir antes y después.
7. **La quinta carita de reposo.** Hoy el hueco lo tapa la de siempre —respira y
   parpadea— porque el dibujante se borró. Falta una idea que no se pise con
   ninguna de las otras cuatro ni con el escribano.

### Pendientes que sólo puede hacer el usuario

- **Respaldar la clave privada del updater** (`%USERPROFILE%\.tauri\dicho.key`).
  El único pendiente crítico y sólo existe una copia, en este disco. Sin ella, ni
  luisg ni ninguno de sus testers vuelve a recibir una actualización jamás:
  habría que reinstalar a mano en cada equipo. **Copiarla, no moverla** —
  `publicar.ps1` la lee de esa ruta exacta. Acordado el 27/08 y **sigue sin
  hacerse**.
- **Instalar la 0.15.0 y mirar la onda un minuto**, clavada y sin dictar. Es la
  única forma de ver las cuatro historias de stand-by dentro de la app, y de
  comprobar que el seguimiento del cursor funciona de verdad. Si la onda va a
  tirones, decirlo: la palanca directa es bajar las historias de 60 a 45 s.
- **Probar la corrección al vuelo.** Inicio → LABS → encender «Corregir mientras
  escribo», escribir en un bloc de notas `tambien informacion aqui rapido ` (con
  espacio tras cada palabra) y ver si salen con tilde. Y comprobar que **en una
  terminal no hace nada**, que viene vetada de fábrica.
- **Decidir la política de purga del historial.**
- **Crear el cliente OAuth de Google** (~5 min, gratis). Es lo único que bloquea
  la sincronización entre equipos.
- **Avisar si cambia de plan en Groq**: con el gratuito hay 20 peticiones/minuto.

### Comprobar en dos minutos

```sh
cd src-tauri && cargo test --lib   # 52 pasan, 1 ignorada
npx tsc --noEmit                   # sin salida
npm run build                      # limpio
git status --short                 # vacío
git rev-list --count origin/main..HEAD   # 0
```

```powershell
# Que lo publicado sea lo instalado: la diferencia entre "salió" y "le llegó".
$exe = "$env:LOCALAPPDATA\Dicho\mike.exe"; (Get-Item $exe).VersionInfo.FileVersion
gh release view --repo luisgs096/dicho --json tagName --jq .tagName
@(Get-Process mike -ErrorAction SilentlyContinue).Count

# Salud del ultimo uso. `Pulido [...]` dice que modo corrio y cuanto cambio el texto:
# un IDENTICO en un dictado largo con el Editor puesto es la senal de alarma.
Get-Content "$env:APPDATA\dev.mike.app\dicho.log" -Tail 20
Select-String -Path "$env:APPDATA\dev.mike.app\dicho.log" -Pattern "DESBORDE|panic|DESCARTADO|NO se pudo" | Select-Object -Last 5
```

Y una que es de esta tanda: que las historias largas **no se queden congeladas**.
Con la onda clavada y sin dictar, en la consola del HUD:

```js
document.querySelector(".seq").getAnimations({subtree:true})[0].currentTime
```

Dos veces seguidas: si no avanza, alguien volvió a meter la duración en una
variable CSS.

**Ojo al probar**: luisg puede estar dictando. Cualquier script que robe el foco
lo interrumpe, y simular el atajo hace que Dicho **pegue texto de verdad** en la
ventana enfocada. Mirar antes la hora de la última línea de `dicho.log`.

## Publicar y actualizar

El ciclo completo está probado en vivo, no sólo en frío. Medido en la 0.4.0 → 0.5.0:
comprobar, descargar, instalar y volver a abrirse tardó **7 segundos** sin intervención.
La secuencia queda en `dicho.log` y sirve de patrón para diagnosticar si algún día falla:

```
22:42:42  Updater: relanzamiento programado   ← la app deja el vigilante antes de instalar
22:42:47  arranca el proceso nuevo            ← los 3 s de espera + el primer reintento
22:42:49  HUD-JS: montado                     ← version nueva viva
```

**Qué verificar al publicar** (no basta con que el release exista; un `.sig` que no
corresponda rompe la actualización en silencio y no avisa nadie):

1. `latest.json` se descarga desde la URL exacta que consulta la app
   (`releases/latest/download/latest.json`).
2. Va **sin BOM** y parsea.
3. Su campo `signature` es idéntico al `.sig` local.
4. El `.exe` publicado coincide en **SHA256** con el que se firmó.

**Cada release lleva el instalador dos veces**, y no es un descuido: `gh release create`
sube `Dicho_X.Y.Z_x64-setup.exe` y una copia idéntica llamada `Dicho-setup.exe`. GitHub
sólo sirve un enlace permanente (`releases/latest/download/<archivo>`) si el nombre no
cambia nunca, y el del instalador lleva la versión dentro, así que sin la copia el botón
de descarga del README caducaría en cada versión. **El updater no la usa**: `latest.json`
sigue apuntando a la URL con el número de versión, para que una descarga a medias no se
mezcle con la release siguiente. La copia es sólo para humanos.

**Dos limitaciones conocidas**, ninguna urgente:

- El vigilante espera 3 s tras el cierre pero **no espera a que el instalador termine**.
  Bastó siempre hasta ahora, pero con un disco lento o un antivirus escaneando podría
  arrancar la app a media instalación y el instalador la mataría. Si vuelve a quedarse
  cerrada tras actualizar, el arreglo es esperar a que desaparezca el proceso del
  instalador antes del primer intento.
- **La comprobación sólo ocurre al *abrir* la ventana de Ajustes.** Con la ventana ya
  abierta no vuelve a mirar nunca. El botón de buscar siempre funciona. La mejora, si se
  quiere, es volver a comprobar cuando la ventana recupera el foco.

**Auditoría de secretos** (hecha el 27/08 antes del primer reparto a terceros; conviene
repetirla cada vez que se publique). Todo limpio:

- La API key de Groq vive en el **Administrador de credenciales de Windows** (`keyring`,
  servicio `mike-dictado`), nunca en el repo ni dentro del binario.
- Cero coincidencias de `gsk_…`, `sk-…`, `GOCSPX-…` ni `…apps.googleusercontent.com` en el
  binario sin comprimir, en el instalador publicado **y en todo el historial de git**
  (`git log --all -p`, no sólo el estado actual).
- De Google sólo viajan URLs públicas de endpoint. El cliente OAuth lo crea cada usuario y
  queda en su `settings.json` local.
- `.gitignore` bloquea `*.key` y `*.key.pub`; no hay ningún `.db`, `.log` ni
  `settings.json` rastreado, así que no se publica ni un dictado.
- Quien instale la app arranca con motor **local** y pulido por reglas: no puede gastar
  dinero de nadie sin poner su propia key.

## Historial de sesiones

**20-21/09** — El reposo, entero y dos veces. Las caritas de stand-by pasaron de
ser gestos de cinco segundos a **historias de un minuto que no se repiten**, y
eso obligó a un motor nuevo: `flip()` reparte el tiempo en partes iguales y tope
doce cuadros, así que no se puede mascar cuatro veces de un lado y dos del otro.
`secuencia()` tiene duraciones libres y sus fotogramas viajan dentro de la propia
escena, porque cada tirada se sortea al vuelo. La clave no fue dibujar más: la dio
**la investigación de los tamagotchi originales**, que alternan dos cuadros "tres
o cuatro veces" y nunca las mismas — lo que rompe la repetición es que el mismo
dibujo dure distinto. Cuatro historias medidas sobre 400 tiradas cada una, todas
distintas, con su suceso raro a razón de uno de cada siete. Se publicaron la
**0.14.0** y la **0.15.0**. Y tres borrados que valen tanto como lo añadido: la
mano que chasqueaba los dedos (a cinco píxeles era una peineta), la carita del
dibujante (se pisaba con el escribano) y la burbuja del dormido (competía con los
ZZZ por el mismo rincón). 52 tests.

**17/09** — La 0.12.0 publicada y, sobre todo, dos bugs que sólo aparecieron usando la
app. **El diccionario se ignoraba**: viajaba dentro del prompt como sugerencia y el
modelo se la saltaba — 13 de 400 dictados reales conservaban un término que tenía que
haber cambiado, incluidos los dos en los que luisg estaba reportando justamente eso.
Ahora se aplica después de pulir y en todos los modos: 13 → 0. Y **corregir texto
seleccionado le cerraba las conversaciones de Claude Code**, porque para leer la
selección se sintetizaba un Ctrl+C, que en una terminal no es copiar sino interrumpir;
de ahí la regla que queda: nunca sintetizar un atajo que el usuario no pulsó. Antes de
eso: el **modo Estándar había dejado de corregir** (devolvía el dictado idéntico, misma
causa de marco que ya tuvo el Editor), la onda pasó a **arrastrarse sin permiso** con un
umbral de seis píxeles y menú de dos botones, y se dibujó la **montaña rusa** con su
servilleta — cuatro rondas de banco, y el hallazgo caro fue que la boca tenía que ir
hueca por dentro. También se construyó la **corrección al vuelo** al escribir, apagada y
sin probar en vivo. 47 tests.

**16/09** — Seis versiones en un día, 0.11.0 → 0.11.5, y un susto. El historial pasó a
contar qué pasó con cada dictado (modo, tiempos, muletillas, anglicismos, con resaltado
al hover) y de paso se descubrió que **los chips de corrección mentían la mitad de las
veces**: se calculaban antes de pulir, así que eran una predicción — 10 de 21 reemplazos
anunciados no estaban en el texto. Las secciones de la ventana se pliegan, LABS quedó en
un solo interruptor, y la animación de estreno se rehízo entera dentro de la cápsula
(la vieja se saboteaba sola: al volverse cuadrada disparaba un resize que recreaba la
animación). La 0.11.2 dejó la app **sin abrir**: `state()` de Tauri aborta el proceso si
el estado no está registrado, y la ventana de Ajustes le ganaba la carrera al arranque —
sin una línea en el log porque moría antes de escribirla. Cerrado de raíz registrando el
estado en el Builder. El primer arreglo estuvo a medias y lo cazaron tres revisores en
paralelo, cada uno por su lado, junto con once bugs más con escenario reproducible.
También: la tecla de cancelar dejó de estar fija en Escape (con Ctrl derecho formaba
`Ctrl+Esc`, que es el menú Inicio de Windows) y el teclado gráfico se rehízo con un solo
layout, dos idiomas y las dos teclas visibles a la vez. 31 tests. `main` al día.

**28/08** — El HUD se mueve con el ratón: v0.7.0 por la mañana y v0.8.0 por la tarde, con
las dos cosas que sólo se ven usándolo de verdad —la posición era una sola para todos los
monitores, y en los saltos de DPI salían barras de scroll dentro del HUD—. Se agarra por
cualquier punto, cada pantalla recuerda su rincón, y Ajustes trae "Mover la onda flotante"
para colocarlo sin tener que dictar. 19 tests. De paso salieron cuatro gotchas de banco de
pruebas: el DPI virtualizado de PowerShell, el `FindWindow($null, …)` que nunca encuentra
nada, que simular el atajo hace que Dicho pegue alucinaciones de Whisper en la ventana
enfocada, y las notas de `gh release create`, que hay que pasar por archivo. Y se estrenó
la skill `cierre`.

**27/08 (tarde)** — Estrenada la actualización automática: 0.3.0, 0.4.0 y 0.5.0 publicadas
y verificadas, y el ciclo completo funcionando solo en 7 s. La 0.3.0 destapó que el instalador NSIS mata la app
y no la vuelve a abrir; reproducido en las dos direcciones y arreglado en la 0.4.0 con un
vigilante que la app deja programado antes de instalar. También se arregló la versión del
panel lateral, que estaba escrita a mano y discrepaba de la real. 13 tests.

**27/08** — Auto-actualización firmada y UX de Groq (commit 2b85a0b). Chequeo de cierre:
tests 12/12, build limpio, log sin un error en 253 dictados, HUD y caritas bien en las dos
pantallas, y "cámara" confirmada como resuelta en el historial. Se descubrió que
`publicar.ps1` **nunca había llegado a publicar** — no existía ninguna release y la copia
instalada seguía siendo la 0.1.0 sin updater. Costó tres intentos porque eran tres fallos
encadenados (canalizar la salida, la variable de entorno vacía, y `npm.cmd` lanzado
directo); todos documentados arriba. **v0.2.0 publicada y verificada** (firma y SHA256
comprobados contra lo que descarga la app). Falta instalarla a mano una vez.

**26/08** — HUD siempre encima (monitor activo + topmost + arreglo del lienzo de WebView2
en DPI mixto); 25 caritas rehechas sobre rejilla fija (lentes oscuros con destello, manos
tecleando, bucles ≤1,4 s, movimiento a pasos, dos reactivas al volumen); catálogo "Ver
animaciones"; interruptor "No traducir nunca" tras medir que el culpable era Whisper y no
el pulido; dictados largos con troceo en caliente, tope de 10 min y cinta de capacidad;
pulido por bloques que ya no trunca.

**23/08** — Fix autostart (apuntaba al build debug), sidebar + correcciones de diccionario
en historial, HUD de barras a caritas tamagotchi (mockups aprobados por rondas), Google
sync implementado, RAM 723→32 MB (carga perezosa del modelo), compuerta de silencio +
anti-alucinaciones, editor visual de atajo (el usuario lo cambió a `ControlRight`), toggle
de estilo del HUD. Mockups de aquella ronda:
https://claude.ai/code/artifact/4297faa5-c8dd-4d00-9205-3332a46e92e2
