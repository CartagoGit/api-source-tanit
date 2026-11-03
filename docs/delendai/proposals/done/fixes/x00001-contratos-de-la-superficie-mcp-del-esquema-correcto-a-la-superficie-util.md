---
id: x00001
title: "Contratos de la superficie MCP: del esquema correcto a la superficie util"
kind: fix
status: done
type: proposal
track: export-to-postman
date: 2026-08-08
shippedIn:
  - 2f5fe5f  # cierre administrativo (x00032 S1 regla 2): SHA de creación del registro
---

> **Parcial a 2026-08-08.** S1 y S2 entregados: los cuatro tools
> declaran `outputSchema` y `lint:mcp-surface` lo exige. Al obligar al
> contrato salieron dos bugs más — `summary` declaraba 6 campos y
> devolvía 18, y `validate` reportaba una colección desincronizada como
> *fallo de herramienta*.
>
> **S2 cerrada a 2026-08-08.** Los cuatro tools de solo lectura están:
> `check`, `list`, `stats` y `scan`. Ocho tools para doce comandos.
>
> `stats` y `scan` no eran mecánicos. Al ir a envolver `scan` salió que
> **cuatro de los doce comandos** —`init`, `open`, `summary` y `scan`—
> llamaban a `process.exit(await main())` en el cuerpo del módulo, sin
> guard: importarlos lanzaba el comando y mataba el proceso. Para un
> servidor MCP de vida larga eso es el servidor entero cayéndose al
> registrar el tool. `lint:command-coverage` ahora lo exige, y se
> verificó reintroduciendo el fallo a propósito.
>
> Los dos comandos se ejecutaron antes de envolverlos, que es lo que
> destapó que `list` no listaba nada. Esta vez los dos funcionaban.
>
> **S1 cerrada.** `output-contract.spec.ts` confronta lo que cada tool
> devuelve con lo que cada tool **declara**, y saca el esquema del
> registro del propio tool (`captureTool`), no de un import: comparar
> contra una copia escrita en el test no comprobaría nada, porque las
> dos copias se separarían juntas.
>
> Comprueba las **dos** direcciones, que son fallos distintos. Faltan
> campos → un agente lee `undefined` donde el contrato prometía un
> valor; lo caza el `safeParse`. Sobran campos → el tool devuelve datos
> que su contrato no describe, y zod los descarta en silencio, así que
> hay que comparar las claves a mano. Las dos verificadas metiendo el
> fallo.
>
> `test` queda fuera con su motivo escrito: ejecuta la suite del
> proyecto, e invocarlo desde dentro de la suite es una bomba de
> bifurcación.
>
> **S3 y S4 cerradas, y con ellas la propuesta.** Diez tools.
>
> De `push`, lo que importa no es el tool sino las tres puertas por las
> que la clave podría salir: el input no la acepta (`.strict()`, así que
> pasarla es inválido, no ignorada), la salida feliz no la lleva, y el
> **error** tampoco — que es la que se olvida, porque
> `PostmanApiError.detail` es el cuerpo de Postman y puede traer la
> petición con su cabecera dentro. Verificado metiendo la clave en el
> `reason` a propósito.
>
> De `init`, lo que importa es que se midió antes de envolverlo: generar
> con su config y sin ella da **exactamente lo mismo**. O sea que `init`
> no hace falta para que la herramienta funcione, y el tool se justifica
> por lo otro —personalizar sin inventarse la forma de `ProjectConfig`—.
> Eso está escrito en el propio tool, no vendido como si fuera esencial.
>
> Y escribir su test destapó un bug: la traza que el CLI imprime antes de
> escanear anunciaba `<carpeta>.postman_collection.json` mientras
> escribía `<proyecto>.postman_collection.json` tres líneas más abajo.
> Esa línea existe justamente para descartar que estés mirando la carpeta
> equivocada, y mentía.
>
> S4 vive en `docs/MCP-SURFACE.md` y no en `proposals/`: no es una
> propuesta, es el criterio con el que se decide. `lint:proposals` lo
> dijo antes que yo.

# x00001 — Contratos de la superficie MCP: del esquema correcto a la superficie útil

## Goal

Que la superficie que este proyecto expone a otros agentes tenga contrato de entrada y de salida, pruebas integradas del contrato que hoy ya existe, y una amplitud de tools suficiente para que el MCP sirva de verdad como puerta de entrada al producto.

## why

Hallazgo 18 (MINOR) de a00001, más la recalibración de la auditoría 2026-08-08. El árbol actual ya no está donde nació esta propuesta: los cuatro tools del plugin sí declaran `outputSchema`, `lint:mcp-surface` existe y hoy pasa, y `tests/cli/mcp-surface.spec.ts` ya verifica una parte del contrato. Eso es una buena noticia, pero deja al descubierto la deuda que ahora sí es la principal: la superficie MCP sigue siendo estrecha para lo que el producto sabe hacer. Un agente puede generar, resumir, validar y testear; no puede pedir `check`, `list`, `stats`, `scan`, `push` o `init` en datos estructurados. Y lo ya resuelto aún no tiene la prueba integrada que demuestre que lo registrado en el plugin valida de verdad contra los esquemas en ejecución, no solo como texto en un fichero.

## non-goals

- Cambiar los nombres cualificados de los tools: son la superficie pública que despacha el host
- Reimplementar los comandos en el plugin: los tools spawnean el CLI, que es la única fuente de verdad

## Slices

- global_gate: type

### S1 — Prueba integrada del contrato que el árbol actual ya declara
- **Status**: done
- **Files**: `packages/plugins/delendai_expostman/tests/integration/generate.tool.spec.ts`, `packages/plugins/delendai_expostman/tests/integration/summary.tool.spec.ts`, `packages/plugins/delendai_expostman/tests/integration/validate.tool.spec.ts`, `packages/plugins/delendai_expostman/tests/integration/test.tool.spec.ts`
- **Gate**: plugin
- acceptance:
  - "El plugin arranca y los 4 tools responden con una salida que valida contra su propio esquema"
  - "La prueba falla si el handler devuelve más o menos campos que el esquema"
  - "La propuesta deja de perseguir una deuda ya cerrada en texto y persigue la garantía ejecutable que aún falta"

### S2 — Los tools de solo lectura que hoy faltan
- **Status**: done
- **DependsOn**: [S1]
- **Files**: `packages/plugins/delendai_expostman/src/lib/tools/check.tool.ts`, `packages/plugins/delendai_expostman/src/lib/tools/list.tool.ts`, `packages/plugins/delendai_expostman/src/lib/tools/stats.tool.ts`, `packages/plugins/delendai_expostman/src/lib/tools/scan.tool.ts`, `packages/plugins/delendai_expostman/src/index.ts`, `packages/plugins/delendai_expostman/tests/integration/check.tool.spec.ts`
- **Gate**: plugin
- acceptance:
  - "`check` responde si la colección se ha desincronizado del código, con la lista de lo que falta"
  - "`list`, `stats` y `scan` exponen lo que ya imprime el CLI, en datos y no en prosa"
  - "Cada tool nuevo nace con `outputSchema` y con prueba integrada"

### S3 — Las operaciones útiles pero no triviales: `push` e `init`
- **Status**: done
- **DependsOn**: [S2]
- **Files**: `packages/plugins/delendai_expostman/src/lib/tools/push.tool.ts`, `packages/plugins/delendai_expostman/src/lib/tools/init.tool.ts`, `packages/plugins/delendai_expostman/src/lib/contracts/plugin.interface.ts`, `packages/plugins/delendai_expostman/tests/integration/push.tool.spec.ts`
- **Gate**: e2e
- acceptance:
  - "`init` permite a un agente scaffoldar una configuración válida sin parsear stdout humano"
  - "`push` devuelve resultado estructurado y no filtra secretos en errores ni trazas"
  - "Si alguno se descarta, la propuesta deja escrita la razón"

### S4 — Decisión explícita sobre lo que NO debe ser una tool MCP
- **Status**: done
- **DependsOn**: [S3]
- **Files**: `docs/delendai/proposals/ready/DECISION-mcp-surface.md`
- **Gate**: none
- acceptance:
  - "`watch`, `open` y cualquier comando side-effect-heavy quedan incluidos o excluidos con criterio escrito"
  - "La superficie MCP deja de crecer por intuición y pasa a crecer por contrato"

## acceptance

- El plugin arranca y los 4 tools responden con una salida que valida contra su propio esquema
- La prueba falla si el handler devuelve más o menos campos que el esquema
- `check` responde si la colección se ha desincronizado del código, con la lista de lo que falta
- `list`, `stats` y `scan` exponen lo que ya imprime el CLI, en datos y no en prosa
- Cada tool nuevo nace con su outputSchema y con prueba integrada
- `init` permite a un agente scaffoldar una configuración válida sin parsear stdout humano
- `push` devuelve resultado estructurado y no filtra secretos en errores ni trazas
- `watch`, `open` y cualquier otro comando side-effect-heavy quedan incluidos o excluidos con criterio escrito
