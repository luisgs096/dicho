# Cambios de Dicho

Lo que trae cada versión, en cristiano y en tres o cuatro líneas.

Este archivo es la **única fuente**: la app lo lleva dentro y enseña el apartado de la
versión que tienes instalada en **Ajustes → Novedades de esta versión**, siempre
disponible aunque no haya internet. Y `publicar.ps1` saca de aquí las notas del
Release cuando no le pasas `-Notas`.

Formato, para que las dos cosas lo sigan leyendo: `## X.Y.Z — fecha`, y debajo
guiones. Nada más.

## 0.8.4 — 15 de septiembre de 2026

- **Colocar la onda se decide sobre la onda misma.** Mientras la mueves lleva
  encima dos botones: una **palomita verde** para decir «ya, déjala aquí», y una
  **flecha** que la devuelve a su rincón de siempre. Ya no hay que volver a
  Ajustes para cerrar el modo.
- Tu posición no dependía nunca de confirmar nada: se guarda en cuanto sueltas la
  onda. La palomita sólo sale del modo colocación.

## 0.8.3 — 15 de septiembre de 2026

- **Las caritas por fin se mueven de verdad, también al dictar.** Sus gestos
  llevaban congelados desde siempre: cada vez que la onda refrescaba el volumen de
  tu voz —sesenta veces por segundo— las animaciones volvían a empezar de cero y
  nunca llegaban a verse. Sólo se salvaban las dos que laten con el micrófono.
- En Inicio, el botón «Mover la onda flotante» no se entendía: ahora es
  **«Seleccionar posición en pantalla»**, con un icono de arrastrar. Y
  «Devolverla a su sitio» lleva su flecha de deshacer.
- **«Ver las 26 caritas» pasa a estar dentro de la tarjeta del tamagotchi**, que
  es a quien pertenece, en vez de suelto entre los botones.

## 0.8.2 — 14 de septiembre de 2026

- Pantalla de **Inicio** nueva: el atajo para dictar y la onda flotante juntos, que
  es lo que de verdad usas a diario. Sustituye a «Perfil», que estaba casi vacío.
- **Vista previa animada** de los dos estilos de onda. Antes elegías a ciegas en una
  lista; ahora los ves a los dos haciendo el recorrido completo —te escucho,
  pensando, listo, no te escuché— y eliges con un clic.
- Ajustes se queda sólo con **lo complicado**: motores de voz, la key de Groq, la
  cuenta de Google y el arranque con Windows.
- **Novedades de esta versión** en Ajustes: qué cambió en la que tienes puesta, a
  mano siempre, no sólo el día que se instala.

## 0.8.1 — 13 de septiembre de 2026

- **Dicho escribe lo que dictas, nunca lo contesta.** Si dictabas una pregunta o una
  orden —«¿cuál es la mejor configuración del mando?»— a veces se pegaba *la
  respuesta* en vez de tu frase.
- El culpable era el pulido: confundía tu dictado con una orden para él y la
  obedecía. Ahora se le prohíbe de forma explícita.
- Y por si acaso, una red debajo: un pulido que cambie demasiado el tamaño de lo que
  dijiste se descarta y se usa la limpieza local, que respeta tus palabras exactas.

## 0.8.0 — 28 de agosto de 2026

- **Cada pantalla recuerda su propio rincón.** Antes la posición era una sola para
  todos los monitores: colocarla en la 4K la movía también en el portátil.
- **Fuera las rayas de los costados.** Eran barras de scroll de verdad, que Windows
  metía dentro de la onda al cruzar entre monitores de distinto DPI.

## 0.7.0 — 28 de agosto de 2026

- **La onda flotante se mueve**: arrástrala con el ratón hasta donde no te estorbe y
  se queda ahí, también al cambiar de pantalla.
- Ajustes trae «Mover la onda flotante» y «Devolverla a su sitio», para colocarla con
  calma sin tener que estar dictando.
- Y si te molesta que atrape los clics, puedes apagar el arrastre para que vuelva a
  ser un cristal que se atraviesa.

## 0.6.0 — 28 de agosto de 2026

- Dictados largos sin espera: el audio se trocea en tus pausas y se va transcribiendo
  mientras hablas.
- Tope de 10 minutos por dictado, con aviso en la onda y corte que transcribe lo
  dicho en vez de tirarlo.

## 0.5.0 — 28 de agosto de 2026

- La versión del panel lateral ya sale del programa y no escrita a mano, que se
  quedaba clavada en la del día que se tecleó.

## 0.4.0 — 28 de agosto de 2026

- **Dicho vuelve a abrirse solo después de actualizarse.** El instalador lo cerraba y
  no lo relanzaba; ahora la app deja programado su propio regreso antes de instalar.

## 0.3.0 — 27 de agosto de 2026

- Primera versión que se actualiza sola de verdad, con la firma comprobada.

## 0.2.0 — 27 de agosto de 2026

- Estreno de la actualización automática y firmada.
