# Dicho (codename mike) — notas de trabajo

App Tauri 2 + React 19 + Tailwind 4 de dictado push-to-talk para Windows. Ver README.md
para la descripción funcional. El usuario (luisg) dicta en español/spanglish y prueba la
app dictándole a Claude; prioriza soluciones locales y gratuitas.

## Mapa del código

- `src-tauri/src/pipeline.rs` — hilo central: grabar → resample → compuerta de silencio
  (rms máx por ventana < 0.0012 → estado `empty`) → STT → filtro de alucinaciones →
  polish → inyectar → historial. Carga perezosa de Parakeet (al pulsar el atajo, en hilo
  aparte) y liberación a los 10 s sin dictar. `diag()` escribe a
  `%APPDATA%/dev.mike.app/dicho.log` (sobrevive en release; cada dictado loguea su rms).
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
  correcciones + filtro), Ajustes (motores, modelo local, Groq key, estilo del HUD,
  autostart) anclado abajo.
- `src/windows/Hud.tsx` — HUD con dos estilos conmutables desde Ajustes
  (`settings.hud_style`, evento `settings-changed` para refrescar al vuelo):
  - `tamagotchi` (default): pantalla LCD pixel, motor de sprites por mapas de texto
    (`spr()`), 25 caritas = 5 variaciones × 5 estados elegidas al azar por transición,
    reacción por idioma en "listo" (heurística es/en sobre el texto).
  - `classic`: pill claro + 5 barras movidas por `audio-level` (rAF); en `empty` las
    barras se pintan naranjas, el fondo se tiñe, vibra y dice "Perdón, no escuché…".

## Convenciones y gotchas

- Comentarios, commits y UI en español.
- La app instalada vive en `%LOCALAPPDATA%\Dicho\mike.exe` (NSIS per-user); el Run key
  de autostart apunta ahí. Los builds debug NUNCA tocan el autostart (guard).
- Instancia única por identifier `dev.mike.app`: cerrar Dicho antes de `tauri dev`.
- Ciclo de entrega usado: `npm run tauri build` → instalar silencioso con `/S` →
  relanzar `mike.exe`. La instalación mata la app en uso: avisar al usuario.
- reqwest 0.13: `.form()`/`.query()` son features (`form`, `query`) — ya activadas.
- En Bash, `cmd | tail` se traga el exit code: usar `set -o pipefail`.
- Test E2E sin tocar el mic: simular el atajo con `keybd_event` (P/Invoke) con Notepad
  en foco y verificar la cadena en `dicho.log` (rms 0 → evento empty → carita).

## Estado al cierre del 2026-08-23

Hecho hoy: fix autostart (apuntaba al build debug), sidebar + correcciones de
diccionario en historial, HUD barras → caritas tamagotchi (mockups en artifact
aprobados por rondas), Google sync implementado (pendiente de client OAuth del
usuario), RAM 723→32 MB (carga perezosa del modelo), compuerta de silencio +
anti-alucinaciones (umbral calibrable con el rms logueado), editor visual de atajo
(usuario lo cambió a ControlRight), toggle de estilo del HUD.

Pendientes naturales:
- Probar el flujo Google completo cuando el usuario cree su client OAuth.
- Calibrar umbral de silencio con los rms reales del log si reaparecen falsos positivos.
- Posible "modo mascota": HUD siempre visible para que se vean las caritas de reposo.
- Atajo: permitir teclas no-modificadoras con doble confirmación (hoy exige modificador).
- Mockups vivos en https://claude.ai/code/artifact/4297faa5-c8dd-4d00-9205-3332a46e92e2
