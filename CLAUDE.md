# Dicho (codename mike) — notas de trabajo

App Tauri 2 + React 19 + Tailwind 4 de dictado push-to-talk para Windows. Ver README.md
para la descripción funcional. El usuario (luisg) dicta en español/spanglish y prueba la
app dictándole a Claude; prioriza soluciones locales y gratuitas.

## Cuando luisg diga "cierre"

Pide un **checkpoint escrito aquí**, no un resumen en el chat: la siguiente instancia tiene
que poder arrancar leyendo sólo este archivo. Trabaja con instancias que no comparten
memoria, así que lo que no quede en el `.md` se pierde.

El cierre deja por escrito: **qué se hizo** y **qué archivos se tocaron**; los **hallazgos**
(bugs, con su causa raíz y cómo se reprodujeron); los **aprendizajes/gotchas** que costaron
descubrir; las **actualizaciones** publicadas; los **pendientes**, separando lo que puede
hacer la siguiente instancia de lo que sólo puede hacer él; y **dónde estamos parados**.

Consolidar, no apilar: si una sección se desordenó con ediciones incrementales durante la
sesión, se reescribe entera. Y commitear el resultado.

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
  `show_hud()` coloca el HUD abajo-centro del **monitor activo** y deja un hilo
  vigilante (tick de 70 ms y luego 250 ms) que reafirma el topmost y lo recoloca
  si cambias de pantalla o de DPI.
- `src-tauri/src/chunker.rs` — dónde partir el audio: corta en pausas (4 ventanas de
  100 ms bajo un umbral relativo al pico del hablante), nunca en seco. Con tests.
- `src-tauri/src/overlay.rs` — Win32 (windows-sys): área de trabajo del monitor de
  la ventana en primer plano (`GetForegroundWindow` → `MonitorFromWindow` →
  `rcWork`) y `SetWindowPos(HWND_TOPMOST, SWP_NOACTIVATE)`. Con dos pantallas el
  HUD salía siempre en el primario: parecía que no aparecía.
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
  del HUD + botón "Ver animaciones", autostart, actualizaciones) anclado abajo.
  Ojo: `update()` en este archivo es el que guarda **ajustes**, no el de versiones;
  el de versiones se destructura como `actualizacion`/`buscarActualizacion`.
- `src/windows/updater.ts` — hook `useUpdater()`: consulta la release más reciente al
  abrir Ajustes (callado si no hay nada o no hay internet, ruidoso sólo si el usuario
  pulsó el botón), descarga con progreso e instala. La verificación de firma la hace
  el plugin de Tauri, no este código.
- `src/windows/Animaciones.tsx` — catálogo modal de las 25 caritas, animándose de verdad.
  Importa `V`/`MIC_SVG`/`FACE_CSS` de `faces.ts`, o sea que muestra exactamente lo que
  verá el usuario al dictar; si se añade una carita, aparece aquí sola.
- `src/windows/faces.ts` — motor de caritas: sprites en mapas de texto, las 25
  escenas y el CSS (carcasa + animaciones). Reglas: coordenadas enteras, rejilla
  fija (ojos de 3 px en x=15 y x=27, cara centrada en 22), un gesto por carita,
  bucles ≤1,4 s y movimiento a `steps(1, end)` para que el pixel-art no tiemble.
  Se previsualiza con `npx esbuild src/windows/faces.ts --bundle --format=iife
  --global-name=FACES` + una página que pinte `FACES.V`.
- `src/windows/Hud.tsx` — HUD con dos estilos conmutables desde Ajustes
  (`settings.hud_style`, evento `settings-changed` para refrescar al vuelo):
  - `tamagotchi` (default): pantalla LCD pixel (viewBox `0 2 48 16`), 25 caritas =
    5 variaciones × 5 estados elegidas al azar por transición, reacción por idioma
    en "listo" (heurística es/en sobre el texto). La variable CSS `--lvl` lleva el
    volumen real del micro a las caritas reactivas (barras y boca).
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
- Traducción indeseada: **es Whisper, no el pulido** (medido: 0 de 120 dictados cambian de
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
- **No canalizar la salida de `publicar.ps1`.** Un `*>&1 | Tee-Object` convierte cada línea
  que Tauri escribe en stderr (hasta un `Info` inocuo) en `NativeCommandError` y aborta el
  script. Es la misma trampa que `2>&1` sobre ejecutables nativos en PowerShell 5.1.
- En Bash, `cmd | tail` se traga el exit code: usar `set -o pipefail`.
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
- Test E2E sin tocar el mic: simular el atajo con `keybd_event` (P/Invoke) y verificar
  la cadena en `dicho.log` (rms 0 → evento empty → carita). El Notepad de Win11 no
  expone `MainWindowHandle`: para elegir en qué monitor cae el foco, crear un
  `System.Windows.Forms.Form` en la posición deseada y robarle el foco con el truco
  del ALT (`keybd_event(0x12)` antes de `SetForegroundWindow`, si no Windows lo ignora).

## Dónde estamos (27 de agosto de 2026)

### Checkpoint (27/08, cierre de la sesión)

| | |
|---|---|
| Versión publicada e instalada | **v0.5.0**, corriendo |
| Repo | `main` en `8d02400`, **público**, sincronizado con GitHub |
| Releases vivas | v0.2.0 … v0.5.0, todas firmadas y verificadas |
| Tests | `cargo test --lib` → **13 verdes** |
| Build | `npm run build` limpio |
| Árbol de trabajo | limpio, nada suelto |
| Único pendiente crítico | respaldar `dicho.key` (sólo puede hacerlo luisg) |

Dicho está **en uso diario y estable**, y desde hoy **se actualiza solo**. El veredicto del
usuario esta mañana: "es bastante preciso ahora y ya puedo hablar con mayor fluidez sin
miedo a que no lo vaya a entender".

### Qué pasó el 27/08 y qué se tocó

La sesión empezó como un chequeo de rutina y destapó que **la auto-actualización nunca
había funcionado**: no existía ninguna release y la copia instalada seguía siendo la 0.1.0,
sin updater. Arreglarlo de verdad costó cuatro releases y tres bugs encadenados.

**Hallazgos, en orden de aparición:**

1. **`publicar.ps1` nunca llegaba a publicar.** Tres trampas encadenadas, ninguna visible
   en el error que se veía (documentadas en gotchas): la variable de entorno vacía que
   PowerShell borra, `npm.cmd` lanzado directo, y canalizar la salida del script.
2. **La versión del panel lateral estaba escrita a mano** (`v0.1` literal en
   `Settings.tsx`) mientras Ajustes leía la real con `getVersion()`. Lo detectó el usuario
   al ver las dos a la vez tras actualizar.
3. **El instalador NSIS no reabría la app.** Instalaba bien y dejaba al usuario sin Dicho.
   Reproducido en las dos direcciones antes de tocar nada — ésa fue la clave para dar con
   la causa (ver gotchas).
4. **La comprobación de actualizaciones sólo ocurre al abrir Ajustes.** Salió al probar la
   0.5.0: con la ventana ya abierta, decía que estaba al día.

**Archivos tocados:**

| Archivo | Qué cambió |
|---|---|
| `publicar.ps1` | Build lanzado por `ProcessStartInfo` con la password vacía; firma en paso propio |
| `src-tauri/src/commands.rs` | `programar_relanzamiento()` + `script_relanzador()` con su test |
| `src-tauri/src/lib.rs` | Registro del comando nuevo |
| `src/windows/updater.ts` | Programa el relanzador antes de instalar |
| `src/windows/Settings.tsx` | La versión del sidebar sale del binario |
| `CLAUDE.md` | Gotchas, auditoría de secretos, este checkpoint |
| `tauri.conf.json`, `package.json`, `Cargo.toml` | Versión 0.1.0 → 0.5.0 |

**Aprendizaje que vale para el futuro**: en los tres bugs, lo que resolvió no fue leer el
error sino **reproducir el fallo en las dos direcciones** (con y sin la condición
sospechosa). El caso del instalador es el ejemplo puro: el mensaje no decía nada, pero
"app cerrada antes → vuelve / app cerrándose durante → no vuelve" señaló la causa exacta.
También quedó claro que **verificar que un release existe no es verificar que sirve**: hay
que comprobar firma y SHA256 contra lo que descarga la app.

### Lo que funciona y está probado

- **Dictado push-to-talk completo**: atajo global (hoy `Ctrl Der`) → graba → transcribe →
  pule → pega donde estés escribiendo → guarda en historial. Motor por defecto: Groq
  Whisper; el local (Parakeet V3) queda de reserva y para trabajar sin internet.
- **Dictados largos sin espera**: el audio se trocea en tus pausas y se transcribe
  mientras hablas. Medido: 45 s de audio → texto pegado **2 s** después de soltar, en
  6 trozos; los dictados reales de 30-38 s salen en 2-3 trozos. Tope de 10 min con cinta
  de capacidad en el HUD (azul a la mitad, naranja al 85 %) y autocorte que transcribe lo
  dicho en vez de tirarlo.
- **HUD siempre visible**: aparece en el monitor de la ventana activa (no en el primario)
  y reafirma su z-order cada 250 ms. Probado en las dos pantallas del usuario, incluida la
  4K al 250 % — que además destapó que WebView2 no reescala solo (ver gotchas).
- **25 caritas** con reglas de pixel-art documentadas en `faces.ts`, dos de ellas movidas
  por el volumen real del micro, y catálogo navegable desde Ajustes.
- **Robustez de voz**: compuerta de silencio, filtro de alucinaciones, y el pulido ya no
  puede devolver un dictado truncado (comprueba `finish_reason`).
- **Repartible a otra gente**: el instalador NSIS no exige cuenta ni configuración —
  los defaults de `settings.rs` son motor local + pulido por reglas, y la app se descarga
  sola el modelo (670 MB) al primer arranque. Va sin firma de código, así que SmartScreen
  avisa: "Más información" → "Ejecutar de todas formas". Sólo x64, nada de ARM.
- **«cámara» ya sale bien** (27/08): aparece escrita correctamente en el historial
  ("vuelvo a probarlo de cámara, por ejemplo, la usé ahorita"). El prompt de spanglish la
  sostiene sin necesidad de entrada de diccionario.
- Tests y build en verde (27/08): `cargo test --lib` → **13 verdes** (chunker, reglas de
  pulido, diccionario, script del relanzador), `npm run build` limpio y `dicho.log` sin un
  solo error en 253 dictados registrados.

### Auto-actualización (funcionando de punta a punta)

**Estado hoy**: v0.5.0 publicada e instalada en el equipo de luisg. Cuatro releases el
27/08 (0.2.0 → 0.5.0), todas firmadas y verificadas.

**El ciclo completo está probado en vivo**, no sólo en frío. Medido en la 0.4.0 → 0.5.0:
comprobar, descargar, instalar y volver a abrirse tardó **7 segundos** sin intervención.
La secuencia queda en `dicho.log` y sirve de patrón para diagnosticar si algún día falla:

```
22:42:42  Updater: relanzamiento programado   ← la app deja el vigilante antes de instalar
22:42:47  arranca el proceso nuevo            ← los 3 s de espera + el primer reintento
22:42:49  HUD-JS: montado                     ← 0.5.0 viva
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
  arrancar la app a media instalación y el instalador la mataría (el bucle de reintentos ya
  no vigila: sale en cuanto ve un proceso vivo). Si vuelve a quedarse cerrada tras
  actualizar, el arreglo es esperar a que desaparezca el proceso del instalador antes del
  primer intento.
- **La comprobación sólo ocurre al *abrir* la ventana de Ajustes.** Con la ventana ya
  abierta no vuelve a mirar nunca: al publicar la 0.5.0 el usuario la tenía abierta desde
  antes y le decía que estaba al día. El botón de buscar siempre funciona. La mejora, si se
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

### Lo que viene, por orden de valor

1. **Confirmar que dejó de traducir.** El arreglo (no fijar idioma + prompt de spanglish +
   troceo) está puesto pero sólo se ha validado en frío. Se comprueba mirando la columna
   `raw` del historial tras dictar mezclando idiomas a propósito. Si reaparece: segundo
   pase con `language` forzado sólo sobre los trozos sospechosos.
2. **Sincronización con Google de punta a punta.** El código está entero desde el 23/08 y
   nunca se ha ejecutado de verdad; bloqueado por el cliente OAuth (ver pendientes).
3. **Modo mascota**: HUD siempre visible. Hoy las 5 caritas de reposo casi no se ven
   porque el HUD sólo sale al dictar, y son las que darían personalidad en reposo.
4. **Atajo con teclas no-modificadoras** (hoy se exige al menos un modificador), con doble
   confirmación para no dejar la app inservible por accidente.
5. **Purga del historial**: `mike.db` crece sin tope. Aún es pequeño, pero no hay borrado
   por antigüedad ni límite de tamaño.
6. **Parakeet local con dictados largos**: el troceo secuencial está escrito pero no se ha
   probado con audio real largo en local.
7. **Vocabulario propio en el prompt del STT.** El diccionario personal llega al pulido con
   IA (`polish/groq.rs`) pero **no** al `prompt` de Whisper (`stt/groq.rs` sólo manda
   `PRIME_SPANGLISH`), o sea que hoy sólo puede corregir la palabra *después* de oírla mal,
   nunca ayudar a oírla bien. El `prompt` de Whisper es justo la palanca documentada para
   sesgar vocabulario. Cuidado: ese mismo prompt es lo que frena la traducción, así que
   meterle una lista de palabras puede debilitarlo — hay que medir antes y después.
   Ojo: el detonante original ("cámara" no aparecía nunca) **ya no aplica** — se resolvió
   solo el 27/08. Así que esto baja de prioridad hasta que haya otra palabra que falle.

### Pendientes del usuario (nadie más puede hacerlos)

- **Crear el cliente OAuth de Google** (Perfil → Configurar, ~5 min y gratis). Es lo único
  que bloquea la sincronización de diccionario e historial entre equipos.
- **Dictar a propósito una frase mezclada** ("necesito hacer el deploy, but the client
  wants a demo first, así que preparo el pitch") y revisar en Historial si el texto crudo
  la respetó. Es la única prueba real del arreglo de traducción.
- **Decidir sobre el modo mascota**: si quiere ver las caritas en reposo hay que dejar el
  HUD siempre encima, y eso significa una cápsula permanente en pantalla.
- **Avisar si cambia de plan en Groq**: con el gratuito hay 20 peticiones/minuto y por eso
  los trozos son de 20-55 s; con plan de pago se pueden hacer más cortos (mejor aún contra
  la traducción) y más paralelos.
- **Calibrar el umbral de silencio** si algún dictado real se marca como "no entendí": el
  rms de cada dictado queda en `dicho.log` y el umbral está en `pipeline.rs` (0.0012).
- **Respaldar la clave privada del updater** (`%USERPROFILE%\.tauri\dicho.key`). Es el
  único pendiente crítico y sólo existe una copia, en este disco. Sin ella, ni luisg ni
  ninguno de sus testers vuelve a recibir una actualización jamás; habría que reinstalar a
  mano en cada equipo. **Copiarla, no moverla** — `publicar.ps1` la lee de esa ruta exacta.
  Acordado el 27/08: arrastrarla a Google Drive como
  `DICHO - llave de actualizaciones - NO BORRAR NUNCA.key`. No hace falta gestor de
  contraseñas; el riesgo no es que alguien la robe, es perderla.

### Comprobar en dos minutos que sigue todo vivo

```sh
cd src-tauri && cargo test --lib        # 13 tests
npm run build                           # tsc + vite
```
```powershell
# version instalada y viva (deberia coincidir con la ultima release):
$exe = "$env:LOCALAPPDATA\Dicho\mike.exe"
(Get-Item $exe).VersionInfo.FileVersion
@(Get-Process mike -ErrorAction SilentlyContinue).Count
Get-Content "$env:APPDATA\dev.mike.app\dicho.log" -Tail 20   # rms y trozos de cada dictado
```

Revisión visual de las caritas (viva, se actualiza al republicar):
https://claude.ai/code/artifact/6e51420d-77cd-40b0-bcc5-ec39ce74e18f

## Historial de sesiones

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
