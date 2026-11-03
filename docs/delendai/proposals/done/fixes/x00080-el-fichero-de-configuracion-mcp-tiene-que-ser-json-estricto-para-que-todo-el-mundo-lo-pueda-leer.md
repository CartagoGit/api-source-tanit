---
id: x00080
title: "el fichero de configuracion MCP tiene que ser JSON estricto para que todo el mundo lo pueda leer"
kind: fix
status: done
type: proposal
track: general
date: 2026-11-02
last-transition-id: 567ca2ab-1cec-413c-86af-db4a15c8a5fe
last-correlation-id: 567ca2ab-1cec-413c-86af-db4a15c8a5fe
last-transition-from: review
last-transition-at: 2026-11-03T06:39:44.656Z
# x00080 — el fichero de configuracion MCP tiene que ser JSON estricto para que todo el mundo lo pueda leer

## goal

Que `.vscode/mcp.json` sea **JSON estricto**: que lo pueda leer cualquier
programa que use `JSON.parse`, no sólo los que saben de comentarios.

## why

El generador (`scripts/gates/sync-mcp-config.script.ts`) escribe el
fichero con dos líneas de comentario `//` delante. La razón que dejó
escrita es que *".vscode/mcp.json sí admite comentarios"* — y es
cierto: VS Code lo acepta.

El problema es que **no sólo lo lee VS Code**. Delendai también lo
lee, al arrancar, para migrar la configuración del host. Y esa lectura
es con `JSON.parse` en las versiones que hay por ahí. El resultado es
el arranque repetido que aparece en el log:

```
boot failed: HostConfigParseError: host config
  /…/api-source-tanit/.vscode/mcp.json is not valid JSON:
  JSON Parse error: Unrecognized token '/'
the server exited (code 1); starting it again.
```

Y el bucle se repite: cada reinicio vuelve a fallar por lo mismo.
El síntoma que ve el usuario no es "el servidor MCP no arranca", sino
*"MPC -32000: The delendai server stopped while handling this request;
it has been started again"*, sin decir qué lo paró.

Lo grave no es el ruido: es que **el fallo es invisible para quien
programa**. El fichero se ve bien en el editor, VS Code lo acepta, y
`lint:mcp` lo daba por bueno porque comparaba el contenido con el
esperado — y el esperado **tenía los comentarios**. El gate comprobaba
que el fichero fuera como se genera; no comprobaba que se pudiera
leer.

Y hay una asimetría que lo hace peor: el mismo repo genera el fichero
para dos consumidores con capacidades distintas, y usa el formato del
más permisivo para los dos. JSON estricto es un subconjunto de JSONC:
un fichero sin comentarios lo lee **todo** el mundo. Un fichero con
comentarios solo lo leen los que los saben quitar.

## non-goals

- **No** se cambia el formato de `.mcp.json` (Claude Code) ni el
  contenido de ninguno de los dos ficheros: sólo la serialización
  del derivado.
- **No** se añade una clave como `$schema` para dejar el aviso dentro
  del fichero: una clave que el esquema no conoce sale marcada en el
  panel de problemas de VS Code, y el runtime del host avisa de
  claves no reconocidas. El aviso vive en la documentación y en el
  mensaje del gate.

## slices

- global_gate: type

### S1 — el fichero es JSON estricto y el gate lo vigila
- **Status**: done
- **Files**: `scripts/gates/sync-mcp-config.script.ts`, `.vscode/mcp.json`, `tests/scripts-gates/lint-mcp-config.spec.ts`, `CONTRIBUTING.md`
- **Gate**: type
- acceptance:
  - "`.vscode/mcp.json` no tiene comentarios: se genera con `JSON.stringify` y nada más, y el fichero que hay en disco se regenera así."
  - "El fichero parsea con `JSON.parse` estricto — no con un parser que sepa quitar comentarios."
  - "`lint:mcp` dice **por qué** falla cuando el fichero no parsea en estricto, y no sólo que no coincide con `.mcp.json`."
  - "Hay un test que ata el invariante: los dos ficheros de configuración MCP parsean con `JSON.parse`."
  - "El aviso de «no lo edites a mano» sigue llegando al que abra el fichero: en `CONTRIBUTING.md` y en el mensaje de `lint:mcp`."
- shipped-in: `259ba3c76cd3`
- review-state: done
- review-implementer: minimax-m3.1-flash
- review-reviewer: minimax-m3.1-flash-preview
- review-log: approved by minimax-m3.1-flash-preview — verified at 259ba3c76cd3, validate exit 0 and tests 7/7 claimed, no recorded run cited; acceptance 5/5: (1) scripts/gates/sync-mcp-config.script.ts genera .vscode/mcp.json con JSON.stringify y nada más; el fichero del disco es ese mismo JSON, sin comentarios, y JSON.… (2) El fichero del disco es JSON estricto: tests/scripts-gates/lint-mcp-config.spec.ts lo parafilea con JSON.parse, no con un parser que sepa quitar comentarios. (3) El mensaje de lint:mcp nombra el motivo del parseo estricto y el fichero que no cuadra, no sólo que los dos difieren. (4) tests/scripts-gates/lint-mcp-config.spec.ts ata el invariante: los dos ficheros parsean con JSON.parse. 7/7 en verde. (5) El aviso sigue en CONTRIBUTING.md y en el mensaje de lint:mcp. — Revisión independiente de la entrega 259ba3c7 (el fichero de configuracion MCP tiene que ser JSON estricto), entregada por minimax-m3.1-flash. Ejecuté los specs del gate: tests/scripts-gates/lint-mcp-config.spec.ts da 7/7 en verde, y lint:mcp pasa.

## acceptance

- `bun run lint:mcp` pasa, y el fichero que vigila se puede leer con
  `JSON.parse`.
- Un `.vscode/mcp.json` con un comentario delante hace fallar
  `lint:mcp` con un motivo que nombra el comentario, no «no coincide».
- El arranque del servidor MCP no vuelve a depender de qué versión
  del runtime sepa leer comentarios.
shippedIn: [1ae1577b]
