---
id: b00001
title: "rebrand Tanit — el proyecto pasa de export-to-postman a Tanit (API Source Discovery)"
kind: breaking
status: done
type: proposal
track: api-source-tanit
date: 2026-09-04
shippedIn:
  - 25a111c  # S1: TS source code rename
  - be7c3e7  # S2: plugin folder rename delendai_expostman -> delendai_tanit
  - 04049f1  # S3: binaries + desktop + docker + CI
  - abc6b91  # S4: root package.json -> api-source-tanit v1.0.0 + bun.lock
  - dde37f1  # S5: docs + host pointers
  - 66ca1e2  # S6: examples + output folder verification
  - 6c3754e  # S7: proposals hygiene + AGENT-BOOTSTRAP archaeology note
  - 151886f  # merge into develop + push + gh repo rename + topics
shippedIn:
  - 536608a  # cierre administrativo (x00032 S1 regla 2): SHA de creación del registro
---

# b00001 — rebrand Tanit — el proyecto pasa de export-to-postman a Tanit (API Source Discovery)

## Goal

Renombrar el proyecto entero a Tanit — la marca visible, el paquete npm, el bin CLI, el plugin MCP, la carpeta de salida, las variables de entorno, el repositorio y la documentación — para que el nombre deje de describir una sola función (“exportar a Postman”) y pase a describir la categoría completa (“API Source Discovery”). Sin shims de compatibilidad: ruptura limpia, version major, deuda de aliases nula.

## why

El proyecto ha dejado de ser “un exportador a Postman” y es un motor de descubrimiento de APIs desde código fuente (21 frameworks soportados, plugin MCP propio, UI web, instalador nativo). El nombre actual:

- Limita el producto a Postman. Ya hay exportadores a HAR e Insomnia, y pronto a OpenAPI, Bruno, Scalar. Cada nuevo exportador arrastra el lastre del nombre viejo.
- Es kilométrico en CLI, npm, scripts y conversación oral: 17 caracteres (`export-to-postman`) frente a los 6-8 que necesita una herramienta Unix memorable.
- Ya ha sido corregido una vez por p00025 (bin corto `expostman`) pero sigue anclado en “Postman”. La decisión de marca quedó a medio camino.
- Compite en Google y npm con docenas de “postman-export”, “postman-generator” etc.; el SEO/GH-discovery lo pierde antes de que el usuario lo encuentre.

La decisión, tomada en conversación 2026-09-04 con el dueño del repo y validada por la búsqueda de colisiones:

| Capa | Antes | Después |
|---|---|---|
| Marca visible (UI, README, docs) | “Export to Postman” | **TANIT** |
| Descriptor / tagline | (implícito) | **API Source Discovery** |
| Nombre técnico completo (paquete npm) | `export-to-postman` | **`api-source-tanit`** (sin scope, matches el repo) |
| Repositorio GitHub | `CartagoGit/export-to-postman` | **`CartagoGit/api-source-tanit`** |
| Binario CLI | `expostman` (9 ch) | **`apisrc`** (6 ch) |
| Plugin MCP | `delendai_expostman` | **`delendai_tanit`** |
| Tools cualificados | `delendai_expostman_*` | **`delendai_tanit_*`** |
| Carpeta de salida | `export-to-postman/` | **`tanit/`** |
| Directorio de config | `~/.config/expostman/`, `~/.expostman/` | **`~/.config/tanit/`**, `~/.tanit/`** |
| Config dotfile en proyecto | `.expostmanrc.json` | **`.tanitrc.json`** |
| Variables de entorno | `EXPOSTMAN_*` | **`TANIT_*`** |
| App identifier Tauri | `dev.cartago.expostman` | **`dev.cartago.tanit`** |
| Tag de colección Postman | `creator.name = "export-to-postman"` | **`creator.name = "tanit"`** |
| Track de propuestas (nuevas) | `track: export-to-postman` | **`track: api-source-tanit`** |

Decisiones tomadas por defecto (no preguntadas al dueño porque contestó “tú decides”):

- **NPM**: `api-source-tanit` (sin scope). Matches el repo y evita la fricción de los scopes en npm install. Si más adelante hace falta partirlo en `@api-source-tanit/cli` + `@api-source-tanit/desktop`, se levanta con `p00008` cuando se publique.
- **Output dir**: `tanit/`. Brand-first, corto, sin colisión con `build/` ni `dist/` de los frameworks.
- **Sin aliases deprecados**: ruptura limpia, major bump 0.1.0 → 1.0.0. El paquete no estaba publicado en npm, así que el coste de compatibilidad es ~0.
- **Workspace folder rename**: manual por el dueño, fuera de los slices. Riesgo explícito de perder conversaciones linkadas en VSCode/Claude (flagged por el dueño).
- **GitHub repo rename**: orquestado por el agente con `gh repo rename` (token disponible). Después del rename, GitHub redirige automáticamente el nombre viejo.
- **`p00025` queda parcialmente superado**: la decisión `expostman` se mantiene en arqueología; este PR la sustituye en la práctica pero no se reabre.

Las propuestas históricas (p00001–p00043, x00001–x00025, a00001–a00016, etc.) **conservan** `track: export-to-postman` como arqueología. Renombrar su `track` rompería URLs inmutables del repo sin aportar nada legible; sólo cambia el README de `docs/delendai/proposals/README.md` para explicar el corte.

## non-goals

- **No publicar a npm en este PR.** El paquete sigue sin estar en el registry; este rebrand deja todo listo para que `p00008` (publish) lo levante cuando toque.
- **No rehacer la decisión de marca.** Tanit viene decidido por el dueño en conversación 2026-09-04 (pegado en `AGENTS.md`/`affairs`); este slice ejecuta la decisión, no la renegocia.
- **No rehacer la arquitectura.** El layout `packages/{cli,contracts,core,frameworks,ui,plugins/...}`, `scripts/{gates,build}`, `examples/`, `tests/` y `docs/delendai/` se queda. Sólo cambia lo que el rename toca.
- **No tocar la lógica de los 21 scanners.** Ni la del CLI, ni la de los exporters (HAR, Insomnia), ni la del pipeline de discovery. Es estrictamente renombrado, no refactor de comportamiento.
- **No mantener aliases deprecados.** Cero `expostman`, cero `export-to-postman` en el código vivo. Quien los necesite, lee CHANGELOG.md y migra.
- **No renombrar la carpeta del workspace.** Eso lo hace el dueño a mano después de cerrar la propuesta, por el riesgo explícito de perder conversaciones linkadas de VSCode/Claude.

## Slices

- global_gate: e2e

> **Ejecución secuencial.** Aunque los archivos son disjuntos entre S1–S7, comparten el `bun.lock`, el `package.json` raíz y la build de TS: un `bun run typecheck` roto entre slices dejaría el host MCP sin boot. `delendai.config.json` tiene `agentWorktree: false`, así que no hay worktrees paralelos. El orchestrator dispatcha un `implementation_runner` por slice en orden S1 → S7; S8 (GitHub) lo cierra él mismo tras S7.

### S1 — Source code TS (no plugin, no desktop)
- **Status**: done (cierre administrativo: el SHA de shippedIn documenta el momento en que se cerró la propuesta)
- **Files**:
  - `packages/cli/**`
  - `packages/contracts/**`
  - `packages/core/**`
  - `packages/ui/**`
- **Gate**: type
- **Renombres clave** (los que no son `s/.../...` mecánico):
  - `OUTPUT_DIR_NAME` en `packages/contracts/constants/core/postman.constant.ts`: `"export-to-postman"` → `"tanit"` (y reescribir el comentario de 7 líneas que justifica el nombre).
  - `~/.config/expostman` → `~/.config/tanit` en `packages/ui/config-dir.helper.ts`, `packages/ui/history-paths.helper.ts`, `packages/ui/server/history.service.ts`.
  - `~/.expostman/history.jsonl` → `~/.tanit/history.jsonl` en `packages/ui/server/history.service.ts`, `packages/contracts/interfaces/runtime.d.ts`, `packages/contracts/constants/cli/history.constant.ts`.
  - `EXPOSTMAN_*` → `TANIT_*` en cualquier flag/env (buscar con `grep -rEn 'EXPOSTMAN' packages/`).
  - `creator: { name: "export-to-postman", version: "1.0.0" }` → `creator: { name: "tanit", version: "1.0.0" }` en `packages/core/exporters/har.exporter.ts` y todos los exporters.
  - `__export_source: "export-to-postman"` → `__export_source: "tanit"` en `packages/core/exporters/insomnia.exporter.ts`.
  - `// Generado por export-to-postman. Se puede editar: no se …` → `// Generado por Tanit. Se puede editar: no se …` en `packages/core/domain/test-script.service.ts` (regenerar el `.js` built).
  - Headers de doc y comentarios que mencionen el proyecto: pasada sistemática.
  - `export-to-postman generate …` en docstrings/helps → `apisrc generate …`.
  - `.expostmanrc.json` → `.tanitrc.json` en menciones (futuro feature de p00042, ver `packages/core/discovery/project-loader.service.ts:296`).
- **acceptance**:
  - `grep -rEln '(export-to-postman|expostman|Expostman|ExportToPostman|EXPOSTMAN|\.expostmanrc)' packages/cli packages/contracts packages/core packages/ui` devuelve lista vacía.
  - `bun run typecheck` pasa en verde.
  - `bun run test` pasa (todos los specs no-plugin).
  - `bun run lint:contracts` y `bun run lint:boundaries` pasan.
  - El artefacto built `packages/core/domain/test-script.service.js` está regenerado (output del script anterior) o ya no existe (no se commitea, lo verifica el `.gitignore`).

### S2 — Plugin folder rename + namespace + tipos
- **Status**: done (cierre administrativo: el SHA de shippedIn documenta el momento en que se cerró la propuesta)
- **dependsOn**: S1
- **Files**:
  - `packages/plugins/delendai_expostman/**` (carpeta entera) → renombrada vía `git mv` a `packages/plugins/delendai_tanit/**`.
  - `package.json` raíz: `workspaces` array actualizado.
  - `delendai.config.json`: clave `"plugins.expostman"` → `"plugins.tanit"` y `path` apunta a la nueva carpeta.
- **Gate**: type
- **Renombres clave dentro del plugin**:
  - Cada `*.tool.ts` (10 ficheros): campo `id: "expostman_<verb>"` → `id: "tanit_<verb>"` en el `IToolRegistration`. El host compone el cualificado como `${ctx.namespacePrefix}_${id}` → pasa de `delendai_expostman_generate` a `delendai_tanit_generate`.
  - `src/index.ts`: `definePlugin({ name: "expostman", ... })` → `name: "tanit"`. Reescribir el doc-comment del header que lista los 10 tools.
  - `src/lib/contracts/plugin.interface.ts`: `ExportToPostmanOptionsSchema` → `TanitOptionsSchema`. Tipo inferido `z.infer<typeof TanitOptionsSchema>` y exportado.
  - Toda mención `ExportToPostman*` en `src/`, `tests/`, `README.md` → `Tanit*` (PascalCase preservado en los tipos; los tipos heredan el prefijo `Tanit`).
  - `src/lib/contracts/namespace.ts`: cualquier constante `EXPOSTMAN` → `TANIT`.
  - `src/lib/helpers/runner.helper.ts`: paths a binarios `expostman` → `apisrc`.
  - `tests/helpers/plugin-context.ts`: `NAMESPACE_PREFIX = "expostman"` → `NAMESPACE_PREFIX = "tanit"`.
  - `tests/integration/*.spec.ts` y `tests/unit/*.spec.ts`: actualizar aserciones que pinchen el nombre viejo (10 specs).
  - `README.md` interno del plugin reescrito con el nombre nuevo (este README no se publica porque el plugin es `"private": true`).
- **acceptance**:
  - `git mv` ejecutado, no `rm` + `add` (historial preservado: `git log --follow packages/plugins/delendai_tanit/README.md` debe seguir a su autor original).
  - `bun run --cwd packages/plugins/delendai_tanit typecheck` pasa.
  - `bun run --cwd packages/plugins/delendai_tanit test` pasa los 10 specs del plugin.
  - `bun run test` global pasa (cubre los tests que importan el plugin).
  - `bun run lint:mcp-surface` pasa (verifica que los cualificados `delendai_tanit_*` están declarados y que el `id` corto no usa prefijos prohibidos).
  - `delendai.config.json#plugins.tanit.path` apunta a `packages/plugins/delendai_tanit/src/index.ts`.
  - `grep -rEln '(expostman|Expostman|ExportToPostman)' packages/plugins/delendai_tanit delendai.config.json package.json` devuelve lista vacía.

### S3 — Binarios, desktop, docker, CI
- **Status**: done (cierre administrativo: el SHA de shippedIn documenta el momento en que se cerró la propuesta)
- **dependsOn**: S1, S2
- **Files**:
  - `bin/expostman` → `bin/apisrc`
  - `bin/expostman.ps1` → `bin/apisrc.ps1`
  - `bin/wrappers/expostman.py` → `bin/wrappers/apisrc.py`
  - `bin/wrappers/Expostman.php` → `bin/wrappers/apisrc.php`
  - `packages/desktop/Cargo.toml`
  - `packages/desktop/Cargo.lock`
  - `packages/desktop/tauri.conf.json`
  - `packages/desktop/src/main.rs`
  - `.docker/Dockerfile`
  - `.docker/docker-compose.yml`
  - `.docker/README.md`
  - `.github/workflows/release-binaries.yml`
  - `.github/workflows/release-desktop.yml`
  - `.github/dependabot.yml` (comentario que nombra el plugin)
- **Gate**: lint
- **Renombres clave**:
  - Binarios: `git mv` preserva histórico. Contenido interno: las rutas a TS entrypoint (`./packages/cli/cli.script.ts`), los comentarios de cabecera y los docstrings pasan a usar `apisrc` y `Tanit`.
  - Desktop: `name = "expostman-desktop"` → `name = "tanit-desktop"` en `Cargo.toml` y `Cargo.lock`. Producto Tauri y binario embebido: el app es **Tanit** (brand) y ejecuta el bin **apisrc** dentro, así que `tauri.conf.json#identifier` pasa a `dev.cartago.tanit`, el `productName` a `Tanit`, y el sidecar de Tauri se llama `tanit-<target-triple>` (no `apisrc-<...>`) porque para el usuario final el app es Tanit. Documentar este matiz en `docs/DESKTOP-PUBLISH.md`.
  - Docker: `--outfile /out/expostman` → `--outfile /out/apisrc` (porque lo que se distribuye es el bin CLI). `name: expostman` en compose → `name: apisrc`. El nombre del servicio contenedor sigue siendo `tanit` para alinear con el desktop.
  - CI: `dist/expostman-*` → `dist/apisrc-*` en `release-binaries.yml`. `EXPOSTMAN_BUNDLES` → `TANIT_BUNDLES` en `release-desktop.yml`.
- **acceptance**:
  - `grep -rEln '(expostman|Expostman|EXPOSTMAN)' bin/ packages/desktop/ .docker/ .github/ scripts/` devuelve lista vacía.
  - `bun run lint:tools` pasa (los wrappers no leen `process.cwd`).
  - Los scripts de build invocan `bun build` con `--outfile` apuntando a `apisrc` o `tanit-desktop` según corresponda.

### S4 — Root config + lockfile
- **Status**: done (cierre administrativo: el SHA de shippedIn documenta el momento en que se cerró la propuesta)
- **dependsOn**: S1, S2, S3
- **Files**:
  - `package.json` (raíz)
  - `bun.lock`
  - `tsconfig.json`, `tsconfig.base.json`, `tsconfig.cli.json`, `tsconfig.contracts.json`, `tsconfig.core.json`, `tsconfig.frameworks.json`
  - `vitest.config.ts`
  - `.gitignore`
  - `.dockerignore`
  - `.npmignore` (si existe; si no, skip)
- **Gate**: type
- **Renombres clave en `package.json`**:
  - `name`: `"export-to-postman"` → `"api-source-tanit"` (sin scope npm: el repo es `api-source-tanit`, el paquete es `api-source-tanit`, el path de import es `api-source-tanit/core`).
  - `version`: `"0.1.0"` → `"1.0.0"` (major bump por breaking change de superficie pública).
  - `description`: reescrita — empieza por "Tanit", menciona "API Source Discovery", cita los 21 frameworks.
  - `keywords`: añadir `tanit`, `api-source`, `discovery`, `source-code-analysis`; mantener los legacy un ciclo (`postman`, `collection`, `generator`, `openapi`) por discoverability en npm search.
  - `bin`: `{"expostman": ...}` → `{"apisrc": ...}`. Borrar la entrada `export-to-postman`.
  - `main` / `module` / `exports["."]` / `exports["./core/*"]` / `exports["./frameworks"]`: los paths no cambian (siguen apuntando a `./packages/...`), sólo el nombre del paquete los afecta vía el lockfile.
  - `files`: añadir `"!packages/plugins/delendai_tanit/"` (renombrado en S2).
  - `repository.url`: `git+https://github.com/CartagoGit/export-to-postman.git` → `git+https://github.com/CartagoGit/api-source-tanit.git`.
  - `homepage` y `bugs.url`: análogamente al repo.
  - `workspaces`: `["packages/plugins/delendai_expostman"]` → `["packages/plugins/delendai_tanit"]`.
- **acceptance**:
  - `bun install` regenera `bun.lock` sin warnings.
  - `git diff --stat bun.lock` muestra cambios coherentes (paquete renombrado, versiones internas estables).
  - `.gitignore` contiene `tanit/` (no `export-to-postman/`) en la sección de output.
  - `.dockerignore` contiene `tanit/` y NO `export-to-postman/`.
  - `bun run typecheck` pasa con el `package.json` y `bun.lock` nuevos.
  - `tsconfig.*.json` no requieren edits estructurales: sus `paths` y `references` apuntan a carpetas dentro de `packages/`, no al nombre del paquete. Si alguno hace referencia al nombre, ajustarlo en este slice.

### S5 — Documentación de usuario y pointers de host
- **Status**: done (cierre administrativo: el SHA de shippedIn documenta el momento en que se cerró la propuesta)
- **dependsOn**: S1, S2, S3, S4
- **Files**:
  - `README.md`
  - `CHANGELOG.md`
  - `CONTRIBUTING.md`
  - `docs/API.md`
  - `docs/INSTALL.md`
  - `docs/POSTMAN.md`
  - `docs/FRAMEWORKS.md`
  - `docs/UI.md`
  - `docs/DESKTOP-INSTALL.md`
  - `docs/DESKTOP-PUBLISH.md`
  - `docs/NAMING.md`
  - `docs/MCP-SURFACE.md`
  - `AGENTS.md`
  - `CLAUDE.md`
  - `.github/copilot-instructions.md`
  - `.github/agents.md`
  - `.github/agents/{orchestrator,proposal_guardian,implementation_runner,delivery_verifier,technical_investigator}.agent.md`
  - `.claude/agents/{orchestrator,proposal_guardian,implementation_runner,delivery_verifier,technical-investigator}.md`
  - `examples/README.md`
- **Gate**: lint
- **Renombres clave**:
  - `README.md`: título pasa de `# Export to Postman` a `# Tanit`. Subtítulo: `**API Source Discovery** — descubre tu API desde el código fuente, genera artefactos y sincroniza con Postman y otros.` Cualquier `bun add -g github:CartagoGit/export-to-postman` → `bun add -g github:CartagoGit/api-source-tanit`. Comandos `expostman …` → `apisrc …`. La sección "Qué genera" cambia el árbol de `export-to-postman/` a `tanit/`.
  - `CHANGELOG.md`: añade entrada al tope — `## 1.0.0 (2026-09-04) — Renamed to Tanit`. Resume los renames. Las entradas anteriores quedan intactas como arqueología.
  - `docs/INSTALL.md`: install command, output dir, env vars, dotfile de proyecto.
  - `docs/POSTMAN.md`: nombre de la carpeta de salida por defecto.
  - `docs/FRAMEWORKS.md`: ejemplos de invocación del CLI con `apisrc generate --project-root … --framework …`.
  - `docs/UI.md`: `expostman ui` → `apisrc ui`, descripción del puerto.
  - `docs/DESKTOP-INSTALL.md` / `docs/DESKTOP-PUBLISH.md`: referencias al identificador Tauri y al nombre del bundle.
  - `docs/NAMING.md`: añadir un párrafo final que documente la decisión Tanit + el puntero a b00001 (esta propuesta) y a p00025 (precedente).
  - `docs/MCP-SURFACE.md`: lista de tools cualificados `delendai_expostman_*` → `delendai_tanit_*`. Plugin key `expostman` → `tanit`.
  - `AGENTS.md` / `CLAUDE.md` / `.github/copilot-instructions.md`: el título cambia a `# … — \`@api-source-tanit/core\`` (o el nombre definitivo que decida S4). El cuerpo del pointer no cambia — sigue apuntando a `docs/delendai/AGENT-BOOTSTRAP.md`.
  - `.github/agents/*` y `.claude/agents/*`: descripción cambia de `Bounded subagent for @export-to-postman/core.` a `Bounded subagent for @api-source-tanit/core.`. El cuerpo (que es un pointer) no cambia.
- **acceptance**:
  - `grep -rEln '(export-to-postman|expostman|Expostman|ExportToPostman|EXPOSTMAN)' README.md CHANGELOG.md CONTRIBUTING.md docs/ AGENTS.md CLAUDE.md .github/ examples/README.md` devuelve **sólo** matches dentro de `CHANGELOG.md` que sean entradas explícitamente marcadas como históricas (sección `## Historial` o `<a id="historical">`).
  - `bun run lint:docs` pasa (link-check incluido).
  - `bun run lint:proposals` pasa (no toca propuestas, pero valida que el link a esta propuesta desde otros sitios sigue vivo).

### S6 — Examples y carpeta de salida
- **Status**: done (cierre administrativo: el SHA de shippedIn documenta el momento en que se cerró la propuesta)
- **dependsOn**: S1, S2, S3, S4, S5
- **Files**:
  - `export-to-postman/` (carpeta entera) → renombrada vía `git mv` a `tanit/` (es el output commiteado de `example-app` y `sample-express`; se regenera limpio en este slice).
  - `examples/README.md` (puede solapar con S5 si quedó algo).
  - `examples/example-app/config.constant.ts` (si menciona el bin).
  - `examples/example-app/endpoints.constant.ts` (si menciona el bin).
  - Cualquier otro ejemplo que referencie el CLI por nombre.
- **Gate**: e2e (`bun run validate:examples`)
- **acceptance**:
  - `git mv export-to-postman tanit` ejecutado. Tras la regeneración por el gate, `tanit/` contiene exactamente las mismas piezas que `export-to-postman/` contenía, pero generadas con el bin nuevo.
  - `bun run validate:examples` regenera los 21 ejemplos y valida cada colección en verde.
  - `grep -rEln '(export-to-postman/|expostman generate)' examples/` devuelve sólo menciones que apunten a `tanit/` o `apisrc generate`.
  - El script de e2e no contiene referencias hardcoded al nombre viejo.

### S7 — Higiene de propuestas + validate gate final
- **Status**: done (cierre administrativo: el SHA de shippedIn documenta el momento en que se cerró la propuesta)
- **dependsOn**: S1, S2, S3, S4, S5, S6
- **Files**:
  - `docs/delendai/proposals/README.md` (header + nota arqueológica).
  - `.cache/delendai/proposals/index.json` (auto-regenerado por `lint:proposals`).
  - Cero ediciones a `docs/delendai/proposals/done/**` ni `ready/**` históricos (el `track` queda como está; arqueología es ley).
- **Gate**: e2e (`bun run validate` y `bun run validate:package`)
- **acceptance**:
  - `docs/delendai/proposals/README.md` arranca con un epígrafe `## Nota 2026-09-04 — rebrand a Tanit` que explica arqueología vs track nuevo.
  - `bun run lint:proposals` regenera el índice en `.cache/delendai/proposals/index.json` y pasa.
  - `bun run validate` está **completamente verde**: typecheck + lint:tools + lint:contracts + lint:boundaries + lint:proposals + test:coverage + validate:examples + bench:check.
  - `bun run validate:package` empaqueta, instala en `tests/fixtures/clean-install/` y ejecuta `apisrc --help` y `apisrc generate` contra `examples/example-express/`. Devuelve exit 0.
  - `bun run desktop:build:linux` (o el que aplique al host) produce un bundle con `tanit-desktop` como crate y `apisrc` como sidecar.

## Execution plan

1. **Orchestrator** abre esta propuesta en `ready/breakings/` y la deja como `status: ready`. Espera aprobación del dueño.
2. **Aprobación**: el dueño revisa el documento (sobre todo la tabla de renames y los defaults que tomé yo). Si hay cambios en defaults, se editan aquí antes de dispatchar.
3. **Dispatch S1**: `proposal_delegate` con un `implementation_runner`. Toma lock de los ficheros de S1, ejecuta, valida (`bun run typecheck && bun run test && bun run lint:contracts && bun run lint:boundaries`), pida peer review, cierra slice.
4. **Dispatch S2–S6** en orden. Cada uno pide review al `delivery_verifier`. Mientras no esté aprobado, el siguiente slice espera.
5. **Dispatch S7**: full validate + validate:package. Si hay regresión, abrir un fix (`x00026` o el id que asigne `create_proposal`).
6. **External ops (S8)** — fuera del flujo de slices, porque no toca ficheros del repo:
   1. Commit todo el trabajo de S1–S7 en una rama `rebrand/tanit` con commit message Conventional Commits `feat!: rename to Tanit` (breaking) y push al fork/origin del dueño.
   2. `gh repo rename CartagoGit/export-to-postman CartagoGit/api-source-tanit --confirm` (token con scope `repo`).
   3. Actualizar descripción, topics y "About" del repo vía `gh repo edit --description "… API Source Discovery …"` y `--add-topic tanit,api-source,postman,laravel,fastapi,express`.
   4. Borrar la rama `rebrand/tanit` local si la integración fue directa, o dejar un PR abierto para revisión humana si la política lo exige.
   5. **Pausa para el dueño**: el rename de la carpeta del workspace (`/home/cartago/_projects/export-to-postman` → `/home/cartago/_projects/api-source-tanit`) lo hace él a mano. La sesión de VSCode abierta se quedará con la carpeta vieja hasta que se cierre; las conversaciones linkadas al path pueden romperse, como flagged.
7. **Cerrar la propuesta**: `proposal_transition` a `done` con la nota de cierre describiendo los renames finales.

## Risks

1. **Pérdida de contexto de VSCode/Claude al renombrar la carpeta.** Flagged por el dueño. Mitigación: el orchestrator no renombra la carpeta; el dueño la renombra cuando quiera cerrar la sesión. El path en `.code-workspace` (si existe) y en la configuración del host debe actualizarse a mano tras el rename.
2. **Plugin load roto a medio slice.** Si S2 falla partway, el host puede no bootear. Mitigación: S2 corre `bun run --cwd packages/plugins/delendai_tanit typecheck && bun run --cwd packages/plugins/delendai_tanit test` antes de cerrar; si no pasa, el slice queda abierto y el host sigue con la versión vieja hasta que el agent reintente.
3. **`gh repo rename` falla por permisos.** Mitigación: el orchestrator reporta el comando exacto y el dueño lo corre a mano si el token no tiene `repo:admin`.
4. **`bun.lock` queda desincronizado.** Mitigación: S4 corre `bun install` y commitea el lockfile regenerado.
5. **Arqueología rota.** Renombrar el `track` de las propuestas históricas (`p00001`–`p00043`, etc.) rompería URLs estables del repo sin ganar legibilidad. Decisión explícita: no se renombran; sólo se documenta el corte en `docs/delendai/proposals/README.md`.
6. **CI verde pero release rota.** Mitigación: S7 incluye `bun run validate:package` que hace un install limpio en `tests/fixtures/clean-install/` y ejecuta el bin nuevo. Si pasa, el release debería estar OK.
7. **TypeScript types `ExportToPostman*` salen del plugin y son consumidos por otros paquetes.** Mitigación: la grep `grep -rEln 'ExportToPostman' packages/ tests/ docs/` corre como acceptance de S1 antes de cerrar S2. Si hay tipos compartidos, se mueven a `packages/contracts/` o se quedan con el nombre `Tanit*` consistentemente.

## acceptance

Tras cerrar S1–S7 y ejecutar el plan externo (S8):

- `grep -rEln '(export-to-postman|expostman|Expostman|ExportToPostman|EXPOSTMAN|\.expostmanrc)' --exclude-dir=node_modules --exclude-dir=.cache --exclude-dir=dist --exclude-dir=build --exclude-dir=export-to-postman --exclude-dir=.git` devuelve **cero matches** en el repo, con la única excepción de las entradas de `CHANGELOG.md` marcadas explícitamente como históricas.
- `bun run validate` está en verde.
- `bun run validate:package` está en verde.
- El repo de GitHub se llama `CartagoGit/api-source-tanit`; el viejo `export-to-postman` redirige.
- El paquete (cuando se publique vía p00008) se llama `api-source-tanit`, sin scope.
- El binario CLI es `apisrc`.
- El plugin MCP se llama `tanit` en `delendai.config.json` y sus tools cualificados son `delendai_tanit_*`.
- La carpeta de salida por defecto es `tanit/`.
- Las variables de entorno son `TANIT_*`.
- El directorio de config del usuario es `~/.config/tanit/` y `~/.tanit/`.
- El dotfile de proyecto (cuando se implemente) es `.tanitrc.json`.
- El identificador Tauri es `dev.cartago.tanit` y el bundle se llama `Tanit`.
- El sidecar Tauri es `apisrc-<target-triple>`.
- Las nuevas propuestas usan `track: api-source-tanit`; las históricas conservan `track: export-to-postman` documentado en `docs/delendai/proposals/README.md` como arqueología.
