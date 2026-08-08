---
id: a00002
title: "Auditoria 2026-08-08 v2 - consolidar green continuo y cerrar el backlog de excelencia"
kind: audit
status: ready
type: proposal
track: export-to-postman
date: 2026-08-08
related:
  - a00001
  - d00001
  - f00001
  - r00001
  - r00002
  - r00003
  - r00004
  - r00005
  - t00001
  - t00002
  - x00001
  - x00002
  - x00003
---

# a00002 - Auditoria 2026-08-08 v2 - consolidar green continuo y cerrar el backlog de excelencia

## Goal

Dejar el repositorio en un estado donde el green no dependa de trabajo local a medio aterrizar, la configuracion MCP refleje el arbol real, y el backlog ya abierto se ejecute en un orden que suba el proyecto desde "muy bueno" a excelencia operacional sostenida.

## why

La pasada de auditoria rehecha sobre el arbol actual da una foto distinta de la que describe el backlog historico, y por eso hace falta una propuesta nueva que consolide el estado presente en vez de repetir deuda ya cerrada.

Estado verificado en esta pasada:

- `mcp-vertex_security_security_audit` limpio: 0 secretos, 0 CVE, 0 hallazgos de licencias.
- `get_errors` limpio en todo el workspace.
- `bun run validate:package` verde: `npm pack`, instalacion limpia, binario enlazado, coleccion valida, `_postman_id` presente y 4 environments generados.
- La superficie MCP publica del plugin ya declara `outputSchema` en los 4 tools (`generate`, `summary`, `validate`, `test`), asi que el FATAL principal de `a00001` ya no describe el arbol actual.
- `bun run validate` rojo en el workspace actual por `lint:api`: `docs/API.md` no coincide con el codigo real.
- `mcp-vertex_overview` reporta 8 `configIssues`: `search` y `conventions` apuntan a `contract`, `service`, `helper` y `plugins`, carpetas que no existen en este repo.
- El arbol de trabajo contiene una remediacion en curso para escrituras atomicas (`projects/core/helpers/atomic-write.helper.ts`, migracion de `generate`, `watch`, `init`, `enrich` y el gate `lint:durable-writes`). Es una buena direccion, pero mientras no se aterrice como slice validada sigue siendo riesgo operativo, no garantia.
- `CONTRIBUTING.md` sigue citando `docs/extension-contract.md` como fuente de verdad y hoy ese archivo no existe.
- `paths.service.ts` sigue sosteniendo un singleton con cola de serializacion para consumidores concurrentes.
- No existe coverage cuantitativa por lineas o ramas: hay mucha prueba, pero no un umbral medible de zonas cubiertas.

La conclusion no es que el proyecto este mal. Al contrario: el suelo de calidad ya es alto. Lo que separa este repo de la excelencia sostenida es el drift entre contrato, configuracion, documentacion y slices ya empezadas.

## non-goals

- Reabrir propuestas cerradas solo para reescribir su prosa.
- Mezclar en una misma entrega hallazgos de auditoria con cambios locales no validados de otra persona.
- Tocar `docs/mcp-vertex/UNIVERSAL-AGENT-BOOTSTRAP.md`, que sigue siendo vendored.

## hallazgos confirmados en el estado actual

### H1 - La configuracion MCP escanea un repo que no existe

`mcp-vertex_overview` denuncia 8 incidencias de configuracion. En `mcp-vertex.config.json`, tanto `plugins.search.options.roots` como `plugins.conventions.options.roots` usan `contract`, `service`, `helper` y `plugins`, pero el repo real organiza el codigo bajo `projects/`, `scripts/`, `tests/`, `docs/` y `examples/`.

Impacto:

- Dos plugins clave trabajan sobre una fraccion equivocada del repo.
- La auditoria automatica parece completa cuando en realidad nace sesgada.
- La configuracion contradice el layout que el propio repo expone.

Resolution track: `d00001` S3-S4, con prioridad inmediata.

### H2 - La API publica documentada puede quedarse atras del codigo sin una pasada final de sincronizacion

`bun run validate` cae en `lint:api`. Al regenerar `docs/API.md` durante la comprobacion se observa el desfase exacto: la referencia pasa de 194 simbolos en 42 modulos a 196 simbolos en 43 modulos e incorpora `projects/core/helpers/atomic-write.helper.ts`.

Impacto:

- La documentacion publicada deja de ser contrato fiable de la libreria.
- El gate detecta el problema, pero hoy depende de que la slice que cambie superficie publica recuerde correr la regeneracion final.

Resolution track: cerrar la slice activa de escrituras atomicas junto con la regeneracion de `docs/API.md` y su validacion completa.

### H3 - La remediacion de durabilidad existe, pero sigue siendo trabajo en curso hasta que se aterrice como slice cerrada

El workspace actual contiene cambios sin asentar que migran escrituras crudas a `writeFileAtomic` y anaden un gate especifico. Esa direccion es correcta y encaja con la deuda que venia arrastrando `x00002`, pero una auditoria seria no confunde "cambios presentes en el worktree" con "garantia ya incorporada al producto".

Impacto:

- El repo puede verse verde o rojo segun el estado local, no solo segun `HEAD`.
- Hay riesgo de mezclar una mejora transversal correcta con otros cambios, sin una validacion de slice limpia.

Resolution track: ejecutar `x00002` como cierre disciplinado de slice, no como arrastre accidental del arbol.

### H4 - El backlog ready ya contiene la mayoria de la deuda restante; falta orden de ejecucion y cierre

La parte buena de esta auditoria es que varias piezas grandes ya estan formuladas y listas:

- `x00003`: contencion de rutas de salida dentro de una raiz segura.
- `d00001`: bootstrap, configuracion MCP y gate de drift documental.
- `r00004`: retirar o rehacer `enrich`, que sigue siendo un comando con semantica dudosa.
- `r00005`: terminar la migracion fuera del singleton de rutas y del contexto global de proceso.
- `r00002`: reducir castings y listas paralelas, y consolidar lectores compartidos.
- `r00003`: salida del CLI en un solo idioma.
- `t00001`: cerrar huecos de cobertura y contratos sin test.
- `t00002`: anadir coverage cuantitativa por scopes para que la salud no dependa solo del recuento de tests.
- `f00001`: experiencia de escritorio para subir la accesibilidad del producto fuera de terminal.
- `r00001`: identidad de endpoint como causa raiz de varias mordidas historicas.

El problema ya no es "no sabemos que hacer", sino ejecutar ese backlog en orden de apalancamiento.

## slices

### S1 - Aterrizar o aparcar limpiamente la slice de escrituras atomicas

- **Files**: `package.json`, `projects/core/helpers/atomic-write.helper.ts`, `projects/cli/commands/generate.script.ts`, `projects/cli/commands/watch.script.ts`, `projects/cli/commands/init.script.ts`, `projects/cli/commands/enrich.script.ts`, `scripts/gates/lint-durable-writes.script.ts`, `tests/core/atomic-write.helper.spec.ts`, `docs/API.md`
- **Gate**: `bun run validate`
- acceptance:
  - "No quedan escrituras crudas en codigo de producto fuera del helper atomico"
  - "`docs/API.md` queda sincronizado con la nueva superficie publica"
  - "La slice entra y sale del arbol como unidad validada"

### S2 - Corregir las roots invalidas de `search` y `conventions`

- **Files**: `mcp-vertex.config.json`, `tests/cli/mcp-config.spec.ts`
- **Gate**: `bun run lint` y `mcp-vertex_overview { compact: true }`
- acceptance:
  - "`configIssues` queda en 0 para `search` y `conventions`"
  - "Las roots configuradas existen de verdad en disco"
  - "Un test rompe si el layout vuelve a desviarse"

### S3 - Cerrar `x00003` antes de seguir ampliando superficie

- **Files**: segun propuesta `x00003`
- **Gate**: `bun run validate`
- acceptance:
  - "Ningun path de salida escapa de la raiz permitida"
  - "Los artefactos que escribe el producto quedan contenidos y testeados"

### S4 - Ejecutar `d00001` completo y usarlo como candado de drift

- **Files**: segun propuesta `d00001`
- **Gate**: `bun run lint`
- acceptance:
  - "El bootstrap describe la arquitectura que existe hoy"
  - "Las rutas y simbolos citados en la documentacion tienen anclaje real"
  - "Un gate avisa cuando el contrato vuelva a separarse del codigo"

### S5 - Resolver la ambiguedad de `enrich`

- **Files**: segun propuesta `r00004`
- **Gate**: `bun run validate`
- acceptance:
  - "`enrich` o se retira o vuelve a tener una semantica correcta para el producto actual"
  - "Ningun comando aparentemente inocuo puede degradar una coleccion valida"

### S6 - Bajar deuda estructural y consolidar reutilizacion

- **Files**: segun propuesta `r00002`
- **Gate**: `bun run validate`
- acceptance:
  - "Menos castings, menos listas paralelas, un solo lector por concepto"
  - "La arquitectura se vuelve mas facil de extender sin deuda oculta"

### S7 - Homogeneizar salida y UX del CLI

- **Files**: segun propuesta `r00003`
- **Gate**: `bun run validate`
- acceptance:
  - "Todo el CLI habla un unico idioma coherente"
  - "El producto deja de alternar tono y lenguaje segun el comando"

### S8 - Cerrar huecos de cobertura antes de añadir mas superficie

- **Files**: segun propuesta `t00001`
- **Gate**: `bun run test`
- acceptance:
  - "Los comandos y contratos sin test dejan de depender de validacion manual"
  - "Los bugs de integracion se detectan antes de tocar docs o release"

### S8b - Hacer cuantitativa la cobertura que hoy solo es cualitativa

- **Files**: segun propuesta `t00002`
- **Gate**: `bun run test`
- acceptance:
  - "El repo deja de medir salud de test solo por cantidad de specs y pasa a medir tambien lineas y ramas por scope"
  - "La regresion de cobertura deja huella automatica"

### S9 - Remate de excelencia de producto

- **Files**: segun propuestas `f00001` y `r00001`
- **Gate**: segun cada propuesta
- acceptance:
  - "El producto mejora experiencia y consistencia, no solo correccion tecnica"
  - "La capa de uso final queda a la altura del nucleo ya robusto"

## orden recomendado

1. S1
2. S2
3. S3
4. S4
5. S5
6. S6
7. S7
8. S8
9. S8b
10. S9

## acceptance

- `bun run validate` verde en un arbol limpio.
- `mcp-vertex_overview` sin `configIssues`.
- `docs/API.md` sincronizado con el codigo publico.
- La remediacion de durabilidad aterrizada como slice cerrada, no como WIP suelto.
- El backlog ready restante ejecutado en orden de apalancamiento, no a golpe de contexto.
- El proyecto queda con contrato, docs, gates y superficie publica alineados entre si.