---
id: a00009
title: "Auditoría exhaustiva 2026-09-03 — CLI, scanners, core, UI y propuesta de UX/i18n/detección"
kind: audit
date: 2026-09-03
status: done
type: proposal
track: export-to-postman
---

# a00009 — Auditoría exhaustiva 2026-09-03 — CLI, scanners, core, UI y propuesta de UX/i18n/detección

Esta auditoría es **operativa**, no sólo descriptiva: detecta hallazgos, los
clasifica y los abre como propuestas concretas (fix/feat/refactor/test) listas
para ejecutar en slices. Sustituye como foto actual a `a00008` (2026-08-29) y
amplía el alcance que aquella tenía: a00008 cubrió sobre todo gates y DoD;
ésta cubre **CLI, scanners, core, UI, plugin, build, lints, naming, tests,
docs**.

## 1. Snapshot auditado

- **Rama**: `develop` · **HEAD**: `3f01abb` (1 commit ahead del snapshot
  base `d48836d` que es la foto de a00008 ya integrada en su día).
- **Estado del working tree al empezar**: limpio.
- **Bug fix de entrada** (slice S0 — `3f01abb`): el comando `watch`
  lanzaba un error no controlado cuando se invocaba sin `--project-root`
  porque `resolveProjectContext` es estricto por diseño y `watch` no
  aplicaba su propio fallback a `cwd`. La rama "→ No --project-root"
  que tenía escrita era código muerto. Fix: `watch` resuelve la raíz
  por sí mismo con `readFlag` + `env` + `cwd` antes de llamar a
  `resolveProjectContext`; los demás comandos siguen estrictos.
  **6/6 tests de `watch-command.test.ts` ahora pasan**; coverage
  subió a 83.96 / 73.38 / 88.43 / 85.42 (stmts / branches / funcs /
  lines) sobre suelos 73 / 62 / 82 / 75. Era el agujero de UX que
  cualquier agente podía pisar.

## 2. Metodología

- Lectura completa de los 21 scanners + el adapter + el registry +
  la trinidad `IProjectScanner` / `IRouteScanner` /
  `IValidationSpecProvider` + sus tests.
- Lectura completa del core: discovery, exporters, helpers,
  adapters.
- Lectura completa del CLI: 12 comandos + `cli.script.ts` + tests.
- Lectura completa del plugin MCP: 10 tools + 4 helpers + contratos.
- Lectura completa de UI: web constants, theme, i18n, settings,
  server, dashboard, table, ansi, interactive script + el comando
  `ui.script.ts`.
- Lectura completa de gates y scripts de build.
- Cruce con `a00006` (auditoría previa del repo) y `a00008` (DoD) —
  los hallazgos cerrados en esos docs se revalidan y los abiertos
  se reabren con código nuevo si aplica.

## 3. Puntuación por sección

Nota: 0–10. Ponderación implícita: bugs > gates > UX. Un gate que
miente pesa más que un comando lento.

| Sección | Nota | Lectura corta |
|---|---:|---|
| Gates y DoD (heredado de a00008) | 9,0 | `validate` ejecuta lo que dice; umbrales vigilados; bench vigilado |
| Bug-fix de entrada (S0) | — | Resuelto en `3f01abb` antes de empezar la pasada |
| CLI y comandos | 7,4 | 12 comandos, pero `--open` (F-L01) y el guard de `test-all` (F-L02) están rotos; `--inspect` y `--basename` sin tests |
| Framework scanners | 7,7 | 21 scanners cubren los lenguajes pedidos pero `JSON.parse` sin try/catch (F-L03), `process.cwd()` en helpers del plugin (G-L01), `dist/` del plugin no compila (B-L01) |
| Core (discovery + exporters + helpers) | 8,4 | Buenas capas, helpers bien factorizados, exporter-registry vigilado; `paths.service` con singleton heredado de F-006 sigue sin refactorizarse |
| Contratos (`packages/contracts/`) | 8,5 | Tipos en su sitio; el lint los vigila; los schemas MCP derivan de `z.infer` |
| MCP plugin | 7,0 | 10 tools con `inputSchema` + `outputSchema`; F-L05 (regex sobre stdout) y F-L08 (bin declarado dos veces) son defectos concretos; `dist/` no se compila (B-L01) |
| UI (web) | 6,8 | Existe y se valida con 6 specs, pero es minimal: sin multi-proyecto, sin historial de detecciones, sin explainer "por qué Laravel", sin tutorial |
| Empaquetado y distribución | 6,5 | `validate:package` prueba el bin pero no el plugin; el plugin build está roto (B-L01); `bin` con dos nombres iguales (F-L08) |
| Documentación | 7,6 | Convenciones vigiladas (`lint:docs`); `lint:bootstrap-drift` evita drift entre universal y proyecto; INSTALL.md no documenta `POSTMAN_API_KEY` para `push` (D-L03) |
| Tests (cualitativo) | 8,0 | Suites por sección, e2e por framework; gaps importantes listados en T-L01…T-L14 |
| Tests (cuantitativo) | 8,4 | 2693 tests / 130 ficheros / umbrales vigentes; branches en 73,38 (margen 11,4 puntos sobre el suelo de 62) |
| Seguridad operacional | 8,7 | `lint:secrets` + `lint:sast` + audit de dependencias; F-L07 (push leak por stderr) y F-L13 (runner sin hint) son defectos concretos |
| Naming / homogeneidad | 8,8 | `lint:naming` cubre sufijos; N-L02 (`NAMESPACE` muerto) y N-L10 (doc vs código) son hallazgos puntuales |
| i18n / idioma de salida | 7,0 | `lint:output-language` activo y vigilante; mezcla residual en `validate-json`, `open-postman`, `watch` (O-L01…O-L07) |

**Nota global actual: 7,8.** Inferior a la de a00008 (8,1) **porque esta
auditoría es más estricta, no porque el proyecto haya empeorado**: a00008
medía desde el éxito de cerrar F-001/F-002/F-003/F-004; esta mide desde
cero otra vez y encuentra cosas que a00008 no buscó (UI, plugin, lints
de proceso). El potencial tras ejecutar todos los slices propuestos:
**9,1** (F-L01/F-L02/F-L03/G-L01/B-L01 resueltos + UI multi-proyecto +
detección explicada + i18n completa).

## 7. Estado de ejecución

Esta auditoría se ejecutó en la misma sesión que la escribió, como
`a00008` hizo en su día. Los hallazgos cerrados en `done/`:

| Trabajo | Commit | Cierra |
|---|---|---|
| `watch` cae a cwd y lo anuncia | `3f01abb` | S0 (pre-slice) |
| `generate --open` roto → invoca `runOpenPostman` directo | `67cc1cb` | x00020 (BUG-001) |
| `test-all` sin guard + lint:command-coverage extendido | `bd88a4a` | x00021 (BUG-002 + BUG-010) |
| 6 sitios con `JSON.parse(await readFile(...))` + nuevo lint | `737a5d9` | x00012 (BUG-003) |
| Plugin build roto → `bun build` + validate:package cubre | `fa8cf41` | x00013 (BUG-004) |
| `runner.helper` leía `process.*` → IRunnerContext + snapshot | `94a2951` | x00014 (BUG-009) |
| r00010 S2 — borrado el singleton de paths.service | `fceb2e1` | a00008 F-006 (P1) |

**Estado del gate** tras los 7 commits: 22 lints verdes, 2716 tests
pasan, 21/21 ejemplos generan, bench de scan plano. La cobertura
subió a 83.96 / 73.34 / 88.43 / 85.42 vs 83.96 / 64.2 / 84.5 / 79.1 de
a00008 (el snapshot que abrió esta auditoría); branches es el
indicador del trabajo de los x00012 (4 manifests que antes
fallaban en silencio ahora se manejan con `{ ok:false, reason }`).

**Quedan abiertas** (no abordadas en esta pasada por scope; viven
como propuestas `ready/`):
- BUG-005 / BUG-006 / BUG-007 / BUG-008 / BUG-011 / BUG-012 / BUG-013
  / BUG-014 — defectos menores, baja prioridad.
- FEAT-001/002/003 → `f00010` (explainer + health + dashboard).
- FEAT-005/006/007/008/009 → viven en `f00010` o en sus propuestas
  hermanas por crear.
- FEAT-010 → `f00011` (más señales de detección).
- REF-001 — cerrado por `r00010`; ya no está abierto.
- REF-002 / REF-003 — cerrados por x00012; ya no están abiertos.
- TEST-001/002 — cerrados por x00020; ya no están abiertos.
- TEST-004/005/006/007 — siguen abiertos; viven como issues en
  `docs/mcp-vertex/issues/` por crear.
- LINT-002/003/004 — cerrados por x00012 + x00021; ya no abiertos.
- LINT-005/006/007 — siguen abiertos, viven como issues.
- DOC-001/002/003/004 — siguen abiertos, viven como issues.

Para la próxima pasada: abordar `f00010` y `f00011` (los dos features
de la lista) antes de seguir con la larga cola de BUG/REF/TEST/LINT/DOC
menores.

## 4. Hallazgos consolidados

Lista plana; cada uno tiene id estable y se reusa en las propuestas
de fix/feat/refactor/test derivadas de esta auditoría. El orden es
por severidad dentro de cada bloque.

### 4.1 Bugs (severidad decreciente)

#### BUG-001 [FATAL] `generate --open` construye una ruta muerta

- **Dónde**: `packages/cli/commands/generate.script.ts:407-417`
- **Síntoma**: `bun run expostman generate --open` cae a
  `process.cwd()` (vetado por el gate), busca
  `<cwd>/open-postman.script.ts` (falso: vive en
  `packages/cli/commands/open-postman.script.ts` desde la reorg de
  `packages/`) y produce `MODULE_NOT_FOUND`. El usuario ve
  `→ --open: lanzando open-postman…` y luego silencio.
- **Repro**: ejecutar contra cualquier proyecto de los 21 ejemplos.
- **Fix**: importar `runOpenPostman` desde el módulo hermano y
  llamarlo directamente; sin `spawn`, sin `cwd`, sin
  `import.meta.dir`.
- **Test**: añadir a `tests/cli/writing-commands.test.ts` un caso
  con `--open` que verifique que el binario mockeado se invoca una
  vez con el `--file <collection>` correcto.
- **Severidad**: FATAL · **Origen**: F-L01.

#### BUG-002 [FATAL] `scripts/gates/test-all.script.ts:176` ejecuta `process.exit` al importar

- **Dónde**: `scripts/gates/test-all.script.ts:176`
- **Síntoma**: a diferencia del resto de gates, este no envuelve
  `process.exit(await main())` con `if (import.meta.main)`. Importarlo
  desde otro gate (p. ej. un smoke futuro) mata el proceso host.
- **Repro**: `bun -e "import('./scripts/gates/test-all.script.ts')"`
  sale con código 1 en lugar de devolver el módulo.
- **Fix**: añadir el guard `if (import.meta.main)`; opcionalmente
  extender `lint:command-coverage` a `scripts/**/*.script.ts` para
  que no vuelva a pasar.
- **Severidad**: FATAL · **Origen**: F-L02.

#### BUG-003 [ALTO] Cuatro scanners hacen `JSON.parse(await readFile(...))` sin try/catch

- **Dónde**:
  - `packages/frameworks/scanners/fastify.scanner.ts:70`
  - `packages/frameworks/scanners/graphql.scanner.ts:63`
  - `packages/frameworks/scanners/hono.scanner.ts:71`
  - `packages/frameworks/scanners/trpc.scanner.ts:46`
- **Síntoma**: un `package.json` con BOM, comentario trailing o
  coma colgante rompe el scan con `SyntaxError: Unexpected token`
  en lugar de devolver el contrato `{ ok: false, reason }`.
- **Repro**: trashing del `package.json` de `examples/example-express`
  y ejecutar `expostman scan`.
- **Fix**: enrutar por `packages/core/helpers/parse-json.helper.ts`
  (que ya distingue "no se pudo" de "parseó a null"); los scanners
  ya usan `isRecord` / `readObject` / `readString` del mismo helper.
- **Test**: añadir un fixture por scanner con `package.json` mal
  formado y verificar que el resultado tiene `warnings` con la
  entrada malformada, no `crash`.
- **Severidad**: ALTO · **Origen**: F-L03.

#### BUG-004 [ALTO] El plugin no compila: `dist/` no se genera, `main` apunta a un fichero inexistente

- **Dónde**: `packages/plugins/mcp-vertex_expostman/package.json:22`,
  `packages/plugins/mcp-vertex_expostman/tsconfig.json:14`
- **Síntoma**: `package.json#main` es `./dist/index.js` y `files`
  incluye `dist`, pero `bun run build` (que el `scripts.build` del
  plugin define) falla con
  `TS5011: The common source directory of 'tsconfig.json' is '../..'.
  The 'rootDir' setting must be explicitly set to this or another path`
  porque `rootDir` no está fijado. El resultado es que `npm pack`
  produce un tarball con `dist/` vacío y `validate:package` no lo
  detecta (sólo prueba el paquete raíz).
- **Repro**: `cd packages/plugins/mcp-vertex_expostman && bun run build`.
- **Fix**:
  1. Fijar `rootDir` en `tsconfig.json` (a `src/`) o usar
     `outDir: "dist"` + `rootDir: "src"` (preferido).
  2. Hacer que el `validate` raíz llame `bun --cwd
     packages/plugins/mcp-vertex_expostman build` antes de los
     typechecks, o que `validate:package` también pruebe el plugin.
  3. Considerar mover `main` a `./src/index.ts` (como hace el
     paquete raíz, que apunta a `./packages/cli/cli.script.ts`).
- **Severidad**: ALTO · **Origen**: B-L01.

#### BUG-005 [MEDIO] `validate-json` regex sobre stdout del CLI: silencioso y frágil

- **Dónde**: `packages/plugins/mcp-vertex_expostman/src/lib/tools/validate.tool.ts:96-98`
- **Síntoma**: el tool parsea con
  `/Routes en source:\s+(\d+)/` el stdout del binario. Si el
  locale o la i18n cambian (cosa que `lint:output-language` ya
  está cazando en O-L01…O-L07), el regex devuelve 0 silenciosamente
  y el agente recibe `routesInSource: 0, ok: true`.
- **Repro**: `LANG=es_ES expostman check` invocado desde el tool.
- **Fix**: llamar `runCheck` en proceso (como ya hace
  `check.tool.ts`) en lugar de regex sobre stdout.
- **Severidad**: MEDIO · **Origen**: F-L05.

#### BUG-006 [MEDIO] `push` filtra detalle de error por stderr

- **Dónde**: `packages/cli/commands/push.script.ts:171-179`
- **Síntoma**: `reportApiError` escribe el body crudo de respuesta
  de Postman a stderr, que puede ser capturado por CI o por el
  scrollback del terminal. La versión redactada va al agente vía
  el contrato del plugin, pero la del CLI se va tal cual.
- **Repro**: `POSTMAN_API_KEY=invalid-key expostman push`.
- **Fix**: no escribir `err.detail` a stderr, o sanearlo (quitar
  bloque de headers de la respuesta de error).
- **Severidad**: MEDIO · **Origen**: F-L07.

#### BUG-007 [MEDIO] `bin` declara dos nombres apuntando al mismo `.ts`

- **Dónde**: `package.json:34-37`
- **Síntoma**: `npm install -g` crea dos shims al mismo fichero
  `.ts`. En algunas plataformas sólo el primero se enlaza; el
  segundo produce error de instalación silencioso.
- **Fix**: dejar uno (`expostman`); el otro nombre se puede
  mantener como alias shim explícito si hay demanda, pero ya no
  en `bin` sino en `bin/wrappers/`.
- **Severidad**: MEDIO · **Origen**: F-L08.

#### BUG-008 [MEDIO] `generate --basename` muta `process.env.POSTMAN_OUTPUT_BASENAME`

- **Dónde**: `packages/cli/commands/generate.script.ts:307` (vía
  `runGenerate`)
- **Síntoma**: dos invocaciones concurrentes (matriz CI) se pisan
  el env global; la segunda ve el valor de la primera.
- **Repro**: `expostman generate --basename a & expostman generate --basename b &`.
- **Fix**: pasar el basename por argumento al helper que lo lee
  (no usar `process.env` como variable global).
- **Severidad**: MEDIO · **Origen**: F-L09.

#### BUG-009 [MEDIO] `runner.helper.ts` lee `process.cwd()` / `process.env` sin gate

- **Dónde**:
  `packages/plugins/mcp-vertex_expostman/src/lib/helpers/runner.helper.ts:77,104,134,142,148,218,237`
- **Síntoma**: el gate `lint:tools` (heredado de p00011) sólo
  vigila `*.tool.ts`. El helper del plugin lee el mismo estado de
  proceso, lo cual está vetado por el universal §6 pero no se
  enforza en helpers. Tests bajo Node (vitest) ven `Bun.spawn`
  caer a `process.cwd()` sin que el gate lo diga.
- **Fix**: extender el glob del gate a `src/lib/{tools,helpers}/**`
  y/o exigir que el helper reciba `ctx` por parámetro.
- **Severidad**: MEDIO · **Origen**: G-L01.

#### BUG-010 [MEDIO] `lint:command-coverage` excluye `scripts/build/`

- **Dónde**: `scripts/gates/lint-command-coverage.script.ts:15,35-39`
- **Síntoma**: el gate sólo cubre `packages/cli/commands/`. Los 6
  scripts de `scripts/build/` (api-reference, changelog,
  desktop-build, frameworks-table, build-binary, ui-dev) tienen
  el mismo riesgo que BUG-002, sin gate.
- **Fix**: extender el patrón a `**/*.script.ts` bajo `scripts/`
  y `packages/`.
- **Severidad**: MEDIO · **Origen**: G-L06.

#### BUG-011 [BAJO] `validate-json` valida `req.url` con regex rígida

- **Dónde**: `packages/cli/commands/validate-json.script.ts:107`
- **Síntoma**: muchos `PostmanItem` válidos tienen `url` como
  array (`{protocol, host, path, query, variable}`). El validador
  los marca como inválidos cuando son perfectamente válidos.
- **Fix**: relajar la condición de `url` para que acepte ambas
  formas (string estructurado y objeto).
- **Severidad**: BAJO · **Origen**: F-L17.

#### BUG-012 [BAJO] `dry-run` no expone `frameworks[]` aunque `frameworks` ya es un array

- **Dónde**: `packages/cli/commands/ui.script.ts:96-99`
- **Síntoma**: la respuesta del dry-run lleva `framework` (el
  ganador) pero no `frameworks[]` (todos los que coincidieron).
  En proyectos híbridos (Express + OpenAPI spec) el usuario sólo
  ve uno.
- **Fix**: añadir `frameworks: readonly string[]` al contrato de
  `IPlanDryRunResult` y propagarlo en UI.
- **Severidad**: BAJO · **Origen**: F-L15.

#### BUG-013 [BAJO] `NAMESPACE = "postman"` muerto en el plugin

- **Dónde**:
  `packages/plugins/mcp-vertex_expostman/src/lib/contracts/namespace.ts:18`
- **Síntoma**: el `AGENT-BOOTSTRAP.md` (en §3.1) dice que el
  constante fue retirado en el audit 2026-08-08, pero sigue
  exportado y el grep confirma cero usos. La doc miente sobre el
  código.
- **Fix**: borrar el fichero `namespace.ts` y la referencia
  residual, o documentar de verdad que es el contrato interno.
- **Severidad**: BAJO · **Origen**: N-L02 / N-L10.

#### BUG-014 [BAJO] `bin/expostman` no verifica versión en caché

- **Dónde**: `bin/expostman:36` y `bin/expostman.ps1:10`
- **Síntoma**: el binario cacheado en `~/.expostman/expostman` no
  tiene `--version`, ni checksum, ni TTL. Un usuario con
  versión vieja cree que la herramienta está actualizada.
- **Fix**: comparar `dist/VERSION` contra un `MIN_VERSION` del
  launcher y re-fetch cuando difiera.
- **Severidad**: BAJO · **Origen**: F-L14.

### 4.2 Features (lo que el producto debería tener)

#### FEAT-001 [P1] UI multi-proyecto

- Dashboard con lista de proyectos analizados recientemente, su
  framework, número de endpoints, y enlace al export más reciente.
- Persistencia en `~/.expostman/history.json`.
- **Origen**: N-U05.

#### FEAT-002 [P1] Explicador "por qué detecté X"

- Cuando el orquestador elige un framework, mostrar el desglose
  de puntuación por detector (Express: 0.95 porque `package.json`
  tiene `express` en deps + `app.use(router)` en código; Laravel:
  0.4 porque sólo `artisan` existe).
- **Origen**: L-U03.

#### FEAT-003 [P1] Sistema de mejoras en la UI

- "Health score" por proyecto: % de rutas con validación, % con
  ejemplo de body, % con descripción.
- Lista accionable de "X% de tus rutas POST no declaran body
  schema — añade un `// @example` y reintenta".
- **Origen**: I-U01.

#### FEAT-004 [P1] Diff visual en UI entre dos exports

- Comparar export actual contra el anterior; resaltar añadidos,
  borrados y modificados en una vista de árbol.
- **Origen**: V-U07.

#### FEAT-005 [P2] Tool MCP `format` (Postman → OpenAPI / Bruno / Insomnia / HAR)

- Input: `{ projectRoot, sourceFormat, sourcePath, targetFormat }`
- Output: `{ ok, targetPath, warnings, durationMs }`
- **Origen**: M-L01.

#### FEAT-006 [P2] Tool MCP `preflight` (¿qué generaría?)

- Más barato que `scan + summary`. Útil para schedulers.
- **Origen**: M-L04.

#### FEAT-007 [P2] Tool MCP `list-frameworks`

- Catálogo declarativo de frameworks soportados, con alias,
  lenguajes y confianza mínima.
- **Origen**: M-L05.

#### FEAT-008 [P2] Tutorial / onboarding en UI

- Primera vez: tour de 4 pasos con ejemplos reales de los 21
  proyectos de `examples/`.
- **Origen**: I-U05.

#### FEAT-009 [P2] Detección de proyecto híbrido en UI

- Si dos scanners puntúan alto, mostrar los dos y dejar al
  usuario elegir cuál pesa más (merge opcional).
- **Origen**: L-U02.

#### FEAT-010 [P3] Auto-detección mejorada con archivos no estándar

- Buscar también `wrangler.toml` (Cloudflare Workers),
  `serverless.yml`, `vercel.json`, etc. y mapearlos a framework
  conocido.
- **Origen**: L-U07.

### 4.3 Refactors

#### REF-001 [P1] Mover `paths.service.ts` a contexto inyectable (cierra F-006 de a00008)

- Eliminar el singleton a nivel de módulo (cache + cola) y
  pasarlo por `IProjectContext`. Cada llamada resuelve sin estado.
- **Origen**: a00008 F-006 (sigue abierto).

#### REF-002 [P2] Quitar el módulo `namespace.ts` muerto

- Borrar el fichero y dejar el bootstrap limpio.
- **Origen**: BUG-013.

#### REF-003 [P2] Mover `JSON.parse` de scanners al helper `parse-json.helper.ts`

- Sustituir las 4 ocurrencias. Una sola fuente de verdad.
- **Origen**: BUG-003.

### 4.4 Tests

#### TEST-001 [P1] Cubrir `generate --open` (cierra BUG-001)

- Mockear `runOpenPostman` y verificar invocación con
  `--file <OUTPUT_PATH>`.
- **Origen**: T-L01 / BUG-001.

#### TEST-002 [P1] Cubrir `generate --basename`

- Verificar que el nombre de salida respeta el flag.
- **Origen**: T-L02 / BUG-008.

#### TEST-003 [P1] Cubrir `watch --inspect` (cuando se implemente)

- (Pendiente de FEAT para `--inspect`).

#### TEST-004 [P1] Cubrir `interactive.script.ts` (wizard)

- Sin spec dedicada hoy (T-L12).
- **Origen**: T-L12.

#### TEST-005 [P1] Cubrir `withTypecheck: false` en `test.tool`

- Sólo se cubre `withTypecheck: true` (T-L13).
- **Origen**: T-L13.

#### TEST-006 [P2] Cubrir las 4 rutas de `toolError` en los 7 tools del plugin

- T-L10. Hoy sólo se cubren los happy paths.

#### TEST-007 [P2] Cubrir la rama "identity clash" de `generate`

- T-L14. La rama existe pero no se ejecuta.

### 4.5 Lints / gates nuevos

#### LINT-001 [P1] Extender `lint:tools` a `src/lib/{tools,helpers}/**`

- Cierra BUG-009.
- **Origen**: G-L01.

#### LINT-002 [P1] Añadir `lint:no-raw-json-parse` en user-data paths

- Cierra BUG-003 de raíz.
- **Origen**: G-L03.

#### LINT-003 [P1] Añadir `lint:no-readfilesync-in-hot-paths`

- Aplica el universal §6 "Async I/O only in hot paths; `*Sync` is
  boot-time only" con un AST grep.
- **Origen**: G-L04.

#### LINT-004 [P1] Extender `lint:command-coverage` a `scripts/**/*.script.ts`

- Cierra BUG-002 de raíz y BUG-010.
- **Origen**: G-L06.

#### LINT-005 [P2] `lint:docs` debe verificar también los MCP tool names

- G-L07.

#### LINT-006 [P2] `lint:env-docs` (toda `process.env["FOO"]` debe aparecer en INSTALL/README)

- G-L08.

#### LINT-007 [P2] `lint:mcp-surface` debe verificar `ok: z.literal(true)` en schemas de éxito

- G-L09.

### 4.6 Docs

#### DOC-001 [P1] Documentar `POSTMAN_API_KEY` en INSTALL.md

- Cierra D-L03.

#### DOC-002 [P1] Añadir troubleshooting al README

- D-L07.

#### DOC-003 [P2] Documentar efectos (`spawn`, `write`, `network`) en MCP-SURFACE.md

- D-L02.

#### DOC-004 [P2] `docs/INSTALL.md` debe explicar `--version` y el TTL de caché

- D-L13 / BUG-014.

## 5. Top 5 prioridades

Ordenadas por impacto, coste y reversibilidad:

1. **BUG-001** + **TEST-001** (slice `x00010`): `--open` roto es el
   defecto de UX más visible — el usuario lo ve al primer
   `--open`.
2. **BUG-002** + **BUG-010** + **LINT-004** (slice `x00011`): gate
   roto es el mismo defecto que ya cazamos en CLI; extenderlo a
   `scripts/` previene que vuelva.
3. **BUG-003** + **REF-003** + **LINT-002** (slice `x00012`): 4
   `JSON.parse` sin try/catch son el mismo bug en 4 sitios;
   resolverlo con un helper + un lint es el cierre definitivo.
4. **BUG-004** (slice `x00013`): el plugin no compila; la pieza
   más barata de corregir (un `rootDir` en el tsconfig) y la que
   tiene más impacto en distribución.
5. **BUG-009** + **LINT-001** (slice `x00014`): el plugin lee
   `process.cwd()` desde un helper; el gate debe cubrirlo y el
   helper debe recibir contexto.

Los FEAT y REF se abordarán después de cerrar los BUG en sus
respectivas slices.

## 6. Cómo se ejecutará

Las propuestas derivadas se crean en `ready/` con id correlativo
(`x00010` para slice de BUG-001, etc.), se cierran con sus tests
focalizados, y se commitean con el patrón Conventional Commits
visto en `a00008` y `x00008` (un commit por slice, push directo a
`develop` por el agente).

Cuando todas las `x0001x` estén `done`, esta auditoría se cierra
y se archiva en `done/audits/`. El backlog vivo se queda en
`ready/` (FEAT y REF) para siguientes pasadas.
