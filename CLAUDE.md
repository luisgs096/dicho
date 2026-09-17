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
  boca con el antebrazo** antes de fundir a una carita normal.

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
  - **Un brazo levantado es una vertical gruesa, no una diagonal.** Se
    descartaron tres: en diagonal larga salían dos corchetes, corta salían dos
    piedrecitas, y la manita suelta sin brazo salían dos orejas. La diagonal a
    esta escala no es una línea inclinada, es una escalera.
  - **Un objeto suelto a la altura de la boca se lee como otra boca.** Le pasó
    al antebrazo con el que se limpia: como sprite suelto parecía primero una
    linterna y luego una segunda boca. Lo que lo arregló fue **anclarlo al borde
    del lienzo** (`brazoLimpia()` rellena hasta x=48) — así es algo que *entra*,
    y entonces el puño de delante dice en qué dirección.

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
  ahí dentro, se escribe a pelo.
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

## Checkpoint — 16 de septiembre de 2026

### Estado

| | |
|---|---|
| Versión publicada | **v0.11.5**, firmada y verificada (las cuatro: `latest.json` se sirve desde `releases/latest/download/`, sin BOM, `signature` idéntica al `.sig` local, y SHA256 del `.exe` publicado == el firmado) |
| Versión en uso | **0.11.5** instalada y **corriendo** en el equipo de luisg. Coincide con la publicada: le llegó |
| Repo | `main` en `071c38a`, sincronizado con GitHub, **0 commits sin mezclar**. La rama `luis/atajo-cancelar` se mezcló y se borró; queda `luis/regla-de-merge`, ya contenida en `main` y pendiente de borrar |
| Pruebas | `cargo test --lib` → **31 pasan, 0 fallan, 1 ignorada** (la ignorada es `volcado::prompt_del_editor`, una herramienta que vuelca el prompt a disco para probarlo a mano; se corre con `-- --ignored`) |
| Tipos | `npx tsc --noEmit` → sin errores |
| Build | `npm run build` → limpio |
| Árbol de trabajo | limpio |
| Pendiente crítico | respaldar `dicho.key` — **sólo puede hacerlo luisg**, y sigue sin hacerse desde el 27/08 |

Dicho está **en uso diario**: el log registra dictados hasta las 20:21 del 16/09 y no
tiene ni un `DESBORDE`, `panic` ni `DESCARTADO`. Hoy se publicaron **seis versiones**
(0.11.0 → 0.11.5) y una de ellas, la 0.11.2, dejó la app sin abrir durante un rato —
está arreglado y verificado en la máquina de luisg, que es donde importa.

### Qué pasó en la última sesión

Sesión larga y con un susto en medio. Tres bloques:

**1 · El historial, Inicio y la animación de estreno (0.11.0).** Cada tarjeta del
historial cuenta ahora qué pasó con ese dictado —modo, tiempos desglosados, muletillas,
anglicismos— con resaltado en el texto al pasar el ratón, y un interruptor CRUDO/FINAL.
Las doce secciones de la ventana se pliegan y la app recuerda cómo las dejaste. LABS se
fue al final de Inicio y se puso verde. La animación de actualizar se rehizo entera:
1,8 s dentro de la cápsula, en vez de una película de 6 s en ventana cuadrada.

Dos hallazgos de fondo, los dos medidos y no supuestos:

- **Los chips de correcciones mentían la mitad de las veces.** Se calculaban sobre el
  texto crudo *antes* de pulir, así que eran una predicción de lo que el diccionario
  haría, no un registro de lo que pasó. Medido sobre `mike.db`: **10 de 21** reemplazos
  anunciados no estaban en el texto final. El caso claro es el dictado `id=654` — el
  historial decía "Cloud → Claude ×2" y el texto que recibió el usuario decía "Cloud
  Code". Causa: la sustitución literal sólo ocurre en modo Reglas; con Estándar o Editor
  el diccionario viaja como simple sugerencia dentro del prompt y el modelo puede
  ignorarla. Ahora se miden **después** de redactar y las ignoradas salen marcadas.
- **La animación vieja se saboteaba a sí misma.** Al volverse cuadrada disparaba un
  `resize`, el `resize` reescribía la variable CSS `--k`, y escribir una custom property
  en un ancestro **recrea la animación desde cero**. Era el gotcha ya documentado,
  disparado por el propio efecto. Matar el modo cine no fue estética: fue la causa.

**2 · El crash de arranque (0.11.2 → 0.11.3), que es lo que costó.** Tras actualizar, la
app se cerraba sola y no volvía a abrir. Ni haciendo doble clic. Y **sin una sola línea
en `dicho.log`**, porque moría antes de escribirla.

El diagnóstico salió del backtrace de un binario **con símbolos** (el instalado no los
lleva; el de `target/release` sí, por su `.pdb` al lado):

```
mike_lib::sync::status
panicked: state() called before manage() for Arc<Store>
```

La ventana de Ajustes **nace visible**, así que su webview empieza a cargar en paralelo
al arranque y llama a comandos nada más montarse. `state()` no devuelve un error cuando
el estado aún no se registró: **aborta el proceso**.

Aquí me equivoqué dos veces y conviene que quede escrito:

- Primero di el fallo por atado a la actualización, basándome en una prueba que salió
  bien **por casualidad**. No lo era: es una carrera que a veces gana y a veces pierde,
  y por eso unas veces abría.
- Después arreglé `sync::status` con `try_state` y lo di por resuelto. Pero **la primera
  línea de esa función llama a `credentials()`**, que seguía pidiendo los ajustes con
  `state()`. Nunca se llegaba a mi arreglo.

Lo segundo lo encontraron los tres revisores de una revisión a tres lentes, **cada uno
por su lado**. Cerrado de raíz: la base y los ajustes se construyen y se registran
**antes de que exista la primera ventana** (ver `run()` en `lib.rs`), así que ya no hay
hueco donde perder la carrera.

**3 · La tecla de cancelar y el teclado (0.11.1 → 0.11.5).** El Escape para cancelar
estaba fijo, y como se pulsa *con el atajo apretado*, dictando con Control derecho la
combinación acababa siendo **`Ctrl+Esc`, que Windows se queda para el menú Inicio**.
Ninguna app puede ganarle esa tecla al sistema sin interceptar el teclado entero. Ahora
se elige, y Dicho avisa si tu combinación choca con una del sistema. El teclado gráfico
se rehízo: un solo layout (portátil), dos idiomas con botón ESP/ENG, y las dos teclas
visibles a la vez —azul dicta, naranja cancela—.

De paso salieron once arreglos más de la revisión, todos con escenario reproducible:
Ajustes pisaba lo que cambiaras desde la onda; la onda clavada se volvía intocable al
guardar cualquier ajuste; la tecla de cancelar admitía una del propio atajo (y entonces
cada dictado se cancelaba solo); el contador de muletillas no veía las acentuadas; y la
ficha de LABS prometía que el Editor no añade palabras, cuando sí lo hace.

### Lo que funciona y está probado

- **El arranque, que es lo que estaba roto.** Reproducido el fallo a voluntad poniendo
  `ultima_version_vista` a una versión anterior, y comprobado el arreglo **4 de 4 veces
  sin un solo panic**. Y lo que más vale: en la máquina de luisg la 0.11.5 está
  instalada, corriendo, y con dictados en el log a las 20:21.
- **El modo Editor redacta de verdad.** Medido contra tres dictados reales del
  historial: el encargo viejo devolvía el texto **idéntico** al crudo en dos de tres
  (1,00x, con sus muletillas y sus puntos suspensivos); el nuevo lo deja en 0,49x-0,68x,
  sin una sola muletilla y sin un solo "...". Usa `openai/gpt-oss-120b`; cuesta ~2 s más
  y sólo en ese modo.
- **Las guardas del pulido**, con 4 tests propios. El umbral de `inventa_demasiado` se
  recalibró del 50 % al **25 %** midiendo: un texto bien redactado usa sinónimos, y tres
  casos reales dieron 44 %, 61 % y 73 % de palabras propias — al 50 % el primero se
  descartaba. Cuando el modelo contesta en vez de escribir, el solape real es 0-10 %.
- **El teclado gráfico**, medido en banco de pruebas: la ↑ queda **a 0,0 px** de estar
  centrada sobre la ↓, y las seis filas empiezan y acaban en la misma columna.
- **El historial con datos reales**: los cuatro indicadores verificados contra dictados
  de `mike.db`, incluido el `id=654` que debe salir marcado como ignorado.
- **Las seis versiones publicadas**, cada una con las cuatro comprobaciones de firma,
  BOM y SHA256 contra lo que descarga la app.

**No verificado todavía** (se dice porque no se pudo probar, no porque se dé por bueno):

- La **animación de estreno de la 0.11.0** no se ha visto nunca en vivo. Se revisó
  congelándola en ocho instantes del reloj en los dos temas, y el último píxel del
  revelado termina en 1,746 s (dentro del 1,8 s), pero verla de verdad exige actualizar
  desde una versión anterior y eso ya no se puede repetir sin retroceder la marca.
- El **selector CRUDO/FINAL y el panel de la "i"** sólo se probaron en el banco con
  datos reales volcados, no dentro de la app.
- **Un dictado de 5 palabras salió `IDENTICO` en modo Editor** (log de las 20:21). Es
  esperable —no hay nada que redactar en cinco palabras— pero conviene mirar si se
  repite con dictados largos: sería la señal de que el problema volvió.

### Siguiente paso inmediato

**Purgar el historial: `mike.db` crece sin tope.** Van ~680 dictados y no hay borrado
por antigüedad ni límite de tamaño. Se empieza por `src-tauri/src/store.rs`, al lado de
`add_history`, y hace falta decidir la política con luisg (¿por antigüedad, por número
de filas, o nada y sólo un botón de "vaciar"?). Es lo más sustancioso que se puede hacer
**sin depender de él**, y ahora pesa más que antes: cada fila guarda además el modo y
los dos tiempos.

### Lo que viene, por orden de valor

1. **Personalizar el Editor con el historial del propio usuario.** Luis lo pidió
   explícitamente: que Dicho "se vaya personalizando y aprendiendo de la forma en la que
   normalmente el usuario le habla". **No hace falta Google**: los ~680 dictados ya están
   en `mike.db`, en este disco. La forma barata es meter tres o cuatro de sus textos ya
   redactados en el prompt como referencia de voz —es lo que hace AudioPen con su "train
   AudioPen to write more like you"—. Google resuelve el **traslado** entre equipos, que
   es otro problema y puede esperar.
2. **BYOK: una casilla genérica "compatible con OpenAI"** (URL base + key + nombre del
   modelo). Investigado y aprobado en principio, sin construir. Hoy Groq es la única
   opción y su plan gratis puede cambiar.
3. **Purga del historial** (ver el siguiente paso inmediato).
4. **Sincronización con Google de punta a punta.** El código está entero desde el 23/08
   y nunca se ha ejecutado de verdad; bloqueado por el cliente OAuth que sólo puede crear
   luisg. Ojo: `merge_history` ya va en una transacción desde la 0.11.4, pero **no
   sincroniza los tres campos nuevos** (`polish_mode`, `stt_ms`, `polish_ms`): habría que
   añadirlos a `SyncHist` con `#[serde(default)]` antes de usarlo en serio.
5. **Vocabulario propio en el prompt del STT.** El diccionario personal llega al pulido
   pero **no** al `prompt` de Whisper, así que hoy sólo corrige la palabra *después* de
   oírla mal. Cuidado: ese mismo prompt es lo que frena la traducción, así que meterle
   una lista puede debilitarlo — hay que medir antes y después.
6. **Atajo con teclas no-modificadoras** (hoy se exige al menos un modificador), con
   doble confirmación para no dejar la app inservible por accidente.
7. **Parakeet local con dictados largos**: el troceo secuencial está escrito pero nunca
   se probó con audio real largo en local.

### Pendientes que sólo puede hacer el usuario

- **Respaldar la clave privada del updater** (`%USERPROFILE%\.tauri\dicho.key`). El único
  pendiente crítico, y sólo existe una copia, en este disco. Sin ella, ni luisg ni
  ninguno de sus testers vuelve a recibir una actualización jamás: habría que reinstalar
  a mano en cada equipo. **Copiarla, no moverla** — `publicar.ps1` la lee de esa ruta
  exacta. Acordado el 27/08: arrastrarla a Google Drive como
  `DICHO - llave de actualizaciones - NO BORRAR NUNCA.key`. **Sigue sin hacerse.**
- **Confirmar que la app abre y se queda abierta** después de un arranque en frío con el
  antivirus activo. La carrera se reprodujo y se cerró aquí 4 de 4, pero su máquina al
  encenderse es otro escenario. Si volviera a cerrarse, la señal es que `dicho.log`
  quede **vacío**: eso dice que murió antes de escribir y es la misma clase de fallo.
- **Ver la animación de estreno** en la próxima actualización real, y decir si se
  entiende. Es el único sitio donde se ve.
- **Decidir la política de purga del historial** (antigüedad, número de filas, o sólo un
  botón manual).
- **Borrar o conservar la rama `luis/regla-de-merge`**, ya contenida en `main`.
- **Crear el cliente OAuth de Google** (~5 min y gratis). Es lo único que bloquea la
  sincronización entre equipos.
- **Avisar si cambia de plan en Groq**: con el gratuito hay 20 peticiones/minuto y por
  eso los trozos son de 20-55 s.

### Comprobar en dos minutos

```sh
cd src-tauri && cargo test --lib   # 31 pasan, 1 ignorada (la del volcado del prompt)
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

# Salud del último uso. `Pulido [...]` dice qué modo corrió y cuánto cambió el texto:
# un `IDENTICO` en un dictado largo con el Editor puesto es la señal de alarma.
Get-Content "$env:APPDATA\dev.mike.app\dicho.log" -Tail 20
Select-String -Path "$env:APPDATA\dev.mike.app\dicho.log" -Pattern "DESBORDE|panic|DESCARTADO|NO se pudo" | Select-Object -Last 5
```

**Ojo al probar**: luisg puede estar dictando. Cualquier script que robe el foco lo
interrumpe, y simular el atajo hace que Dicho **pegue texto de verdad** en la ventana
enfocada. Mirar antes la hora de la última línea de `dicho.log`.

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
