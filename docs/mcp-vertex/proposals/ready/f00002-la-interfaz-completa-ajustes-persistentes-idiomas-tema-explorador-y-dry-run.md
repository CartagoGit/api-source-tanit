---
id: f00002
title: "La interfaz completa: ajustes persistentes, idiomas, tema, explorador y dry run"
kind: feat
status: ready
type: proposal
track: export-to-postman
date: 2026-08-11
---

> **S1 entregada.** Los quince idiomas viven cada uno en su fichero y se
> cargan de dos sitios a la vez: empaquetados con la aplicacion **y**
> leidos de una carpeta del usuario. No es redundancia — el binario
> compilado no tiene sistema de ficheros, asi que solo con ficheros el
> `.deb` se quedaria mudo, y solo con empaquetados no se podria añadir
> uno sin recompilar.
>
> Un idioma externo **gana** al empaquetado del mismo codigo: quien deja
> un `es.json` quiere corregir el que viene, no que se le ignore.
>
> El respaldo es clave a clave, no catalogo a catalogo: un idioma al 80 %
> enseña el 80 % traducido y el resto en ingles, nunca la clave cruda.
>
> Y el gate de contratos me caz&oacute; en el acto: `pickLocale` era una
> **funcion** dentro de `projects/contracts/`, que promete no tener
> implementacion. Movida al servicio.
>
> 22 tests, incluido el de sincronia entre la carpeta de idiomas y la
> lista que el servicio enumera a mano — que tiene que enumerar, para que
> el empaquetador los vea, y por eso puede separarse.

# f00002 — La interfaz completa: ajustes persistentes, idiomas, tema, explorador y dry run

## Goal

Que la interfaz deje de ser una pantalla de una sola pregunta y pase a ser la forma completa de usar el proyecto sin terminal: ajustes que sobreviven al cierre, quince idiomas cargados de ficheros y ampliables sin tocar el codigo, tema por variables, eleccion de formato y framework, explorador de carpetas para origen y destino, y un ensayo que enseña lo que va a pasar antes de escribir nada.

## why

La interfaz de hoy hace **una** cosa: pides una carpeta, inspeccionas, generas. Todo lo demas —el formato de salida, forzar el framework, elegir donde escribir— existe en el CLI y no llega a quien no abre una terminal, que es justamente para quien se hizo la interfaz.

Lo que falta, medido contra lo que el CLI ya sabe hacer:

- **Formato**: el CLI acepta seis (`postman`, `openapi`, `insomnia`, `bruno`, `har`, `curl`). La interfaz genera siempre Postman.
- **Framework a la fuerza**: `--framework` existe porque la autodeteccion **no puede** acertar en un monorepo o con una dependencia con alias. Sin el, la interfaz deja a esa persona en un callejon.
- **Carpeta de destino**: `--output-dir` existe; la interfaz escribe siempre en `<proyecto>/export-to-postman/`.
- **Escribir la ruta a mano** es la unica forma de elegir carpeta, y es donde mas se falla: una ruta con una errata devuelve «no existe» y no hay pista de donde estabas.
- **No hay ensayo**: la unica manera de saber que va a salir es generarlo.

Y hay dos cosas que no existen en ninguna parte y son de producto:

- **Idioma.** Toda la salida esta en ingles por decision (`r00003`), pero eso vale para una terminal; una interfaz grafica que solo habla ingles excluye a quien no lo lee. Deben ser ficheros por idioma, no un `switch`: asi se añade uno sin tocar codigo, que es lo que pides.
- **Ajustes que persistan.** Hoy cada apertura empieza de cero.

## Lo que se ha comprobado antes de proponer

Se genero con los seis formatos y se miro lo que sale:

- La coleccion declara `schema: .../v2.1.0/collection.json` y trae `_postman_id`, que es lo que hace que reimportar **actualice** en vez de duplicar. Se verifico ademas que el id sobrevive a renombrar la carpeta del proyecto.
- **De los seis formatos, cinco los importa Postman** (`postman`, `openapi`, `insomnia`, `har`, `curl`); `bruno` no —es para Bruno—. La interfaz no puede ofrecerlos todos como si fueran equivalentes.
- **El OpenAPI que emitimos declara `3.1.0`**, y el importador de Postman ha sido irregular con 3.1 frente a 3.0. Hay que comprobarlo importando de verdad, no leyendo la documentacion.

## La restriccion que condiciona el diseño

Los idiomas «cargados desde carpetas» chocan con que el binario compilado **no tiene sistema de ficheros**: la pagina se sirve desde memoria (`UI_HTML`) justamente por eso. La solucion no es elegir una de las dos: los quince idiomas van empaquetados, y ademas se leen los de una carpeta del usuario si existe. En `.deb`/`.dmg`/`.msi` esa carpeta es la de configuracion del sistema; en desarrollo, una del repo.

## non-goals

- Un framework de frontend: la pagina es HTML y JS sin dependencias a proposito, porque va dentro del binario y la CSP prohibe cargar nada de fuera
- Traducir la salida del CLI: `r00003` decidio que la terminal habla ingles y eso no cambia. Lo que se traduce es la interfaz grafica
- Sincronizar ajustes entre maquinas: el fichero es local
- Reemplazar el CLI: la interfaz llama al mismo pipeline, no reimplementa nada

## Slices

- global_gate: e2e

### S1 — Los quince idiomas, en ficheros, con el del sistema por defecto
- **Status**: done
- **Files**: `projects/contracts/constants/cli/locales.constant.ts`, `projects/contracts/interfaces/cli/i18n.interface.ts`, `projects/ui/i18n/locales/`, `projects/ui/i18n/i18n.service.ts`, `tests/cli/i18n.spec.ts`
- **Gate**: type
- acceptance:
  - "Los quince idiomas mas hablados viven cada uno en su fichero, no en un `switch`"
  - "El idioma por defecto sale del navegador o del sistema; si no esta entre los que hay, ingles"
  - "Una clave que falte en un idioma cae al ingles en vez de enseñar la clave cruda, y el test lo comprueba"
  - "Un idioma de mas en una carpeta externa se carga sin tocar codigo: es el caso `plugin` que se pide"
  - "Los quince van **empaquetados** ademas de leerse de disco: el binario compilado no tiene sistema de ficheros"

### S2 — El estilo, en variables, para que cambiar el tema sea cambiar valores
- **Status**: pending
- **Files**: `projects/ui/web/theme.constant.ts`, `tests/cli/theme.spec.ts`
- **Gate**: type
- acceptance:
  - "Ni un color escrito a pelo en la pagina: todo sale de variables CSS"
  - "Cambiar de tema cambia **solo** los valores de las variables, no reglas"
  - "Hay al menos claro y oscuro, y el de por defecto respeta `prefers-color-scheme`"
  - "Un test falla si aparece un color literal fuera del bloque de variables"

### S3 — Los ajustes sobreviven al cierre, y en escritorio son un fichero externo
- **Status**: pending
- **Files**: `projects/contracts/interfaces/cli/settings.interface.ts`, `projects/ui/settings/settings.service.ts`, `tests/cli/settings.spec.ts`
- **Gate**: type
- acceptance:
  - "Al reabrir la interfaz vuelve la ultima configuracion guardada"
  - "En escritorio es un fichero externo en la carpeta de configuracion del sistema, no dentro del paquete: un `.deb` reinstalado no puede borrar los ajustes de nadie"
  - "En navegador se guarda en el equipo sin cookies —que un tercero puede disparar—"
  - "Un fichero de ajustes corrupto o de una version vieja no impide arrancar: se dice y se usan los valores por defecto"

### S4 — La tuerca y la pantalla de ajustes
- **Status**: pending
- **DependsOn**: [S1, S2, S3]
- **Files**: `projects/ui/web/index.html.constant.ts`
- **Gate**: e2e
- acceptance:
  - "Un icono de tuerca lleva a ajustes y se vuelve sin perder lo que hubiera puesto"
  - "Desde ahi se elige idioma y tema, y el cambio se ve al momento sin recargar"
  - "Lo elegido se guarda solo: no hay boton de guardar que se pueda olvidar"
  - "La pantalla es navegable con teclado y los controles tienen etiqueta: una interfaz que solo funciona con raton excluye a quien no lo usa"

### S5 — Formato, framework y destino: lo que el CLI sabe y la interfaz no ofrecia
- **Status**: pending
- **Files**: `projects/ui/server/ui-routes.service.ts`, `tests/cli/ui-routes.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Se elige el formato de salida, con Postman por defecto"
  - "Los formatos que Postman **no** importa —`bruno`— se distinguen de los que si: ofrecerlos como equivalentes engaña"
  - "Se puede forzar el framework en vez de depender de la autodeteccion, con la lista que sale del catalogo"
  - "Se elige la carpeta de destino, y una fuera del proyecto se acepta —es un uso legitimo— pero se dice donde va a escribir"

### S6 — Elegir carpeta explorando, no escribiendo
- **Status**: pending
- **Files**: `projects/ui/server/browse.service.ts`, `tests/cli/browse.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Se navega el arbol de directorios desde la interfaz, para origen y para destino"
  - "Un directorio sin permiso de lectura se dice y no rompe la navegacion"
  - "No se listan ficheros: lo que se elige son carpetas, y enseñar miles de ficheros hace la lista inutil"
  - "La navegacion **no** puede convertirse en un lector de ficheros arbitrario: se devuelven nombres de directorio, nunca contenido"

### S7 — El ensayo: ver lo que va a pasar antes de escribir
- **Status**: pending
- **Files**: `projects/ui/server/dry-run.service.ts`, `tests/cli/dry-run.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Enseña exactamente que ficheros se crearian y con que nombre, sin crear ninguno"
  - "Avisa de lo que se iba a **sobrescribir**, que es lo que de verdad asusta"
  - "Un ensayo seguido de una generacion real produce lo que el ensayo dijo, y un test lo compara"

### S8 — Importar de verdad en Postman, y documentarlo
- **Status**: pending
- **DependsOn**: [S5]
- **Files**: `docs/POSTMAN.md`, `docs/UI.md`
- **Gate**: none
- acceptance:
  - "Queda escrito, formato por formato, cual importa Postman y por que camino de su interfaz"
  - "Se resuelve empiricamente si el importador acepta el OpenAPI **3.1** que emitimos, o si hay que bajar a 3.0"
  - "Lo que no importe se dice en la propia interfaz, no solo en la documentacion"
  - "`docs/UI.md` explica la pantalla entera: ajustes, idiomas, tema, explorador y ensayo"

## acceptance

- Los quince idiomas mas hablados viven cada uno en su fichero, no en un `switch`
- El idioma por defecto sale del navegador o del sistema; si no esta entre los que hay, ingles
- Una clave que falte en un idioma cae al ingles en vez de enseñar la clave cruda, y el test lo comprueba
- Un idioma de mas en una carpeta externa se carga sin tocar codigo: es el caso `plugin` que se pide
- Los quince van **empaquetados** ademas de leerse de disco: el binario compilado no tiene sistema de ficheros
- Ni un color escrito a pelo en la pagina: todo sale de variables CSS
- Cambiar de tema cambia **solo** los valores de las variables, no reglas
- Hay al menos claro y oscuro, y el de por defecto respeta `prefers-color-scheme`
- Un test falla si aparece un color literal fuera del bloque de variables
- Al reabrir la interfaz vuelve la ultima configuracion guardada
- En escritorio es un fichero externo en la carpeta de configuracion del sistema, no dentro del paquete: un `.deb` reinstalado no puede borrar los ajustes de nadie
- En navegador se guarda en el equipo sin cookies —que un tercero puede disparar—
- Un fichero de ajustes corrupto o de una version vieja no impide arrancar: se dice y se usan los valores por defecto
- Un icono de tuerca lleva a ajustes y se vuelve sin perder lo que hubiera puesto
- Desde ahi se elige idioma y tema, y el cambio se ve al momento sin recargar
- Lo elegido se guarda solo: no hay boton de guardar que se pueda olvidar
- La pantalla es navegable con teclado y los controles tienen etiqueta: una interfaz que solo funciona con raton excluye a quien no lo usa
- Se elige el formato de salida, con Postman por defecto
- Los formatos que Postman **no** importa —`bruno`— se distinguen de los que si: ofrecerlos como equivalentes engaña
- Se puede forzar el framework en vez de depender de la autodeteccion, con la lista que sale del catalogo
- Se elige la carpeta de destino, y una fuera del proyecto se acepta —es un uso legitimo— pero se dice donde va a escribir
- Se navega el arbol de directorios desde la interfaz, para origen y para destino
- Un directorio sin permiso de lectura se dice y no rompe la navegacion
- No se listan ficheros: lo que se elige son carpetas, y enseñar miles de ficheros hace la lista inutil
- La navegacion **no** puede convertirse en un lector de ficheros arbitrario: se devuelven nombres de directorio, nunca contenido
- Enseña exactamente que ficheros se crearian y con que nombre, sin crear ninguno
- Avisa de lo que se iba a **sobrescribir**, que es lo que de verdad asusta
- Un ensayo seguido de una generacion real produce lo que el ensayo dijo, y un test lo compara
- Queda escrito, formato por formato, cual importa Postman y por que camino de su interfaz
- Se resuelve empiricamente si el importador acepta el OpenAPI **3.1** que emitimos, o si hay que bajar a 3.0
- Lo que no importe se dice en la propia interfaz, no solo en la documentacion
- `docs/UI.md` explica la pantalla entera: ajustes, idiomas, tema, explorador y ensayo
