# Dicho (codename mike) — notas de trabajo

App Tauri 2 + React 19 + Tailwind 4 de dictado push-to-talk para Windows. Ver README.md
para la descripción funcional. El usuario (luisg) dicta en español/spanglish y prueba la
app dictándole a Claude; prioriza soluciones locales y gratuitas.

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

Dicho está **en uso diario y estable**. El usuario lo usa para dictarle a Claude a diario;
en el historial hay 200+ dictados reales, la mayoría de 20-40 s, y su veredicto de hoy:
"es bastante preciso ahora y ya puedo hablar con mayor fluidez sin miedo a que no lo vaya
a entender".

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
- Tests y build en verde (27/08): `cargo test --lib` → 12 verdes (chunker, reglas de
  pulido, diccionario), `npm run build` limpio y `dicho.log` sin un solo error en 253
  dictados registrados.

### Auto-actualización: publicada y verificada (27/08)

La **v0.2.0 está publicada** en https://github.com/luisgs096/dicho/releases/tag/v0.2.0 con
`Dicho_0.2.0_x64-setup.exe` + `latest.json`. Verificado de punta a punta, no sólo que el
release existiera: `latest.json` se descarga desde la URL exacta que consulta la app
(`releases/latest/download/latest.json`), va sin BOM, parsea, su campo `signature` es igual
al `.sig` local, y el `.exe` publicado es **idéntico en SHA256** al que se firmó.

**Ya instalada** en el equipo de luisg (27/08 17:18): el `mike.exe` de
`%LOCALAPPDATA%/Dicho` reporta 0.2.0 y su binario sí contiene el endpoint del updater. Los
ajustes y la API key sobrevivieron a la reinstalación (viven en `%APPDATA%` y en el
Administrador de credenciales, no dentro del programa). Ése era el único paso manual: de la
0.3.0 en adelante se actualiza sola al abrir Ajustes.

**Auditoría de secretos antes del primer reparto a terceros** (27/08). Todo limpio, y
conviene rehacerla cada vez que se publique:
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
   Detonante: "cámara" no aparece ni una vez en 200+ dictados del historial.

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
- **Guardar la clave privada del updater** (`%USERPROFILE%\.tauri\dicho.key`) en un gestor
  de contraseñas. Es irreemplazable: sin ella, ninguna copia instalada vuelve a
  actualizarse nunca.

### Comprobar en dos minutos que sigue todo vivo

```sh
cd src-tauri && cargo test --lib        # 12 tests
npm run build                           # tsc + vite
```
```powershell
# el binario instalado es el del último build:
$exe = "$env:LOCALAPPDATA\Dicho\mike.exe"
[Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($exe)).Contains("Ayer tuve un meeting")
Get-Content "$env:APPDATA\dev.mike.app\dicho.log" -Tail 20   # rms y trozos de cada dictado
```

Revisión visual de las caritas (viva, se actualiza al republicar):
https://claude.ai/code/artifact/6e51420d-77cd-40b0-bcc5-ec39ce74e18f

## Historial de sesiones

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
