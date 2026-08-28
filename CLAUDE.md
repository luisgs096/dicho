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
  `modo_colocar()` es el botón "Mover la onda flotante" de Ajustes: deja el HUD
  a la vista y agarrable hasta que el usuario diga que ya, porque si no sólo se
  podría mover durante los segundos que dura un dictado.
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
- `src-tauri/src/hotkey.rs` — hook global rdev; lee `settings.hotkey` en cada evento →
  cambios de atajo aplican en vivo sin reiniciar.
- `src-tauri/src/sync.rs` — OAuth Desktop de Google (PKCE + loopback, tokens en el
  Administrador de credenciales, servicio keyring `mike-dictado`) y sync de
  diccionario+historial como JSON en el appDataFolder de Drive, con fusión sin
  duplicados. Requiere client_id/secret que el usuario crea una vez (form guiado en
  Perfil). **Aún sin probar de punta a punta: falta que el usuario cree su cliente OAuth.**
- `src-tauri/src/store.rs` — SQLite (`mike.db`): history (con columna `corrections`
  JSON), dictionary, meta (email de Google, last_sync).
- `src/windows/Settings.tsx` — ventana principal con sidebar: Perfil (cuenta Google +
  editor visual de atajo con teclado laptop/extendido), Diccionario, Historial (chips de
  correcciones + filtro), Ajustes (motores, "no traducir", modelo local, Groq, estilo
  del HUD + botones "Ver animaciones" / "Mover la onda flotante" / "Devolverla a su
  sitio" + interruptor de arrastrable, autostart, actualizaciones) anclado abajo.
  Ojo: `update()` en este archivo es el que guarda **ajustes**, no el de versiones;
  el de versiones se destructura como `actualizacion`/`buscarActualizacion`.
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
  Exporta `CARITA_COMILONA`/`CARITA_ERUCTO`, los dos índices que el HUD encadena.
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
- **No canalizar la salida de `publicar.ps1`.** Un `*>&1 | Tee-Object` convierte cada línea
  que Tauri escribe en stderr (hasta un `Info` inocuo) en `NativeCommandError` y aborta el
  script. Es la misma trampa que `2>&1` sobre ejecutables nativos en PowerShell 5.1.
- En Bash, `cmd | tail` se traga el exit code: usar `set -o pipefail`.
- **El `target/` guarda rutas absolutas: mover la carpeta del proyecto lo rompe.**
  El proyecto vivía en `C:\dev\Mike` y ahora en `C:\dev\Proyectos Personales\Mike`;
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

## Checkpoint — 28 de agosto de 2026

### Estado

| | |
|---|---|
| Versión publicada | **v0.8.0**, firmada y verificada (firma y SHA256 contra lo que descarga la app) |
| Versión en uso | **0.7.0** instalada y corriendo en el equipo de luisg; la 0.8.0 entra sola al abrir Ajustes |
| Repo | `main` en `99f67be`, **público**, sincronizado con GitHub |
| Releases vivas | v0.2.0 … v0.8.0, todas firmadas y verificadas |
| Tests | `cargo test --lib` → **19 verdes** |
| Build | `npm run build` limpio |
| Árbol de trabajo | limpio, nada suelto |
| Pendiente crítico | respaldar `dicho.key` — **sólo puede hacerlo luisg** |

Dicho está **en uso diario y estable**: 381 dictados en `dicho.log` y **ni un error**. Se
actualiza solo desde el 27/08 (medido: 7 s de punta a punta, sin intervención). El motor
por defecto en el equipo de luisg es Groq Whisper; el local (Parakeet V3) queda de reserva
y para trabajar sin internet.

### Qué pasó en la última sesión

El encargo fue **poder mover el HUD con el ratón**, porque a veces aparece justo encima de
lo que estás mirando. Salió en la **0.7.0**. Al usarla de verdad, luisg encontró dos cosas
en minutos, y ésas se arreglaron en la **0.8.0**, la misma tarde.

**Hallazgos, en orden de aparición:**

1. **El HUD no se podía agarrar de ninguna manera.** Era click-through entero
   (`set_ignore_cursor_events(true)` → `WS_EX_TRANSPARENT`), puesto a propósito para no
   comerse los clics de lo que hubiera debajo. Y eso es todo o nada: no se puede hacer
   transparente sólo un trozo de la ventana. Por eso el arrastre es un **ajuste**
   (`hud_arrastrable`, encendido por defecto) y no una decisión nuestra. Lo que **no** hubo
   que sacrificar es el foco: `set_focusable(false)` ya es `WS_EX_NOACTIVATE`, y una
   ventana así recibe el ratón sin activarse — comprobado con `GetForegroundWindow()`
   antes y después de arrastrar.
2. **`publicar.ps1` murió después de compilar y firmar.** PowerShell 5.1 no sabe pasarle a
   un `.exe` una cadena con comillas dentro: partió las notas del release en trozos y `gh`
   acabó buscando un asset llamado `la`. El instalador y el `.sig` ya estaban hechos y eran
   válidos, así que bastó crear el release a mano. Arreglado con `--notes-file`.
3. **La posición del HUD era una sola para todas las pantallas** (bug de la 0.7.0, lo vio
   luisg). Colocarlo en la 4K lo movía también en el portátil, y soltarlo en una pantalla
   no evitaba que el siguiente dictado lo sacara en la otra. Se reprodujo en `dicho.log`
   sin ambigüedad: `HUD movido a (1162,1088)` seguido, dos segundos después, de
   `HUD: área (2560,-306,…), pos (4179,1248)`.
4. **Barras de scroll dentro del HUD** (bug de la 0.7.0, lo vio luisg como "unas rayas a
   los costados"). No eran cosméticas: son barras de verdad, de las que reservan 15 px, que
   Windows mete cuando WebView2 se queda con el lienzo viejo al cruzar entre monitores de
   distinto DPI. Medido sin el arreglo: `scroll=360x96 client=345x81`, y hasta
   `scroll=1032x224 client=705x177` en pleno salto; con el arreglo, `scroll == client` en
   todas las transiciones.

**Archivos tocados:**

| Archivo | Qué cambió |
|---|---|
| `src-tauri/src/overlay.rs` | `arrastrar_con_cursor()`, `window_rect()`, `work_area_of()` |
| `src-tauri/src/settings.rs` | `HudPos` (fracción, clave por pantalla) + `hud_posiciones`, `hud_arrastrable`, y sus 6 tests |
| `src-tauri/src/pipeline.rs` | `place_hud()` respeta la posición guardada; `modo_colocar()`, `recolocar_hud()`, banderas `ARRASTRANDO`/`COLOCANDO` |
| `src-tauri/src/commands.rs` | `hud_arrastrar`, `hud_colocar`, `hud_pos_reset`, `aplicar_raton_hud` |
| `src-tauri/src/lib.rs` | Registro de comandos; el HUD ya no nace click-through a la fuerza |
| `src/windows/Hud.tsx` | Se agarra por cualquier punto; `overflow: hidden`; aviso `DESBORDE` en el log |
| `src/windows/Settings.tsx` | Botones "Mover la onda flotante" / "Devolverla a su sitio" + interruptor |
| `src/types.ts` | `HudPos`, `hud_posiciones`, `hud_arrastrable` |
| `publicar.ps1` | Notas del release por `--notes-file` |
| `CLAUDE.md` | Mapa, gotchas nuevos y este checkpoint |

### Lo que funciona y está probado

- **Dictado push-to-talk completo**: atajo global (hoy `Ctrl Der`) → graba → transcribe →
  pule → pega donde estés escribiendo → guarda en historial.
- **Dictados largos sin espera**: el audio se trocea en tus pausas y se transcribe mientras
  hablas. Medido: 45 s de audio → texto pegado **2 s** después de soltar, en 6 trozos. Tope
  de 10 min con cinta de capacidad en el HUD y autocorte que transcribe lo dicho en vez de
  tirarlo.
- **HUD siempre visible**: aparece en el monitor de la ventana activa (no en el primario) y
  reafirma su z-order cada 250 ms. Probado en las dos pantallas de luisg, incluida la 4K al
  250 %.
- **HUD movible con el ratón** (28/08): se agarra por cualquier punto y se suelta donde no
  estorbe. **Cada pantalla recuerda su propio rincón**, guardado en fracción del hueco
  libre y no en píxeles. Probado el viaje de ida y vuelta entre las dos pantallas de luisg:
  al estrenar la 4K sale en **su** abajo-centro (4030,1439) en vez de heredar el rincón del
  portátil, y cada pantalla conserva el suyo al ir y volver. Con el ajuste apagado vuelve a
  ser cristal: `WindowFromPoint` contesta la ventana de abajo y arrastrarlo no lo mueve.
- **26 caritas** con reglas de pixel-art documentadas en `faces.ts`, dos de ellas movidas
  por el volumen real del micro, y catálogo navegable desde Ajustes.
- **Robustez de voz**: compuerta de silencio, filtro de alucinaciones, y el pulido no puede
  devolver un dictado truncado (comprueba `finish_reason`).
- **Repartible a otra gente**: el instalador NSIS no exige cuenta ni configuración — los
  defaults son motor local + pulido por reglas, y la app se descarga sola el modelo
  (670 MB) al primer arranque. Va sin firma de código, así que SmartScreen avisa: "Más
  información" → "Ejecutar de todas formas". Sólo x64, nada de ARM.

### Siguiente paso inmediato

**Probar el modo colocación de punta a punta**, que es lo único que se publicó sin
verificar en vivo: el botón "Mover la onda flotante" de Ajustes salió en la 0.7.0 y sigue
en la 0.8.0, pero nunca se llegó a pulsar de verdad (luisg estaba usando la app y no se le
podía robar el foco). Las piezas de debajo sí están probadas —`place_hud`, el arrastre, el
cambio de modo de ratón—, o sea que el riesgo está en el cableado del botón.

Cómo: abrir Ajustes → Sistema → "Mover la onda flotante", y comprobar las cuatro cosas:

1. La onda sale y **se queda** a la vista (no se esconde a los 3 s) con el aro punteado y
   "Arrástrame".
2. Se puede arrastrar aunque el interruptor de arrastre esté **apagado** (durante la
   colocación se fuerza a que atrape el ratón).
3. Al pulsar "Listo, déjala ahí" se esconde y, si el interruptor estaba apagado, vuelve a
   ser cristal — se ve con `GetWindowLong(hwnd, -20)` y el bit `WS_EX_TRANSPARENT` (0x20).
4. Cerrando la ventana de Ajustes en mitad de la maniobra también se apaga (lo hace
   `on_window_event` en `lib.rs`).

Ojo al probarlo: cualquier script que robe el foco interrumpe a luisg si está dictando.
Mirar antes `dicho.log` para ver si hay actividad reciente.

### Lo que viene, por orden de valor

1. **Confirmar que dejó de traducir.** El arreglo (no fijar idioma + prompt de spanglish +
   troceo) está puesto pero sólo se ha validado en frío. Se comprueba mirando la columna
   `raw` del historial tras dictar mezclando idiomas a propósito. Si reaparece: segundo
   pase con `language` forzado sólo sobre los trozos sospechosos. **Depende de luisg.**
2. **Sincronización con Google de punta a punta.** El código está entero desde el 23/08 y
   nunca se ha ejecutado de verdad; bloqueado por el cliente OAuth (ver pendientes).
3. **Modo mascota**: HUD siempre visible. Ahora que se puede colocar donde no estorbe, esto
   es mucho más viable que antes: las 5 caritas de reposo casi no se ven porque el HUD sólo
   sale al dictar, y son las que darían personalidad. **Necesita que luisg decida** si
   quiere una cápsula permanente en pantalla.
4. **Purga del historial**: `mike.db` crece sin tope (381 dictados). No hay borrado por
   antigüedad ni límite de tamaño. Se empieza por `store.rs`. Es lo más sustancioso que se
   puede hacer **sin depender de luisg**.
5. **Atajo con teclas no-modificadoras** (hoy se exige al menos un modificador), con doble
   confirmación para no dejar la app inservible por accidente.
6. **Parakeet local con dictados largos**: el troceo secuencial está escrito pero no se ha
   probado con audio real largo en local.
7. **Vocabulario propio en el prompt del STT.** El diccionario personal llega al pulido con
   IA (`polish/groq.rs`) pero **no** al `prompt` de Whisper (`stt/groq.rs` sólo manda
   `PRIME_SPANGLISH`), o sea que hoy sólo puede corregir la palabra *después* de oírla mal,
   nunca ayudar a oírla bien. Cuidado: ese mismo prompt es lo que frena la traducción, así
   que meterle una lista de palabras puede debilitarlo — hay que medir antes y después.
   Baja prioridad hasta que haya una palabra concreta que falle ("cámara", el detonante
   original, se resolvió sola el 27/08).

### Pendientes que sólo puede hacer el usuario

- **Respaldar la clave privada del updater** (`%USERPROFILE%\.tauri\dicho.key`). El único
  pendiente crítico, y sólo existe una copia, en este disco. Sin ella, ni luisg ni ninguno
  de sus testers vuelve a recibir una actualización jamás: habría que reinstalar a mano en
  cada equipo. **Copiarla, no moverla** — `publicar.ps1` la lee de esa ruta exacta. Acordado
  el 27/08: arrastrarla a Google Drive como
  `DICHO - llave de actualizaciones - NO BORRAR NUNCA.key`.
- **Instalar la 0.8.0**: basta con abrir Ajustes; se actualiza sola y vuelve a abrirse.
- **Volver a colocar la onda** en cada pantalla. El ajuste cambió de forma en la 0.8.0 (de
  una posición a una por monitor) y arranca de cero: sale abajo-centro hasta que la coloque.
- **Crear el cliente OAuth de Google** (Perfil → Configurar, ~5 min y gratis). Es lo único
  que bloquea la sincronización de diccionario e historial entre equipos.
- **Dictar a propósito una frase mezclada** ("necesito hacer el deploy, but the client wants
  a demo first, así que preparo el pitch") y revisar en Historial si el texto crudo la
  respetó. Es la única prueba real del arreglo de traducción.
- **Decidir sobre el modo mascota**: ver el punto 3 de "lo que viene".
- **Avisar si cambia de plan en Groq**: con el gratuito hay 20 peticiones/minuto y por eso
  los trozos son de 20-55 s; con plan de pago se pueden hacer más cortos (mejor aún contra
  la traducción) y más paralelos.
- **Calibrar el umbral de silencio** si algún dictado real se marca como "no entendí": el
  rms de cada dictado queda en `dicho.log` y el umbral está en `pipeline.rs` (0.0012).

### Comprobar en dos minutos

```sh
cd src-tauri && cargo test --lib        # 19 verdes
npm run build                           # tsc + vite, sin errores
git status --short                      # vacío
```
```powershell
# Version instalada y viva (deberia coincidir con la ultima release publicada):
$exe = "$env:LOCALAPPDATA\Dicho\mike.exe"
(Get-Item $exe).VersionInfo.FileVersion
@(Get-Process mike -ErrorAction SilentlyContinue).Count
# Salud del ultimo uso: rms y trozos de cada dictado, y el aviso de lienzo roto
Get-Content "$env:APPDATA\dev.mike.app\dicho.log" -Tail 20
Select-String -Path "$env:APPDATA\dev.mike.app\dicho.log" -Pattern "DESBORDE|error" | Select-Object -Last 5
```

Revisión visual de las caritas (viva, se actualiza al republicar):
https://claude.ai/code/artifact/6e51420d-77cd-40b0-bcc5-ec39ce74e18f

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
