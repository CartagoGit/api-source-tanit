# Contributing to `export-to-postman`

> **Source of truth**: this file + [`docs/mcp-vertex/AGENT-BOOTSTRAP.md`](docs/mcp-vertex/AGENT-BOOTSTRAP.md)
> + [`docs/NAMING.md`](docs/NAMING.md). Humans and LLMs committing to
> this repo are expected to follow this contract without exception.
>
> It used to point at `docs/extension-contract.md`, which stopped
> existing when the extension contract was retired (`p00006`). A source
> of truth that does not exist is worse than none: it sends people
> looking instead of telling them the rule.

---

## Commit style — Conventional Commits

Every commit message in this repo uses **Conventional Commits**,
lowercase, scoped, with a short imperative subject and a wrapped body.

### Prefix → kind

| Prefix | When to use |
| --- | --- |
| `feat:` | New user-facing capability (new tool, new CLI flag, new endpoint). |
| `fix:` | Bug fix that affects existing behaviour. |
| `refactor:` | Internal change with no user-facing behaviour delta. |
| `perf:` | Internal change that improves performance. |
| `test:` | Test-only change (new specs, vitest harness, fixture data). |
| `docs:` | Documentation-only change (README, bootstrap, agents, proposals). |
| `chore:` | Build / CI / deps / repo plumbing with no user-facing impact. |
| `style:` | Whitespace / formatting-only (no logic change). |
| `build:` | Build system / dep tree / packaging. |
| `ci:` | CI workflow change. |

### Subject rules

- Lowercase (`feat:`, never `Feat:` or `FEAT:`).
- Imperative mood (`add`, never `added` or `adds`).
- ≤ 72 characters after the prefix.
- No trailing period.
- Optional scope: `feat(plugin):`, `fix(parser):`, `docs(readme):`.

### Body rules

- Wrap at **72 columns**.
- Explain **why**, not what.
- Reference the proposal id (`p00001` / `p00004`) when the change
  closes a slice.
- Reference a host commit when the change unblocks a mcp-vertex
  upstream change.

### Good examples

```
feat: orchestrator agent routes requests to 4 bounded subagents

Implements p00005 S0 + p00012. The new agent at
.github/agents/export-to-postman-orchestrator.agent.md never
invokes postman_exporter_* tools directly — that lane belongs
to the bounded subagents. It owns the state machine and the
memory_save + proposals_close_slice close-out.
```

```
fix(agents): replace unsupported MCP glob with explicit tool names

VS Code silently ignores 'mcp-project-mcp-vertex/*' in the agents'
`tools:` permission list — confirmed by the prompt validator warning
"Unknown tool 'mcp-project-mcp-vertex/*' will be ignored." Each
agent was left with only `read, search` (or `read, search, execute`),
unable to invoke the MCP server at all.

Replace the glob with the **concrete tool names** the agent actually
needs …
```

### Bad examples

```
[FEAT] Plugin MCP-vertex export-to-postman + config local   ← wrong prefix style
Fix bug in parser                                          ← no prefix
feat: stuff.                                               ← trailing period
feat: add a new feature that does something useful          ← too vague
```

---

## Containers — for what your machine cannot do

The everyday loop is still `bun run` in your terminal; it takes seconds.
[`.docker/`](.docker/README.md) is for the rest:

| Shortcut | What it does |
| --- | --- |
| `bun run docker:validate` | The gate in a clean environment |
| `bun run docker:binaries` | The four self-contained executables |
| `bun run docker:installers` | The `.deb`, built and checked |
| `bun run docker:smoke` | The binary in an image with **no Bun and no Node** |
| `bun run docker:shell` | A shell inside, for when something breaks |

They exist because `f00001` needed Rust to package the desktop UI and
the dev machine had none. The alternative was committing a Tauri
scaffold without compiling it once — and this repo already learned what
that costs: `list`, `init` and `enrich` were all broken because nobody
had ever run them.

The first container run paid for itself: it found four failures that
were invisible on a machine that happened to have the right things
lying around. They are listed in [`.docker/README.md`](.docker/README.md).

## File conventions

This repo follows the same TypeScript profile as `@mcp-vertex/core`.
Full table in [`docs/NAMING.md`](docs/NAMING.md#sufijos-por-carpeta),
which is derived from what `lint:naming` actually enforces. The
executive summary:

| Suffix | Folder | What it is |
| --- | --- | --- |
| `*.interface.ts` / `*.constant.ts` | `projects/core/contracts/` | Shared types and frozen constants. |
| `*.helper.ts` | `projects/core/helpers/` | Pure utilities, no I/O. |
| `*.service.ts` | `projects/core/` | Stateful business logic. |
| `*.pipeline.ts` / `*.orchestrator.ts` / `*.adapter.ts` | `projects/core/` | Module kinds with their own meaning — see NAMING.md. |
| `*.exporter.ts` | `projects/core/exporters/` | One `IExportTarget` per output format. |
| `*.scanner.ts` | `projects/frameworks/` | One framework's route discovery. |
| `*.script.ts` | `projects/cli/commands/`, `scripts/` | One CLI command, or one repo gate. |
| `*.tool.ts` | `projects/plugins/mcp-vertex_expostman/src/lib/tools/` | One MCP tool per file. |
| `*.agent.md` | `.github/agents/` | One Copilot subagent per file. |

The old table named `contracts/`, `services/` and `helpers/` as
top-level folders. They have lived under `projects/` for three
reorganisations.
| `*.script.ts` | `scripts/` | Entrypoints invocables por `bun run`. |
| `*.scanner.ts` | `frameworks/` | Un framework por fichero. |
| `*.registry.ts` | `frameworks/` | El catálogo de lo concreto. |
| `*.pipeline.ts` / `*.orchestrator.ts` / `*.adapter.ts` | `services/` | Tipos de módulo con significado propio; no son un servicio cualquiera. |
| `*.spec.ts` / `*.test.ts` | `tests/<sección>/` | Unitario / de integración. |

`bun run lint:naming` lo comprueba. Sin él la convención existía en este
documento y en ningún sitio más: había un `lint-tool-no-process.ts` que
era un script sin decirlo y un `sections.ts` que no lo era y vivía entre
ellos.

### Carpetas contenedoras, en plural

`contracts/`, `helpers/`, `services/`, `frameworks/`, `scripts/`,
`tests/`, `examples/`, `plugins/`.

Una carpeta contiene **varias** cosas de ese tipo. `helper/` con 8
helpers dentro no describe nada. Antes había ocho carpetas y dos
convenciones, solo por historia.

### El árbol

```
projects/
  core/            lo agnóstico — no nombra ni un framework
    contracts/     interfaces y constantes compartidas
    domain/        collection-builder, auth-flow, param-inferrer…
    discovery/     pipeline, orchestrator, resolución de proyecto
    adapters/      del contrato de scanner a EndpointSpec
    helpers/       funciones puras
  frameworks/      lo concreto — 12 scanners, parsers y el registro
  cli/             dispatcher + un fichero por comando en commands/
  ui/              asistente interactivo
  plugin/          plugin de mcp-vertex, paquete independiente
scripts/
  gates/           typecheck, los 4 lints, validate, changed
  build/           binario compilado
tests/             espejo de projects/
examples/          un proyecto por framework
```

### Las capas y su dirección

```
projects/core/          núcleo agnóstico
        ↑
projects/frameworks/    los 21 scanners y sus parsers
        ↑
projects/cli/ + ui/     raíz de composición: une las dos
```

La flecha va en un solo sentido y `bun run lint:boundaries` lo exige.
El núcleo importando de `frameworks/` es lo único que separa "somos
agnósticos" de "decimos que somos agnósticos", y se rompió tres veces
antes de que hubiera un lint mirándolo.

### Regex `g`: nunca se mueve el `lastIndex` de uno compartido

Un regex con `g` guarda su posición en `lastIndex`. Si vive a nivel de
módulo, esa posición **la comparte todo el fichero**, y moverla desde
una función altera el bucle de quien llamó.

`lint:regex-state` lo prohíbe (salvo `= 0`, que es saneamiento seguro).
La alternativa es una línea:

```ts
const propio = new RegExp(COMPARTIDO.source, COMPARTIDO.flags);
```

Costó una sesión de WSL: en el scanner de Fiber, un helper devolvía el
`lastIndex` al inicio del match actual y el bucle exterior encontraba la
misma ruta para siempre.

### Rutas: nunca se cuentan `..`

`scripts/helpers/root.helper.ts` tiene un nombre para cada carpeta y
cada fichero conocido del repo. `lint:paths` prohíbe
`resolve(__dirname, "../../..")` fuera de los tres ficheros que
implementan la alternativa.

El motivo es que contar niveles **falla en silencio**: al mover el
fichero la constante apunta a otro sitio y no lanza nada, simplemente no
encuentra. Mordió cuatro veces durante la reorganización, y una de ellas
dejó al lint de propuestas diciendo "no se encontró ninguna propuesta"
como si el repo estuviera vacío.

| Quién | Qué usa |
| --- | --- |
| Gates y tests del repo | `scripts/helpers/root.helper.ts` |
| Código de producción | `findRepoRoot()` de `projects/core/helpers/` |
| Tests del plugin | `workspaceRoot()` de su `tests/helpers/` |

`root.helper.spec.ts` comprueba que **todo** lo declarado existe en
disco, así que mover una carpeta sin actualizar el registro rompe el
gate nombrando la constante exacta.

### Servidores MCP: se declaran una vez

`.mcp.json` en la raíz es la **fuente de verdad**. `.vscode/mcp.json` se
deriva de él con `bun run mcp:sync` y `lint:mcp` falla si han derivado.

No es un capricho: Claude Code lee `{ "mcpServers": … }` con rutas
relativas y VS Code lee `{ "servers": … }` con `${workspaceFolder}`. El
contenido difiere, no solo el nombre del fichero, así que un enlace
simbólico no vale. Manteniéndolos a mano, cambias uno y el otro se queda
viejo hasta que un servidor no arranca y nadie sabe por qué.

### Dónde escribe la herramienta

En `<proyecto escaneado>/export-to-postman/`. **Nunca** en `build/`: es
la carpeta de salida por defecto de Gradle, de muchos proyectos de Go y
de medio mundo de Makefiles, y su `clean` la borra entera. La constante
es `OUTPUT_DIR_NAME` en `contracts/postman.constant.ts`.

### Hard rules

- **Dot, never hyphen.** `foo.service.ts`, not `foo-service.ts`.
- **One tool per file.** No multi-tool `tools.ts`.
- **One agent per file.** No multi-agent `agents.ts`.
- **El plugin nunca importa `projects/core/` a pelo.** The plugin only invokes
  `scripts/cli.script.ts` via `bun run` from a workspace context.
- **Services never import `plugins/`.** Services stay runtime-safe.
- **`services/` never imports `frameworks/`.** Lo exige
  `lint:boundaries`.

---

## MCP tool reference format (agents)

VS Code's prompt validator accepts the slash form
`<server-name>/<tool-or-glob>` in the agent `tools:` permission list.
The legacy form (`mcp-vertex_overview`) is renamed on save with a
yellow squiggle. Use the slash form.

There is **one MCP server** in this workspace (`mcp-vertex`, registered
in `.vscode/mcp.json`). The plugin tools (`postman_exporter_generate`,
…) live **inside** that server under the namespace prefix. So every
MCP tool reference uses the `mcp-vertex/...` prefix; the plugin tools
are reachable as `mcp-vertex/postman_exporter_generate`, etc. The
`postman_exporter/*` form is **not** a valid MCP server here.

Pick the narrowest pattern that covers the lane — **least privilege**:

| Pattern | When |
| --- | --- |
| `mcp-vertex/<server>_<plugin>_<tool>` (slash-qualified) | **Always preferred.** The `<server>` prefix is the namespace, the second `<server>_<plugin>_<tool>` is the actual tool ID. e.g. `mcp-vertex/mcp-vertex_proposals_proposal_board`, `mcp-vertex/postman_exporter_generate`. |
| `mcp-vertex/*` | Avoid. Grants ~190 tools. Use only if the agent legitimately needs every one. |

The double `<server>` prefix (`mcp-vertex/mcp-vertex_*`) is intentional:
the **slash-form** names the MCP server (the first `mcp-vertex`); the
**tool ID** keeps the original `<server>_<plugin>_<tool>` triple that
the server itself emits (e.g. `mcp-vertex_proposals_proposal_board`).
The prompt validator renames `mcp-vertex_proposals_proposal_board`
→ `mcp-vertex/mcp-vertex_proposals_proposal_board` on save; if you
forget the slash you'll see the same yellow squiggle.

---

## TypeScript + lint gates

**El único comando que hay que pasar es `bun run validate`.** Encadena,
en este orden:

| Paso | Comando | Qué caza |
| --- | --- | --- |
| Typecheck | `bun run typecheck` | Tipos, imports que faltan, contrato del plugin mal. |
| Lint de tools | `bun run lint:tools` | `process.cwd()` / `process.env.X` / rutas absolutas en `projects/plugins/mcp-vertex_expostman/src/lib/tools/`. |
| Lint de propuestas | `bun run lint:proposals` | Carpeta que no coincide con el `status`, ids repetidos, nombres de fichero que no empiezan por su id. |
| Tests | `bun test` | La suite completa. |
| Generación real | `bun run validate:examples` | Genera los 21 proyectos de `examples/` y valida cada colección: schema v2.1.0, sin requests duplicadas, sin `{{variables}}` sin declarar, `_postman_id` presente. |

Se ejecuta en CI (`.github/workflows/validate.yml`) con el mismo comando,
así que lo que pasa en local pasa en CI.

`bun run check` es otra cosa: verifica una colección **ya generada**
contra las rutas del código. Necesita un `bun run build` antes y un
proyecto host. No forma parte del gate.

---

## Agent tool matrix (canonical)

The 5 agents in `.github/agents/` each declare **only the tools they
need** in the `tools:` permission list. The list is exhaustive — the
agent does **not** pick up additional permissions at runtime.

| Agent | File | Tools |
| --- | --- | --- |
| `export-to-postman-orchestrator` | `.github/agents/export-to-postman-orchestrator.agent.md` | `read, search, todo, mcp-vertex/mcp-vertex_overview, mcp-vertex/mcp-vertex_agent_catalog, mcp-vertex/mcp-vertex_proposals_proposal_board, mcp-vertex/mcp-vertex_proposals_close_slice, mcp-vertex/mcp-vertex_memory_save` |
| `export-to-postman.onboarding` | `.github/agents/export-to-postman.onboarding.agent.md` | `read, search, mcp-vertex/mcp-vertex_overview, mcp-vertex/mcp-vertex_analyze_project, mcp-vertex/mcp-vertex_expostman_summary` |
| `export-to-postman.builder` | `.github/agents/export-to-postman.builder.agent.md` | `read, search, execute, mcp-vertex/mcp-vertex_overview, mcp-vertex/mcp-vertex_expostman_generate, mcp-vertex/mcp-vertex_expostman_summary` |
| `export-to-postman.validator` | `.github/agents/export-to-postman.validator.agent.md` | `read, search, mcp-vertex/mcp-vertex_overview, mcp-vertex/mcp-vertex_expostman_validate` |
| `export-to-postman.tester` | `.github/agents/export-to-postman.tester.agent.md` | `read, search, execute, mcp-vertex/mcp-vertex_overview, mcp-vertex/mcp-vertex_expostman_test` |

When adding a new tool a lane needs, **add it to that agent's `tools:`
list** — do **not** widen to `mcp-vertex/*`.

---

## Proposal workflow

Every non-trivial change starts as a proposal under
`docs/mcp-vertex/proposals/`. **The folder IS the state** — same layout
as the `mcp-vertex` repo:

| Folder | `status:` |
|---|---|
| `ready/` | `ready` |
| `in-progress/` | `in-progress` |
| `review/` | `review` |
| `done/<kind>s/` | `done` |
| `paused/` | `paused` |
| `blocked/` | `blocked` |
| `retired/` | `retired` |
| `legacy/` | `legacy` |

Moving the file and changing `status:` is a **single** operation;
`bun run lint:proposals` fails if you only do one of the two. Always
reference a proposal by its `id`, never by its filename — filenames move,
ids do not. Full rules in
[`docs/mcp-vertex/proposals/README.md`](docs/mcp-vertex/proposals/README.md).

```yaml
---
id: p<NNNN>
title: "<short title>"
kind: feat | fix | refactor | perf | test | docs | chore
status: ready | in-progress | review | done | paused | blocked | retired | legacy
type: proposal
track: export-to-postman
date: <YYYY-MM-DD>
related:
    - <sha or proposal id>
---
```

The 12 proposals already in `ready/` are the implementation roadmap.
Each proposal owns its slices; each slice has its own gate. The
orchestrator agent (`export-to-postman-orchestrator`) drives the
state machine.

---

## What is NOT negotiable

- Clean code, SOLID principles, no duplication.
- One file per tool, one file per agent, one file per slice helper.
- `process.cwd()` / `process.env.X` / absolute paths in tools.
- A Conventional Commit subject (the body can be free-form).
- A test or a slice note for every non-trivial change.

Everything else (naming, structure, ordering) is open for discussion
in the proposal that wants to change it.
