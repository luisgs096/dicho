---
name: rama
description: >-
  Regla no negociable de la casa — todo cambio se construye en una rama y `main` NO
  se toca hasta que Luis diga explícitamente que está aprobado. Úsala al empezar
  CUALQUIER encargo que modifique archivos, cuando Luis diga "cambios", "ajustes",
  "modifica", "arregla", "agrega", y antes de cualquier commit, push, merge o
  despliegue. También cuando haya duda sobre si algo puede ir a main.
---

# /rama — main no se toca hasta que Luis lo apruebe

Regla dictada por Luis el **27 de agosto de 2026**, después de una sesión que salió
bien precisamente porque **no** se mergeó sin su visto bueno. Vale en todos los
repos de la casa, no sólo en el que la vio nacer.

## La regla, en una línea

**Todo se construye en una rama. `main` no se altera hasta que Luis diga que los
cambios están aprobados.** No hay excepciones por tamaño: un cambio de una palabra
va en rama igual que un sistema nuevo.

Por qué: en casi todos los repos, `main` es lo que se publica. Mergear es
**publicar**. Esa decisión es de Luis, no de Claude — aunque el trabajo esté
verificado, aunque el plan ya estuviera aprobado, aunque Luis haya aprobado el plan
que *menciona* el merge. **Aprobar un plan no es aprobar el resultado.**

## Al empezar cualquier encargo

1. `git status` — si hay trabajo sin commitear, resolverlo antes de empezar.
2. Si estás en `main`, **crear rama antes de tocar un solo archivo**:
   `git checkout -b luis/<tarea-corta>` (en español y concreta: `luis/popup-biografia`).
3. Si ya existe una rama abierta para este encargo, seguir en ella: el PR se
   actualiza solo con cada push.

## Durante el trabajo

- Commits en español, con mensajes que expliquen **el porqué**, no sólo el qué.
- Se commitea cuando algo **funciona y está verificado**, no a medias.
- Los archivos generados (bundles, builds, PDFs) van en su **propio commit**,
  separados de la fuente: así el diff de la fuente se puede leer.

## Al terminar

1. `git push -u origin <rama>`.
2. Abrir el PR contra `main` con `gh pr create`, cuerpo en español: qué se hizo, qué
   se midió y qué queda pendiente.
3. **DETENERSE AQUÍ.** Decirle a Luis: el enlace del PR, cómo probarlo él mismo, y
   que el merge queda a su decisión.
4. **NO** ejecutar `gh pr merge`, `git merge`, `git push origin main` ni nada que
   altere `main`.

## Cuándo SÍ se puede mergear

Sólo cuando Luis lo diga con todas sus letras **en el turno actual**: "mergea",
"apruébalo", "súbelo a main", "ya quedó, publícalo". Frases como "está bien", "me
gusta" o "sigue" **no** son autorización de merge — son comentarios sobre el trabajo.
Ante la duda, preguntar.

Una autorización sirve **una vez**. Que Luis haya aprobado el merge ayer no autoriza
el de hoy.

## Cómo mergear cuando toca

Con **merge commit**, no con *squash*, siempre que la rama tenga **etiquetas**
apuntando a sus commits (las de una versión publicada, típicamente). Aplastarlos crea
commits nuevos: las etiquetas se quedan señalando a los viejos, que dejan de ser
antepasados de `main`, y la historia pierde el hilo entre «esta versión salió» y «este
código la produjo».

```sh
gh pr merge <n> --merge --delete-branch
```

Y después, comprobarlo en vez de suponerlo:

```sh
git checkout main && git pull --ff-only
git merge-base --is-ancestor <tag>^{commit} main && echo "la etiqueta quedó dentro"
```

Sin etiquetas de por medio, *squash* está bien y deja la historia más limpia.

## Relación con /cierre

`/cierre` documenta y deja el PR listo, pero **el merge de ese ritual también espera
el visto bueno de Luis**. Si al cerrar el día hay un PR sin aprobar, se deja abierto
y se anota en el checkpoint como pendiente de él. Un PR abierto esperando revisión no
es trabajo invisible: es trabajo esperando a su dueño.

## La excepción, y es una sola

En **BRÍO ADMIN** —el repo del negocio, donde no hay producción que romper— las
ediciones chicas de documentos van directo a `main` (DECISIÓN #20). El código de
cliente y cualquier cosa que se publique, no: ésos siguen la regla completa.

---

## Lo propio de este repo

Aquí `main` es un repo **público**, y lo que se publica de verdad son las **releases
firmadas** de GitHub: el updater de la app las consulta y se instala solo. Por eso
publicar no es mergear — es `gh release create` con el instalador, su `.sig` y
`latest.json`.

- Las pruebas (`cargo test --lib`) pasan **antes** del commit, no después.
- Los binarios y el instalador **no van al repo**: viajan en la release.
- Una release mal firmada rompe la actualización de todos en silencio, así que la
  decisión de publicar es de luisg igual que un merge.
