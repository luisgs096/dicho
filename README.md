# Dicho — dictado por voz push-to-talk

**Dicho y hecho.** Clon local y gratuito de Wispr Flow para Windows: mantén el atajo,
habla, suelta — y el texto aparece pulido donde estés escribiendo. Codename del repo: `mike`.

## Cómo funciona

1. Un hook global de teclado (`rdev`) detecta el atajo push-to-talk (configurable con un
   editor visual de teclado en Perfil).
2. Se graba el micrófono (`cpal`) y se remuestrea a 16 kHz (`rubato`) **mientras hablas**:
   cada pausa cierra un trozo de 20-55 s que se manda a transcribir al vuelo, así que al
   soltar la tecla sólo falta el último y un dictado de diez minutos responde casi como
   uno de veinte segundos. Tope de 10 minutos por dictado, con una cinta en el HUD que
   avisa desde la mitad; al llegar, Dicho se detiene solo y transcribe lo dicho.
   Motores:
   - **Local**: Parakeet V3 vía `transcribe-rs`/ONNX (privado, sin internet). Se carga a
     RAM al empezar a dictar y se libera a los 10 s de inactividad (~670 MB solo mientras
     se usa).
   - **Cloud (opcional)**: Groq Whisper large-v3 con API key gratuita; mejor spanglish.
3. El texto pasa por limpieza: reglas locales (muletillas, diccionario personal,
   puntuación) o LLM vía Groq (que trocea por bloques los dictados muy largos y descarta
   el pulido si sale truncado). Se inyecta con `enigo` en la app activa.
4. Todo dictado queda en historial (SQLite) con las correcciones del diccionario que
   aplicó; el diccionario y el historial pueden sincronizarse entre dispositivos vía la
   cuenta de Google del usuario (archivo en el appDataFolder privado de su Drive).

## Spanglish sin traducciones

Los modelos de voz fijan un solo idioma por cada tramo de 30 s y traducen a él lo que
venga en otro: por eso dos palabras en inglés podían voltear el dictado entero. Con
**"No traducir nunca"** (encendido por defecto, en Ajustes) Dicho no le fija idioma al
motor, le pasa una muestra real de spanglish como contexto de estilo y corta el audio en
tus pausas para que cada tramo decida por su cuenta.

## El HUD

Cápsula flotante estilo **tamagotchi**: pantalla LCD con rejilla pixel, micrófono
pixel-art y un personajito con 26 animaciones (5 variaciones por estado — escuchando,
pensando, listo, no-entendí, reposo, más el eructo) elegidas al azar en cada dictado, con
reacciones según el idioma detectado. Dos de las caritas de "te escucho" se mueven con el
volumen real del micrófono: el DJ con audífonos y la que se come tu voz como Pac-Man. A
esa última le responde el eructo, la única carita que no sale al azar. El botón **Ver animaciones** de Ajustes abre el catálogo completo.
En Ajustes puede cambiarse al estilo **clásico**: barras que crecen con la intensidad de
la voz.

La cápsula se coloca sobre el monitor donde estás trabajando (el de la ventana activa) y
reafirma su z-order mientras está visible, para que no se la coman otras ventanas.

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
