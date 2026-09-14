<!-- EL CHECKPOINT DE LA CASA. Va en el CLAUDE.md del repo, en su propia carpeta, y
     se reescribe ENTERO en cada cierre — nunca se apila una versión debajo de otra.

     Los siete títulos son un contrato: `status` y `/mapa` los leen a ciegas. No se
     renombran ni se omiten. Si una sección no aplica, se escribe por qué. -->

## Checkpoint — <D de mes de AAAA>

### Estado

| | |
|---|---|
| Versión publicada / desplegada | dónde vive y qué versión hay ahí |
| Versión en uso | la que la gente está usando, si es distinta |
| Repo | rama actual, último commit, si está sincronizado, **y cuántos commits van sin mezclar a main** |
| Pruebas | el comando → el resultado real, no "todo bien" |
| Build | el comando → el resultado real |
| Árbol de trabajo | limpio, o qué quedó suelto y por qué |
| Pendiente crítico | el que duele si se olvida, y de quién es |

Dos o tres frases sobre en qué punto está esto de verdad: si está en uso diario, si
es un prototipo, qué se siente roto todavía.

### Qué pasó en la última sesión

Qué se hizo y por qué, en prosa corta. Si hubo un bug que costó, va con su causa
raíz — no basta "se arregló X".

### Lo que funciona y está probado

Lo que se puede afirmar sin cruzar los dedos, **con cómo se comprobó**. Lo que no se
verificó se escribe aparte y se dice que no se verificó.

### Siguiente paso inmediato

UNA acción concreta, con archivo o comando. "Purgar el historial de `mike.db`: no hay
borrado por antigüedad ni tope de tamaño; empezar por `store.rs`" sirve. "Seguir con
el historial" no.

### Lo que viene, por orden de valor

Tres o cuatro, en el orden en que conviene hacerlas, con una línea de por qué.

### Pendientes que sólo puede hacer el usuario

Comprar, firmar, crear una cuenta, conseguir una llave, decidir un diseño, probar con
su propia voz o sus propias pantallas. Si se mezclan con los tuyos, nadie los hace.

### Comprobar en dos minutos

Los comandos exactos que dicen si esto sigue en pie, para pegarlos y correrlos:

```sh
git status --short
# pruebas, build, y lo que haga falta en este repo
```
