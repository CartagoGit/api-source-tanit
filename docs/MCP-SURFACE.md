# Qué es un tool MCP y qué no, en este proyecto

> Decisión de `x00001` S4. Vive en `docs/` y no en `proposals/`
> porque **no es una propuesta**: no hay nada que ejecutar, es el
> criterio con el que se decide. `lint:proposals` lo dijo antes que
> yo — exige `<kind><NNNNN>-<slug>.md` para todo lo que viva ahí.

La superficie MCP creció por intuición: cuatro tools al principio, luego
seis, luego diez. Cada uno se añadió porque «hacía falta», y eso funciona
hasta que alguien se pregunta por qué `watch` no está y `stats` sí.

Este documento fija el criterio para que la respuesta no dependa de quién
lo mire.

## El criterio

Un comando merece ser tool cuando cumple **las tres**:

1. **Su resultado es un dato, no una pantalla.** Un agente tiene que
   poder actuar sobre lo que devuelve sin leerlo como prosa.
2. **Termina.** Empieza, hace algo y devuelve. Un proceso que se queda
   vivo no encaja en un ciclo petición-respuesta.
3. **Sus efectos son declarables.** Se puede decir de antemano si lee,
   escribe, sale a la red o lanza procesos, y el host decide con eso si
   pide confirmación.

## Los diez que sí

| Tool | Efectos | Por qué |
|---|---|---|
| `generate` | `write` | Es el producto. Devuelve rutas, cifras y avisos. |
| `init` | `write` | Escribe una configuración **válida** sin que el agente tenga que inventarse la forma de `ProjectConfig`. |
| `push` | `network`, `write` | Publica en Postman. Devuelve qué se creó o actualizó, con su UID. |
| `scan` | — | Qué ve el discovery, antes de generar nada. La respuesta a «¿por qué no encuentra mis rutas?». |
| `summary` | — | El proyecto ya interpretado, sin escribir. |
| `check` | — | ¿Se ha desincronizado la colección del código? Con las dos listas de deriva. |
| `list` | — | Los endpoints de la colección, en datos. |
| `stats` | — | El tamaño y la forma, para dimensionar sin leerse el JSON. |
| `validate` | — | Si la colección cumple el esquema de Postman. |
| `test` | `spawn` | Ejecuta la suite y devuelve pasos con su resultado. |

## Los que no, y por qué

### `watch` — no termina

Se queda vivo vigilando el árbol. Un tool que no devuelve no encaja en
petición-respuesta: el host se quedaría esperando, y el agente no tiene
forma de recibir «ha cambiado un fichero» tres minutos después.

Además ya mordió por otro lado: lanzado desde `/tmp` recorrió el
directorio, encontró un proyecto suelto entre los temporales y generó su
colección. Eso, disparado por un agente sobre una raíz mal resuelta, es
un proceso vigilando el disco de alguien sin que nadie lo haya pedido.

**Alternativa para un agente:** invocar `check` cuando quiera saber si
hay deriva. Es la misma pregunta, contestada cuando se hace.

### `open` — su resultado es una ventana

Abre Postman en el navegador. No devuelve datos: el resultado es que
aparece una aplicación en la pantalla de alguien. Un agente que lo
invocara no podría comprobar si funcionó, y quien esté delante recibiría
una ventana que no ha pedido.

**Alternativa:** `generate` ya devuelve `collectionPath`. Enseñar la ruta
es información; abrir una ventana es una interrupción.

### El asistente interactivo — pregunta

Vive en `projects/ui/interactive.script.ts` y funciona a base de
preguntas encadenadas. Un tool MCP no tiene con quién dialogar.

**Alternativa:** los tools que ya existen. El asistente es un envoltorio
sobre ellos para quien está en una terminal.

### La interfaz web (`ui`) — levanta un servidor

Mismo caso que `watch`: abre un puerto y se queda. Y encima con una
página que espera un navegador delante.

## Qué hacer al añadir un comando

Pasarlo por las tres condiciones. Si las cumple, tiene tool y el gate
`lint:mcp-surface` exige que declare `inputSchema` y `outputSchema`. Si
no las cumple, **este documento gana una fila** explicando cuál falla y
qué se ofrece en su lugar.

Lo que no vale es dejarlo sin decidir: un comando sin tool y sin
explicación es indistinguible de un olvido, y eso es justo lo que pasaba
con `check`, que llevaba desde el principio en el CLI sin que nadie
supiera por qué no estaba expuesto.
