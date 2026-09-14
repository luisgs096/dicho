---
name: cierre
description: >-
  EL ritual de cierre del día — es el único que hay, no busques otro. Escribe el
  checkpoint en el CLAUDE.md de ESTE repo, reparte lo aprendido donde toca, copia a
  la biblioteca cualquier skill que haya nacido hoy, y deja el terreno limpio con
  commit y push. Úsala cuando el usuario diga "cierre", "cerramos", "cierra el día",
  "haz el checkpoint", "deja el relevo" o "guarda el avance". El comando para
  RETOMAR al día siguiente es `/status`, no éste.
---

# Cierre — el checkpoint que leerá alguien sin memoria

Trabajas con instancias —y con un socio— que no comparten tu memoria. **Lo que no
quede escrito y empujado se pierde**, por bien que lo hayas explicado en el chat.

Un resumen en la conversación **no es un cierre**. Tampoco lo es apilar un párrafo
nuevo debajo del anterior: el checkpoint se **reescribe entero** cada vez.

## 1 · Reunir hechos, no recuerdos

Nunca escribas el checkpoint de memoria: la memoria del final de una sesión larga
está resumida y se equivoca justo en lo que más importa (números de versión, si algo
llegó a probarse). Sácalo del repo:

```sh
git log --oneline -15                        # qué se commiteó de verdad
git status --short                           # qué quedó suelto
git branch --show-current                    # en qué rama terminó la sesión
git rev-list --count main..HEAD 2>/dev/null  # commits sin mezclar a main
```

**La rama y los commits sin mezclar se dicen siempre.** Es lo primero que necesita
quien retome, y lo que más fácil se da por sabido.

Si el repo tiene código, la verificación es la batería completa y se pega **el
resultado real**, no un "todo bien":

```sh
npx tsc -b --noEmit   # las pruebas NO revisan tipos: esto va aparte
npm test              # cuántas pasan y cuántas se saltan, con su motivo
npm run build         # lo que rompe el despliegue se ve aquí, no en las pruebas
```

Si algo falla, el checkpoint lo dice. Si algo quedó a medias, dice **en qué punto
exacto** y qué se toca primero mañana.

## 2 · Escribir el checkpoint — en ESTE repo, con estos títulos

Va en el **`CLAUDE.md` de este repositorio**, en una sola sección que empieza con
`## Checkpoint`. La forma está en `plantillas/checkpoint.md`, aquí al lado.

Cada proyecto guarda **su propio** checkpoint, en su propia carpeta, y viaja en su
propio git. Nadie lo escribe desde fuera: BRÍO ADMIN lo lee para armar el mapa, pero
sólo lo escribe quien trabajó aquí.

Los siete títulos son un contrato que `status` y `/mapa` leen a ciegas. No se
renombran ni se omiten:

`### Estado` · `### Qué pasó en la última sesión` · `### Lo que funciona y está
probado` · `### Siguiente paso inmediato` · `### Lo que viene, por orden de valor` ·
`### Pendientes que sólo puede hacer el usuario` · `### Comprobar en dos minutos`

Fechas **siempre absolutas y con año**. Prohibido "como comentamos", "el bug de
antes" o "lo de ayer": no hay antes para quien lee mañana.

## 3 · Repartir lo aprendido donde toca

El checkpoint es **estado** (caduca cada día). El conocimiento va a su sitio:

- **Algo costó descubrir** (bug, trampa, dato no obvio) → el archivo de aprendizajes
  del repo, con *Qué pasó / Causa raíz / Regla que queda*. Ahí lo buscará quien
  vuelva a tropezar, no en el checkpoint de un día concreto.
- **Se tomó una decisión no obvia** → el archivo de decisiones: qué se decidió, por
  qué, y qué la cambiaría.
- **Cambió la arquitectura** (archivos nuevos, responsabilidades que se movieron) →
  el mapa del código del `CLAUDE.md`.

## 4 · Si hoy nació una skill, va a la biblioteca

**Una skill que sólo vive en su proyecto es una skill que nadie va a reutilizar.**

Si en esta sesión se creó o se cambió de fondo una skill, cópiala a la biblioteca de
la casa —`C:\dev\BRÍO ADMIN\03-operacion\skills\`— y anótala en su `README.md`:

- si sirve en cualquier repo → `casa/`, y se instala en todos;
- si es de este proyecto → `proyecto/<repo>/`, como referencia para el día que otro
  la necesite.

## 5 · Dejar el terreno limpio

- Todo commiteado, mensajes en español que expliquen el porqué.
- **`main` sólo si Luis lo autorizó en este turno** (ver `/rama`). Si no, la rama
  queda empujada y el checkpoint dice cuántos commits esperan su OK.
- `git status` limpio. Si algo no se pudo, no lo escondas: va al checkpoint con su
  motivo.

## 6 · Antes de dar por cerrado

Relee el checkpoint con una sola pregunta: **¿alguien que no estuvo aquí puede
arrancar mañana con esto y nada más?** Señales de que no está listo:

- "Como comentamos", "el bug de antes" → no hay antes.
- Fechas relativas.
- "Ya está arreglado" sin decir cómo se comprueba.
- Un pendiente sin dueño: hay que separar lo que puede hacer la siguiente instancia
  de lo que **sólo** puede hacer Luis.

Termina respondiéndole en 3–5 líneas: qué quedó hecho, qué sigue, qué necesitas de
él. Y recuérdale que mañana se arranca con **`/status`**.

## Qué NO hace este ritual

- No manda nada a clientes.
- No mergea a `main` sin autorización explícita.
- No inventa verificaciones: si no se corrió, se escribe "sin verificar".

---

## Lo propio de este repo

**Dicho** es una app de escritorio (Tauri + React + Rust) que luisg usa todos los
días. Eso manda sobre el cierre: aquí lo que se rompe, se rompe en su máquina.

**1 · El checkpoint vive en `CLAUDE.md` y es todo lo que hay.** No hay bitácora
aparte. Además del checkpoint, una línea en **`## Historial de sesiones`** al final del
archivo: la película de qué pasó cada día, con la versión que salió.

**2 · Una versión no está publicada hasta que la actualización funciona.**
No basta con que el release exista — un `.sig` que no corresponde rompe la
actualización **en silencio**. Antes de cerrar, las cuatro de la sección «Publicar y
actualizar»: que `latest.json` se descargue desde
`releases/latest/download/latest.json`, que vaya sin BOM, que su `signature` sea
idéntica al `.sig` local, y que el `.exe` coincida en **SHA256** con el firmado.

**3 · Lo que se verifica antes de decir que algo funciona.**

```sh
cargo test --lib          # las pruebas de Rust, con su número
npm run build             # el front
```

```powershell
$exe = "$env:LOCALAPPDATA\Dicho\mike.exe"; (Get-Item $exe).VersionInfo.FileVersion
Get-Content "$env:APPDATA\dev.mike.app\dicho.log" -Tail 20
```

Si la versión instalada no coincide con la publicada, eso va al checkpoint: es la
diferencia entre "salió" y "le llegó".

**4 · Cuidado al probar: luisg puede estar dictando.** Cualquier script que robe el
foco lo interrumpe. Mirar antes `dicho.log` para ver si hay actividad reciente. Lo que
no se pudo probar por eso se escribe como **no verificado**, no como hecho.
