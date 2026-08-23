# Dicho — dictado por voz push-to-talk

**Dicho y hecho.** Clon local y gratuito de Wispr Flow para Windows: mantén el atajo,
habla, suelta — y el texto aparece pulido donde estés escribiendo. Codename del repo: `mike`.

## Cómo funciona

1. Un hook global de teclado (`rdev`) detecta el atajo push-to-talk (configurable con un
   editor visual de teclado en Perfil).
2. Se graba el micrófono (`cpal`), se remuestrea a 16 kHz (`rubato`) y se transcribe:
   - **Local**: Parakeet V3 vía `transcribe-rs`/ONNX (privado, sin internet). Se carga a
     RAM al empezar a dictar y se libera a los 10 s de inactividad (~670 MB solo mientras
     se usa).
   - **Cloud (opcional)**: Groq Whisper large-v3 con API key gratuita; mejor spanglish.
3. El texto pasa por limpieza: reglas locales (muletillas, diccionario personal,
   puntuación) o LLM vía Groq. Se inyecta con `enigo` en la app activa.
4. Todo dictado queda en historial (SQLite) con las correcciones del diccionario que
   aplicó; el diccionario y el historial pueden sincronizarse entre dispositivos vía la
   cuenta de Google del usuario (archivo en el appDataFolder privado de su Drive).

## El HUD

Cápsula flotante estilo **tamagotchi**: pantalla LCD con rejilla pixel, micrófono
pixel-art y un personajito con 25 animaciones (5 variaciones por estado — escuchando,
pensando, listo, no-entendí, reposo) elegidas al azar en cada dictado, con reacciones
según el idioma detectado. En Ajustes puede cambiarse al estilo **clásico**: barras que
crecen con la intensidad de la voz.

Robustez de voz: compuerta de silencio (audio sin energía no se transcribe) y filtro de
frases alucinadas por los modelos STT ("traducido por…", "subtítulos realizados por…").

## Desarrollo

```sh
npm install
npm run tauri dev      # desarrollo (cierra antes la app instalada: instancia única)
npm run tauri build    # release + instalador NSIS en src-tauri/target/release/bundle/nsis/
```

Los builds debug muestran consola y usan el dev server de Vite; el autostart de Windows
solo se gestiona desde builds release (guard en `commands.rs`).
