---
name: status
description: >-
  EL comando para retomar, espejo de /cierre. Lee el checkpoint del CLAUDE.md de este
  repo, lo contrasta con la realidad (rama, commits sin mezclar, pruebas, fechas) y
  da la brújula en máximo 6 líneas: dónde estamos, qué propone y por qué, y cualquier
  discrepancia. No toca nada hasta recibir autorización. Úsala cuando el usuario diga
  "status", "dónde estamos", "arrancamos", "ponme al día" o "qué sigue".
---

# Status — la brújula del día

**Éste es EL comando para retomar.** Se escribe `/status` al abrir la sesión, antes
de tocar nada, y contesta la única pregunta que importa a esa hora: *¿dónde nos
quedamos y qué sigue?* El que cierra el día es `/cierre`.

**Regla dura: hasta el punto 4, esto es SÓLO LECTURA.**

## 1 · Leer el checkpoint

En el `CLAUDE.md` de este repo, la sección `## Checkpoint`. De ahí, en este orden:

1. **`### Siguiente paso inmediato`** — es a lo que se viene.
2. **`### Estado`** — la tabla: versión, rama, pruebas, árbol, pendiente crítico.
3. **`### Pendientes que sólo puede hacer el usuario`** — si lo que sigue depende de
   uno de éstos, hay que decirlo antes de proponer nada.

Si el checkpoint no existe o le faltan títulos, el cierre anterior quedó a medias:
dilo en el resumen en vez de adivinar.

## 2 · Contrastar con la realidad

El acta puede mentir; la realidad manda:

```sh
git branch --show-current                    # ¿en qué rama arranca la sesión?
git status --short                           # ¿quedó algo suelto que el cierre no reportó?
git log --oneline -5                         # ¿el último commit coincide con lo que dice?
git fetch && git status -sb                  # ¿estamos atrás de origin? (el socio pudo empujar)
git rev-list --count main..HEAD 2>/dev/null  # commits esperando aprobación
```

**La rama es lo primero que se dice**, antes que nada: si hay trabajo esperando el OK
de Luis, quien retoma tiene que saberlo en la primera línea, no descubrirlo a media
mañana.

Si el repo tiene código, dos comprobaciones más — rápidas y **sin arreglar nada
todavía**:

```sh
grep '"version"' package.json   # ¿coincide con lo que dice el checkpoint?
npm test                        # ¿sigue en verde lo que el cierre dio por verde?
```

Y una comprobación de fechas: si el checkpoint tiene **más de dos semanas**, dilo. Un
checkpoint viejo es una mentira esperando.

## 3 · El resumen: SÚPER BREVE

Máximo ~6 líneas, formato fijo:

> **Dónde estamos:** una frase — con la rama y, si hay, los commits esperando OK.
> **Lo que propongo:** la acción concreta de hoy y **por qué esa y no otra** (casi
> siempre: el `### Siguiente paso inmediato` del checkpoint, o lo que un plazo está
> por vencer).
> **Ojo:** sólo si hay discrepancia entre el acta y la realidad, un plazo vencido, o
> algo que empujó el otro socio y cambia el plan.

Si hay 2–3 caminos razonables → preguntar con opciones y tu recomendación.

## 4 · Esperar autorización

"Sí", "dale", "arranca", "ese mismo" valen. **El silencio no.** No arranques "de una"
aunque el siguiente paso parezca obvio.

## 5 · Arrancar

Con autorización: rama antes de tocar el primer archivo (ver `/rama`), ejecutar,
verificar de verdad, y cerrar el día con `/cierre`.

## Qué NO hace este ritual

- No escribe el checkpoint (eso es de `/cierre`).
- No manda nada a clientes.
- No resuelve discrepancias por su cuenta: las reporta y propone.

---

## Lo propio de este repo

**El checkpoint del `CLAUDE.md` es todo lo que hay** — no hay bitácora aparte. Debajo,
`## Historial de sesiones` da la película de los días anteriores.

**Lo que hay que comprobar aquí antes de proponer nada**, porque es donde el acta
miente más fácil: qué versión está **instalada y corriendo** en la máquina de luisg
frente a la última publicada.

```powershell
$exe = "$env:LOCALAPPDATA\Dicho\mike.exe"; (Get-Item $exe).VersionInfo.FileVersion
@(Get-Process mike -ErrorAction SilentlyContinue).Count
Get-Content "$env:APPDATA\dev.mike.app\dicho.log" -Tail 20
```

Si hay actividad reciente en `dicho.log`, luisg está usando la app: **nada de scripts
que roben el foco** hasta preguntarle.
