# Cambios de Dicho

Lo que trae cada versión, en cristiano y en tres o cuatro líneas.

Este archivo es la **única fuente**: la app lo lleva dentro y enseña el apartado de la
versión que tienes instalada en **Ajustes → Novedades de esta versión**, siempre
disponible aunque no haya internet. Y `publicar.ps1` saca de aquí las notas del
Release cuando no le pasas `-Notas`.

Formato, para que las dos cosas lo sigan leyendo: `## X.Y.Z — fecha`, y debajo
guiones. Nada más.

## 0.11.4 — 16 de septiembre de 2026

- **LABS ya no promete de más.** Decía que ninguno de los dos modos añade palabras
  que no dijiste, y no es cierto: el Editor sí pone las suyas —los conectores, y el
  remate de una frase que dejaste a medias—, porque sin eso no podría redactar. Lo
  que no inventa son datos, cifras ni conclusiones, y eso es lo que ahora dice.
- **El contador de muletillas cuadra con lo que resalta.** Contaba las que se fueron
  pero encendía todas las que había: ahora dice las dos cifras.
- **Los anglicismos se marcan también en el texto crudo.** Si estabas viendo el
  crudo, los que sólo aparecían ahí no se resaltaban.
- Si te quedas sin key de Groq, el selector de la onda se apaga solo en vez de
  quedarse puesto y muerto.
- El teclado ya sabe cómo se llama la tecla `< >` de los teclados españoles.
- Si Windows no deja cambiar el arranque automático, ahora queda anotado en vez de
  desaparecer en silencio.
- Por dentro: la fusión del respaldo de Google va en una sola transacción (antes era
  una escritura al disco por dictado), y el número de caritas sale del repertorio en
  vez de estar escrito a mano en dos sitios.

## 0.11.3 — 16 de septiembre de 2026

- **Arreglado: Dicho se cerraba solo y a veces no volvía a abrir.** Era un fallo de
  arranque, no de la actualización: la ventana de Ajustes empieza a cargar antes de
  que la app termine de prepararse, y si le ganaba la carrera el proceso moría en
  seco. Unas veces sí y otras no, y sin dejar rastro en el registro porque moría
  antes de escribirlo. Ahora todo está listo antes de que exista la primera ventana.
- **Los ajustes dejan de pisarse entre ventanas.** Si elegías Editor en la onda y
  luego marcabas cualquier casilla en Ajustes, volvía a Estándar sin avisar. Pasaba
  igual con la onda clavada.
- **La onda clavada ya no se queda muerta.** Con ella clavada y el arrastre apagado,
  guardar cualquier ajuste la volvía intocable: su propio menú dejaba de responder y
  no había forma de desclavarla sin reiniciar.
- **La tecla de cancelar ya no admite una del atajo.** Si elegías una, cada dictado se
  cancelaba solo nada más empezar. Ahora te avisa y no te deja.
- El contador de muletillas no veía las acentuadas: "más bien", "¿sabes?" y "¿no?" no
  se contaban nunca.
- Dictar con un filtro escrito en el Historial te devolvía la lista entera.
- Si algún día no se puede guardar un dictado en el Historial, ahora se dice. Antes el
  texto se pegaba igual y parecía que había quedado guardado.

## 0.11.2 — 16 de septiembre de 2026

- **Las flechas vuelven a su sitio: dentro del teclado.** En la 0.11.1 las saqué a
  un bloque aparte a la derecha, y en un portátil no están ahí — la ↑ va al final
  de la fila del Mayús derecho y las otras tres justo debajo. Ahora es así, en los
  dos teclados.
- De paso, el teclado entero cuadra: las teclas se colocan por posición y no
  repartiéndose el hueco, así que todas las filas empiezan y acaban en la misma
  columna y la ↑ queda exactamente encima de la ↓.

## 0.11.1 — 16 de septiembre de 2026

- **La tecla para cancelar ya se elige.** Antes era Escape y punto, y eso tenía un
  problema gordo: como se pulsa con el atajo apretado, si dictas con Ctrl la
  combinación acaba siendo **Ctrl+Esc, que es como Windows abre el menú Inicio**.
  Se escoge en el mismo teclado del atajo, con un interruptor arriba.
- **Dicho te avisa si tu combinación choca con Windows** y te dice cuál es y por
  qué. Ni Dicho ni ninguna app puede ganarle al sistema esas teclas; lo único que
  se puede hacer es elegir otra, y ahora se ve cuándo hace falta.
- **El teclado gráfico habla tu idioma.** Español de Latinoamérica, de España o
  inglés US: la Ñ sale donde te la esperas y aparece la tecla de más que llevan
  los teclados de acá entre el Mayús y la Z. Es sólo lo que dice cada tecla — por
  dentro se identifican por su posición.
- **Y ya se ven las flechas.** Iban en línea con el resto de la última fila, que
  sumaba más ancho del que había, y la de arriba y la de abajo se aplastaban hasta
  desaparecer. Ahora van aparte en su T, como en el teclado de verdad.
- **LABS se queda en un solo interruptor: habilitar el Editor.** Los otros dos
  modos sobraban ahí — "Tal cual" es lo que hace Dicho solo cuando no hay key, y
  elegir entre Estándar y Editor se hace en la onda, que es donde de verdad lo
  decides: justo antes de hablar.

## 0.11.0 — 16 de septiembre de 2026

- **El historial ahora cuenta qué pasó con cada dictado.** Cada tarjeta enseña en
  un renglón la fecha, el modo que redactó y cuántas correcciones hubo; el botón
  de la **i** despliega el detalle. Al pasar el ratón por un indicador se resalta
  en el texto lo que cuenta, cada uno con su color, y el interruptor
  **CRUDO/FINAL** de arriba a la derecha te deja ver lo que salió de la voz antes
  de redactar.
- **Los chips de correcciones dejan de mentir.** Estaban calculados sobre el texto
  crudo, así que eran una predicción y no un registro: medido, 10 de 21 decían
  haberse aplicado y no estaban en el texto. Ahora se miden después de redactar y
  las que el modelo ignoró salen marcadas — así te enteras de que tu diccionario
  no se está respetando, en vez de creer que sí.
- **La animación de actualizar es otra, y dura 1,8 s.** Dentro de la onda de
  siempre: la cápsula se llena de verde menta mientras los ojos giran, sale tu
  número de versión en grande sobre un destello blanco, y la carita vuelve
  revelándose píxel a píxel. El estilo clásico también la tiene.
- **Las secciones de la ventana se pliegan** y la app recuerda cómo las dejaste.
  Ya no hace falta bajar media pantalla para llegar a lo de abajo.
- **LABS se va al final de Inicio y se pone verde entero**, para que se note de un
  vistazo qué parte es el experimento.
- **El dictado se puede quedar en el portapapeles** (Ajustes), para volver a
  pegarlo con Ctrl+V donde quieras. Y el botón de copiar del historial por fin
  dice que copió.
- La onda adelgaza 8 px: tenía una franja invisible abajo que sólo servía para
  atrapar clics donde no había nada dibujado.

## 0.10.1 — 15 de septiembre de 2026

- **"Estructurado" ahora se llama "Editor".** El nombre viejo no decía nada:
  "Ordenado" y "Estructurado" eran dos adjetivos del mismo eje y sonaban igual,
  así que no se entendía en qué se diferenciaban. "Editor" nombra un oficio —lo
  que hace es lo que haría un editor con tu texto— y por eso no se confunde con
  "Estándar".
- Tu modo elegido se respeta: por dentro sigue siendo el mismo ajuste, sólo
  cambia el nombre que ves.

## 0.10.0 — 15 de septiembre de 2026

- **El modo Estructurado ahora sí redacta.** No estaba haciendo casi nada: medido
  contra tus propios dictados, devolvía el texto **idéntico** al crudo, con las
  muletillas y los puntos suspensivos intactos. Ahora lee la idea entera y la
  vuelve a escribir en párrafos. En tres dictados reales pasó de 1,00x a 0,49x–0,68x,
  sin una sola muletilla y sin un solo "...".
- **Usa un modelo más grande** (120b en vez de 20b). El chico no reordenaba: si te
  corregías a media frase —"de tres opciones… no, de dos"— dejaba las dos y se
  contradecía. Cuesta unos 2 segundos más, y sólo en este modo: el Estándar sigue
  igual de rápido.
- **El selector de la onda es ahora un toggle de dos**, Estándar y Estructurado,
  cada uno con su color. Colapsado se ve sólo la rayita del que está puesto; al
  pasar el ratón salen los nombres.
- **Ya no se puede cambiar de modo a media frase.** Mientras dictas la barra se ve,
  pero se queda quieta: elegirlo a mitad de un dictado no tenía a qué aplicarse.
- Si el modelo grande no contesta, cae al Estándar antes que al pulido por reglas.
  Antes pasaba de un texto redactado a uno sin tocar, y sin avisar.
- Cada dictado deja en el log qué modo corrió y cuánto cambió el texto. Sin eso no
  había forma de contestar "¿por qué salió igual que el crudo?".

## 0.9.9 — 15 de septiembre de 2026

- **La cinta de niveles ahora vive dentro de la onda, no pegada debajo.** En la
  0.9.8 se veían como dos piezas distintas; ahora es una sola: la cápsula creció
  un poco y la cinta se apoya en su borde de abajo, recortada por la misma curva.
- **En reposo no es un menú, es una rayita encendida** bajo el nivel que está
  puesto —izquierda, centro o derecha—. De un vistazo sabes en qué modo estás sin
  que le robe sitio a la carita.
- **Se despliega con los nombres al pasar el ratón por cualquier parte de la
  onda**, no sólo por encima de la cinta. Y se cierra sola al salir.

## 0.9.8 — 15 de septiembre de 2026

- **La onda ahora lleva su cinta de niveles debajo.** Una tira fina con los tres
  —Tal cual · Ordenado · Estructurado— y el que está puesto en azul. Sirve para
  cambiarlo **de un clic justo antes de hablar**, que es el momento en que de
  verdad lo decides. Va en los dos estilos, el de caritas y el clásico.
- Se prende y se apaga desde **LABS**, en Inicio. Y se aprovecha mejor con la
  onda clavada, porque así está siempre a la vista.
- Los dos niveles con IA salen apagados si todavía no pusiste tu key de Groq.

## 0.9.7 — 15 de septiembre de 2026

- **LABS: ahora decides cuánto puede cambiar Dicho lo que dijiste.** En Inicio
  hay una sección verde nueva con tres escalones: **Tal cual** (tus palabras
  exactas, sin IA, al instante), **Ordenado** (el de siempre: quita muletillas y
  puntúa) y **Estructurado**, que es el nuevo — junta lo que dijiste disperso,
  tira los rodeos y saca listas si las hay.
- Estructurado es para cuando piensas en voz alta y la idea sale dando vueltas.
  Es el único que puede cambiarte las palabras, y **nunca puede añadir las que
  no dijiste**: si el resultado trae vocabulario que tú no usaste, Dicho lo
  descarta solo y escribe la versión limpia de siempre.
- Funciona con la key gratuita de Groq, la misma que ya usabas.

## 0.9.6 — 15 de septiembre de 2026

- **Al actualizar, Dicho te cuenta una película.** Para ese momento —y sólo para
  ése— la onda se vuelve una pantalla cuadrada y pasa esto: la carita sonríe, la
  cámara bascula y le mira la cabeza **desde arriba**, se abren dos compuertas,
  sale la pieza vieja carcomida, entra una nueva y dorada, **y el anillo se
  enciende**. Se cierran las compuertas, la cámara vuelve al frente, y arranca
  con los ojos en aspa y la lengua fuera mientras **la boca se le llena como una
  barra de carga**. Al terminar: sonrisa y **el número de la versión** que acaba
  de entrar.
- Sólo con las caritas puestas. En el estilo clásico no hay bicho que abrir.

## 0.9.5 — 15 de septiembre de 2026

- **Dicho celebra cuando lo actualizas.** Al primer arranque con una versión
  nueva, la onda sale una vez a festejarlo, con el número puesto en su
  pantallita. Cinco variantes al azar: le llega un **disquete** que desempolva y
  se mete por la ranura, le cambian el **cerebro** por uno rosa nuevecito, le
  llega una **playera** por paquetería, le ponen **pilas nuevas** y se le
  encienden los ojos, o directamente **evoluciona** como los tamagotchi de
  siempre, con fogonazo y chispas.
- Sólo sale al actualizar, nunca en una instalación nueva, y nunca si tienes la
  onda apagada.

## 0.9.4 — 15 de septiembre de 2026

- **Te avisa cuando hay versión nueva.** Sale una campanita verde en el botón de
  **Ajustes** del panel lateral, latiendo despacio. Verde y no roja a propósito:
  una versión nueva es una buena noticia, no una alarma.
- Y ahora Dicho **vuelve a mirar si hay novedades cada vez que traes la ventana
  al frente**. Antes sólo miraba al abrirla, así que con la ventana abierta de
  fondo podía no enterarse nunca.

## 0.9.3 — 15 de septiembre de 2026

- **Los dos botones de posición quedan juntos** en el menú de la onda: ahora el
  orden es clavar · devolverla a su sitio · cambiarla de sitio. Antes el de
  clavar se metía en medio y partía la pareja.

## 0.9.2 — 15 de septiembre de 2026

- **La onda ya no se te escapa.** Si le pasas el ratón por encima se queda a la
  vista aunque el dictado haya terminado, para que dé tiempo a abrir su menú. Se
  va sola al retirar el cursor.
- **Ahora sólo se mueve cuando tú lo dices.** Antes se arrastraba siempre, y era
  fácil desplazarla sin querer al ir a pulsar su menú. A partir de ahora hay que
  entrar en «cambiarla de sitio»: fuera de ahí, no se mueve.
- **El aro de colocación está vivo**: el punteado da la vuelta como hormiguitas y
  respira, en vez de parpadear.

## 0.9.1 — 15 de septiembre de 2026

- **El menú de la onda se abre en abanico.** Ahora es un **+** asomando por la
  esquina de arriba: al pulsarlo gira, se queda en **−** y suelta los tres
  botones uno detrás de otro hacia la izquierda. Al cerrarlo se pliegan dentro
  de él en orden inverso.
- **Ya no tapa la leyenda.** Estaba en medio de la cápsula y se comía el
  «Anotando…»; se subió a la esquina, donde no estorba a nada.
- **Los botones responden al ratón**: al pasar por encima crecen y se encienden,
  antes de pulsarlos.

## 0.9.0 — 15 de septiembre de 2026

- **Cancelar a media frase.** Si te arrepientes mientras dictas, pulsa
  **Escape** sin soltar el atajo: el audio se tira entero, no se transcribe ni se
  pega nada, y la carita te dice que no con la cabeza.
- **La onda se maneja desde la onda.** Pásale el ratón por encima y sale un botón
  de lápiz: desde ahí puedes **clavarla** —se queda siempre a la vista, el modo
  mascota— o **cambiarla de sitio**, y entonces los mismos botones se convierten
  en «listo» y «devolverla a su sitio». Ya no hay que ir a Ajustes para nada de
  esto.
- **Clavada y en reposo se pone translúcida**, para acompañar sin estorbar; al
  pasarle el ratón vuelve entera.
- **El mareo ahora se deja ver.** Cada carita da su vuelta completa antes de
  ceder el sitio, con un destello de relevo entre una y otra: zarandeando cinco
  segundos las recorres las tres con tiempo de mirarlas.
- **Y vomita en condiciones**: más chorro, un hilo que escurre de la comisura, un
  charco que se queda en el suelo y, al final, se limpia la boca con la manita.

## 0.8.5 — 15 de septiembre de 2026

- **Zarandea la onda mientras la colocas y se marea.** Ve a Inicio →
  «Seleccionar posición en pantalla», agárrala y muévela de lado a lado deprisa.
  A la primera se marea, a la segunda infla los carrillos aguantándose, y a la
  tercera… ya no aguanta.
- Tres caritas nuevas, hechas con la misma rejilla de siempre. No salen nunca
  dictando: son un premio por jugar.
- También se pueden ver con calma en Ajustes → «Ver las 26 caritas», al final.

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
