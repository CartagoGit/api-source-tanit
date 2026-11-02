---
id: a00017
title: "i18n inversion — Inglés-first en el proyecto, i18n solo para la app que lo usa"
kind: audit
status: done
type: proposal
shippedIn:
  - fa98d36
track: api-source-tanit
date: 2026-09-04
dependsOn:
  - i00002
  - x00029
related:
  - a00009
  - b00001
last-transition-id: orchestrator-2026-09-06-a00017-unblock
last-correlation-id: orchestrator-2026-09-06-a00017-unblock
last-transition-from: blocked
last-idempotency-key: a00017-blocked-to-ready-2026-09-06
last-edit-note: "2026-09-06: bloque eliminado (los dependsOn i00002 y x00029 están retired). S1 re-estructurado en S1 (narrow: 3 plantillas que auto-generan español dentro de la colección Postman) + S1.5 (broad cleanup, deferred por área)."
---

> **Bloque eliminado el 2026-09-06.** Las dependencias `i00002` y `x00029`
> ahora viven en `retired/` (`i00002` superseded by `x00027`; `x00029`
> retirado sin superseder). El `blockedReason` original (CI verde
> primero, luego multi-service) ya no aplica.

# a00017 — inversión i18n

## Goal

Invertir la capa i18n actual. El proyecto pasa a ser **inglés-first en todas
sus superficies internas** (código fuente, comentarios, JSDoc, mensajes de
error, descripciones de tests, ejemplos, fixtures, configuración, comandos
CLI, nombres de campos JSON en colecciones Postman, nombres de variables de
entorno, **comentarios y descripciones en archivos generados**). La capa i18n
se reduce a su papel correcto: servir a **la app que usa este proyecto** (la
CLI / UI / desktop que invocan los usuarios finales) y vive exclusivamente en
`packages/ui/i18n/locales/*.json`.

## Why

El audit de rebrand 2026-09-04 detectó que las colecciones Postman generadas
desde los ejemplos (`examples/example-app/*`) tienen nombres como
"Usuarios" / "Órdenes" / "Sesiones" porque las constantes
`examples/example-app/config.constant.ts` y `endpoints.constant.ts` están
escritas en español. Lo mismo aplica a JSDoc, mensajes de error y
descripciones de tests en varios paquetes.

El proyecto arrastra español no como accidente, sino como confusión entre
**dos planos que son distintos**:

| Plano | Quién es el público | Idioma natural | Ejemplos |
|---|---|---|---|
| El **proyecto** (este repo) | Contribuidores, mantenedores, herramientas | **Inglés** | código fuente, comentarios, JSDoc, identifiers, error strings, test descriptions, CHANGELOG archaeology, docs/*.md, README, CONTRIBUTING, gate scripts, examples/example-*/ fixtures, collections de ejemplo, variables de entorno |
| La **app que usa este proyecto** | Usuarios finales que corren `apisrc` / `apisrc ui` | **i18n** (es, en, pt, fr, …) | mensajes del CLI (error, success, info), texto del `--help`, la UI web, los `README` de la app |

Hasta hoy ambos planos se mezclan: el proyecto emite strings en español (que
salen en colecciones, en errores, en docs) **y** la app tiene un módulo i18n
correctamente en `packages/ui/i18n/locales/`. El módulo i18n no puede traducir
lo que el proyecto generó en español a nivel de colección / comentario / doc.

El refactor necesario es **mover todo el español del proyecto al inglés**, y
dejar los `packages/ui/i18n/locales/*.json` exactamente donde están, porque
estos son **la única capa correcta de i18n del producto** (la que verá el
usuario final cuando corra la app).

## Non-goals

- **No tocar `packages/ui/i18n/locales/*.json`**: esos son la capa correcta
  de i18n de la app. No se renombran, no se mueven, no se traducen más allá
  de lo que ya hacen (cada locale es por idioma).
- **No re-escribir CHANGELOG archaeology**: las entradas 0.x conservan su
  idioma original (español si estaban en español) — eso es historia del
  proyecto. La entrada `## 1.0.0 — Renamed to Tanit` añadida en b00001/S5 ya
  está en inglés y se queda. Las entradas nuevas siguen en inglés.
- **No cambiar nombres de productos, marcas, binarios** (Tanit, apisrc,
  api-source-tanit, delendai_tanit, …): esos nombres son del plano de marca
  y son válidos en cualquier idioma.
- **No crear una "lengua del proyecto" configurable**. El idioma natural del
  proyecto es inglés. Punto.

## Slices

### S1 — Plantillas que auto-generan español dentro de la colección Postman (narrowed, atomic)

> **Por qué este S1 existe.** El inventario 2026-09-06 mostró que el único
> español que llega al **producto** (la colección Postman que el usuario
> abre en Postman) viene de **tres plantillas hardcodeadas**. Cambiarlas
> es atómico, no toca el resto del árbol, y resuelve la queja concreta
> que motivó esta propuesta. El cleanup amplio de comentarios/identifiers/
> JSDoc queda para S1.5 (slices posteriores por área).

- **Status**: done
- **Scope**: **3 archivos de plantilla + sus tests** + commit con los 21
  ejemplos regenerados.
- **Files**:
  - `packages/core/discovery/project-loader.service.ts:266` (description por
    defecto de la colección; afecta a todos los proyectos sin config propio).
  - `packages/cli/commands/init.script.ts:157` (scaffold de `apisrc init`;
    escribe `config.constant.ts` con la description que arranca cualquier
    proyecto nuevo).
  - `packages/frameworks/laravel/catalog-enricher.service.ts:159, 178, 235,
    240, 265, 270` (descripciones que `enrich` añade a los items de la
    colección de los proyectos Laravel).
- **Cambios exactos**:
  - `project-loader.service.ts:266`
    `Colección Postman generada automáticamente para ${name}.`
    → `Postman collection auto-generated for ${name}.`
  - `init.script.ts:157`
    `Colección Postman de ${projectName}.`
    → `Postman collection for ${projectName}.`
  - `catalog-enricher.service.ts`
    - `**Variante auto-generada**: ${variant.name}.` (líneas 159 y 178)
      → `**Auto-generated variant**: ${variant.name}.`
    - `Generada automáticamente desde ${rules.className}.` (líneas 235 y 265)
      → `Auto-generated from ${rules.className}.`
    - `Variantes auto-generadas desde \`${rules.className}\`.` (líneas 240 y 270)
      → `Auto-generated variants from \`${rules.className}\`.`
- **acceptance**:
  - `grep -rE 'Colección|Colección|Generada automáticamente|auto-generada' packages/core packages/cli packages/frameworks`
    devuelve **lista vacía** para los 3 archivos anteriores.
  - **Tests nuevos** (`packages/core/tests/.../project-loader.spec.ts` y
    `tests/cli/init-command.test.ts` y
    `packages/frameworks/laravel/catalog-enricher.spec.ts`): cada uno
    asegura que el texto generado está ahora en inglés.
  - `bun run validate:examples` regenera los 21 ejemplos y **se commitea el
    output** (los `examples/example-*/export-to-postman/*.postman_collection.json`
    y `tanit/*.postman_collection.json` quedan en inglés en `info.description`).
  - `bun run validate` verde end-to-end.
- review-state: done
- review-implementer: implementation_runner
- review-reviewer: delivery_verifier
- review-log: approved by delivery_verifier — S1 verifies clean end-to-end. (1) Acceptance grep returns empty for the 3 source files (only the pre-flagged false positive `gin.scanner.ts:319` matches — comment, out of S1 scope). (2) All 5 spec'd string changes are present in `2ad691c` and the post-fix HEAD is `fa98d36`. (3) All 3 required tests are added and pass: `tests/core/project-loader.spec.ts` (13/13), `tests/frameworks/endpoint-discovery.spec.ts` (40/40), `tests/cli/init-command.test.ts` (1/1). (4) Regenerated collections at the 3 spec'd paths carry `"description": "Postman collection auto-generated for ..."`. (5) Gating green: typecheck EXIT=0, lint:output-language EXIT=0, lint:i18n-completeness EXIT=0, validate:examples EXIT=0 (21/21), full vitest (4 sections) 2690 passing / 1 skipped. Non-blocking concerns tracked in the report: (a) scope creep in `fa98d36` — the implementer translated 2 additional strings (`Variante:` → `Variant:` and `Variantes (auto ·` → `Variants (auto ·`) that are NOT in the S1 spec; consistent with the spirit but should be called out so future slices don't drift; (b) `lint:proposals` fails on a pre-existing duplicate `x00041` untracked file — unrelated to S1, came from x00041 archive work; (c) S5's dedicated `lint:i18n-drift` gate is still pending (separate slice).
### S1.5 — Source code: inglés-first (broad cleanup, deferred)

> **Diferido respecto a S1**. Tras un análisis 2026-09-06, el resto del
> español en el árbol vive mayoritariamente en **identificadores, JSDoc
> y comentarios** (no en salida de producto), y reescribir cientos de
> archivos en un mega-slice viola la regla de "una slice atómica por
> turno" del universal bootstrap. Se re-estructurará en slices
> posteriores por área (e.g. S1.5.a — identifiers en `packages/core`,
> S1.5.b — JSDoc en `packages/contracts`, ...) cuando haya capacidad.

- **Status**: pending (was the original S1)
- **Files** (overview only): `packages/{cli,contracts,core,ui,frameworks,plugins}/**/*.ts`,
  `tests/**/*.ts`, `scripts/{gates,build,helpers}/**/*.ts`.
- **Reglas** (sin cambios): identifiers/JSDoc/comentarios/test descriptions
  en español pasan a inglés. Mensajes de error que ve el usuario final
  siguen en `packages/ui/i18n/locales/*.json`.
- **acceptance** (overview): mismas grep + gates que el original S1,
  ejecutado por área.

### S2 — Tests: descriptions y assertions en inglés

- **Status**: pending
- **dependsOn**: S1
- **Files**: `tests/**/*.spec.ts`, `tests/**/*.test.ts`.
- **Cambios**:
  - `describe("detecta los endpoints")` → `describe("detects endpoints")`.
  - `it("no debería perderse cuando …")` → `it("must not drop when …")`.
  - Mensajes de `expect(...).toBe("…")` cuando son humanos legibles → inglés.
- **acceptance**:
  - Misma grep acceptance que S1, aplicada al subtree `tests/`.
  - Suites completas siguen verdes.

### S3 — Docs + gates: README, CONTRIBUTING, docs/*.md y scripts en inglés

- **Status**: pending
- **dependsOn**: S1, S2
- **Files**:
  - `README.md`, `CONTRIBUTING.md`, `docs/{API,INSTALL,POSTMAN,FRAMEWORKS,UI,NAMING,DESKTOP-*,MCP-SURFACE}.md`,
  - `examples/README.md`,
  - host pointers (`AGENTS.md`, `CLAUDE.md`, copilot-instructions.md, etc.),
  - `scripts/{gates,build,helpers}/**/*.ts` (literales que imprimen en consola),
  - `docs/delendai/proposals/README.md` (solo cabecera),
  - los `.cache/delendai/proposals/index.json` regenera solo.
- **Cambios**:
  - Toda la prosa técnica en inglés.
  - **CHANGELOG archaeology** (entradas 0.x antiguas en español): **no se
    toca**. La regla es: lo nuevo se escribe en inglés; lo viejo se
    preserva.
  - La nota arqueológica sobre el corte de `track: export-to-postman` a
    `track: api-source-tanit` añadida en b00001/S7 se queda; está en español,
    es historia documentada del proyecto. Si se quiere reescribir a inglés
    es opt-in (no scope del S3; ADR por separado).
- **acceptance**:
  - `grep -rEln '<pattern-de-espanol>' README.md CONTRIBUTING.md docs/ examples/README.md scripts/ AGENTS.md CLAUDE.md .github/copilot-instructions.md`
    devuelve **lista vacía**.
  - Excepto: matches en CHANGELOG.md que sean entradas marcadas como
    arqueología (no se tocan), y la nota arqueológica en
    `docs/delendai/proposals/README.md` (excluida por la regla del
    Non-goal).
  - `bun run lint:docs` verde.

### S4 — Examples + fixtures: inglés-first

- **Status**: pending
- **dependsOn**: S1, S2, S3
- **Files**:
  - `examples/example-app/config.constant.ts` — nombres como "Usuarios",
    "Órdenes", "Sesiones" → "Users", "Orders", "Sessions".
  - `examples/example-app/endpoints.constant.ts` — paths y nombres en inglés.
  - Cualquier `examples/example-*/README.md`, scripts, fixtures en español.
  - **No** se regeneran los Postman collection files commiteados a mano; se
    corren `bun run validate:examples` y se commitea el output.
- **Cambios**:
  - Los nombres de "operación" y los nombres de carpetas dentro de
    collection (`info.name`, `item[*].name`, env variables `id`/`name`)
    pasan a inglés.
  - Los nombres de endpoint paths (URLs reales) **se quedan como están** si
    la API ficticia los define así (eso es semántica del proyecto ficticio,
    no del proyecto real).
  - Los entornos (`.postman_environment.json`) usan variables en inglés
    (`localBaseUrl`, `stagingBaseUrl`, `productionBaseUrl`) si las
    descripciones estaban en español.
- **acceptance**:
  - `grep -rE '[áéíóúñÁÉÍÓÚÑ]' examples/` devuelve lista vacía (o solo
    URLs externas que sean intencionales).
  - `bun run validate:examples` regenera los 21 ejemplos y los valida
    verde.
  - El commit incluye los Postman collection regenerated files.

### S5 — Gate `lint:i18n-drift`

- **Status**: pending
- **dependsOn**: S1, S2, S3, S4
- **Files**:
  - `scripts/gates/lint-i18n-drift.script.ts` (nuevo)
  - `package.json` — añade script y enlaza en `lint` aggregation.
- **Comportamiento**:
  - Escanea `packages/{cli,contracts,core,ui,frameworks,plugins}/**/*.ts`,
    `tests/**/*.spec.ts`, `docs/*.md`, `examples/**`, `README.md`,
    `CONTRIBUTING.md`, `scripts/{gates,build,helpers}/**/*.ts`.
  - **Excluye**: `packages/ui/i18n/locales/*.json`,
    `docs/delendai/proposals/**/README.md` (proposals son por idioma
    según autor; el gate no las audita), `CHANGELOG.md` arqueología
    marcada con `<a id="historical">` o entrada explícitamente
    fechada antes de 2026-09.
  - Flag por: `[áéíóúñÁÉÍÓÚÑ]` o por un set curado de palabras
    comunes en español (`generador`, `detector`, `configuración`,
    `usuarios`, etc.) con boundary detection.
  - Whitelist explícito por línea: `// I18N-ALLOW: <razón>`.
- **acceptance**:
  - Gate corre limpio contra el árbol S4.
  - Falla con archivo:línea + razón si la whitelist no se cumple.

### S6 — `docs/I18N.md`: la regla de separación

- **Status**: pending
- **dependsOn**: S1, S2, S3, S4, S5
- **Files**:
  - `docs/I18N.md` (nuevo)
  - `docs/NAMING.md` (añade referencia a I18N.md)
- **Contenido**: documento corto (≤ 2 páginas) con tres secciones:
  1. **Project natural language = English.** Por qué: el proyecto es
     inmutable una vez publicado; los identificadores, los mensajes de
     error, los comments, los nombres de exports, los títulos de docs,
     los ejemplos publicados en npm o en el sitio son leídos por
     contribuidores y herramientas que esperan inglés. El español es un
     accidente histórico, no una decisión.
  2. **App i18n lives at `packages/ui/i18n/locales/*.json`.** Por qué:
     esa es la capa que ve el usuario final de `apisrc`, `apisrc ui` y la
     app desktop. Cada locale es un idioma soportado. No se renombra, no
     se mueve, no se "estandariza" en inglés — cada locale conserva su
     idioma natural (catalán, español, portugués, inglés, …).
  3. **¿Dónde escribo una string nueva?**
     - Si es en código fuente, comentario, JSDoc, mensaje de error, test,
       docs, ejemplo, o cualquier superficie del proyecto → **inglés**.
     - Si es en `packages/ui/i18n/locales/*.json` → idioma del locale
       (español en `es.json`, inglés en `en.json`, etc.).
     - Si no sabes → **inglés en el repo, locale en `packages/ui/i18n/`**.
  - Un diagrama visual ASCII de las dos capas.
- **acceptance**:
  - Documento commiteado, referencia añadida en `docs/NAMING.md`.
  - `bun run lint:docs` verde (el documento pasa el link-check).

## acceptance

**Tras cerrar S1 (narrow):**

1. Las 3 plantillas que auto-generan español dentro de la colección Postman
   (`project-loader.service.ts`, `init.script.ts`,
   `catalog-enricher.service.ts`) emiten texto en inglés.
2. Las 21 colecciones Postman regeneradas desde `bun run validate:examples`
   tienen `info.description` 100% en inglés.
3. `grep -rE 'Colección|Colección|Generada automáticamente|auto-generada' packages/core packages/cli packages/frameworks`
   devuelve **lista vacía**.
4. `bun run validate` verde end-to-end.

**Tras cerrar S1.5 + S2 + S3 + S4 + S5 + S6 (broad, deferred):**

1. `grep -rEln '[áéíóúñÁÉÍÓÚÑ]' --include='*.ts' --include='*.md' --include='*.json' --exclude-dir=node_modules --exclude-dir=.cache --exclude-dir=dist --exclude-dir=build --exclude-dir=.git packages tests scripts docs examples README.md CONTRIBUTING.md CHANGELOG.md AGENTS.md CLAUDE.md` devuelve **sólo**:
   - matches en `packages/ui/i18n/locales/*.json` (la capa correcta de i18n),
   - matches en `CHANGELOG.md` marcados como arqueología (`<a id="historical">` o entrada fechada antes de 2026-09-04),
   - matches en `docs/delendai/proposals/**` (cada proposal es por idioma del autor; el gate no las audita).
2. `bun run validate` verde en sus 6 secciones + `lint:contracts` + `lint:boundaries` + `lint:docs` + `lint:proposals` + `lint:i18n-drift` + `test:contracts` + `test:core` + `test:frameworks` + `test:cli` + `test:e2e` + `validate:examples`.
3. Las 21 colecciones Postman regeneradas desde `bun run validate:examples`
   tienen nombres 100% en inglés (`info.name`, `item[*].name`, env vars).
4. El árbol de proposals pasa de `track: export-to-postman` (arqueología) a
   `track: api-source-tanit` para todas las propuestas nuevas.
5. `docs/I18N.md` está commiteado y enlazado desde `docs/NAMING.md`.

## Risks

1. **Volumen de cambios por slice**. S1 toca potencialmente cientos de
   archivos. Mitigación: el agente ejecuta el cambio archivo a archivo con
   `git diff` por archivo antes de commitear, así cada error se detecta en
   su commit en lugar de un mega-commit enmascarado.
2. **Glossary drift**. Si dos archivos traducen el mismo término español con
   dos ingleses distintos, el resultado es incoherente. Mitigación: el
   agente lee 3-5 archivos similares ya en inglés antes de traducir uno;
   usa el término más común del codebase.
3. **CHANGELOG archaeology mal traducida**. Si una entrada 0.x dice
   "Refactor de la generación" en español y se reescribe como
   "Generation refactor" en inglés, **pierde su significado histórico** y
   se comete un false positive en cualquier grep que rastree los mensajes
   originales. Mitigación: S3 hace whitelist explícita de `CHANGELOG.md`
   arqueología y no se toca.
4. **Eslabones del lenguaje del proyecto vs lenguajes soportados por
   scanners**. Hay frameworks con palabras en otros idiomas (Tailwind,
   métodos en inglés, pero también podría haber comentarios en ruso,
   japonés, chino en el codebase si los contribuidores son japoneses).
   Mitigación: el gate S5 busca patrones en español **explícitamente**,
   no "cualquier idioma que no sea inglés", para no discriminar otras
   lenguas y mantener foco en la separación inglés-proyecto vs
   i18n-app.
5. **El CHANGELOG archaeology que estuviera en español no se traduce**: hay
   una asimetría real. Si el repo histórico se escribió mayormente en
   español, eso queda. Decisión explícita: no se reescribe arqueología.
   Únicamente las entradas nuevas son en inglés.

## Cross-refs

- **b00001 (rebrand Tanit)** — la nueva marca es coherente con el cambio
  de idioma natural: Tanit habla inglés en sus docs (README, etc.) y tiene
  una capa `packages/ui/i18n/locales/` para los usuarios finales.
- **a00009, a00010** — auditorías 2026-09-03/04 que dejaron rastro de esta
  deuda i18n; no se reabren.
- **x00022–x00025** — fixes de bugs funcionales del audit; este proposal
  no se solapa con ellos.
