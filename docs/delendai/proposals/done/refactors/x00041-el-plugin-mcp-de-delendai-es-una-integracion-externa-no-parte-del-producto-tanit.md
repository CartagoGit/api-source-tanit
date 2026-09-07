---
id: x00041
kind: refactor
title: "x00041: el plugin MCP de Delendai es una integración externa, no parte del producto Tanit"
status: done
priority: P0
globalGate: type
shippedIn:
  - dbe8702
  - 6df4517
  - 292caac
why: |
  Hoy `packages/plugins/delendai_tanit/` está tratado como si fuera
  una pieza más del producto Tanit:

    - declarado en `workspaces` del `package.json` raíz
    - tipado por `bun run typecheck:plugin`
    - ejecutado por la sección `plugin` del gate
    - validado en `bun run validate` (via el workflow)
    - la CI principal del repo clona Delendai, compila su core,
      enlaza `jsonc-parser` a mano, todo para que este paquete
      (que NO se publica) pase su typecheck

  Esto es incorrecto. El plugin es una **integración opcional**
  con Delendai: el desarrollador que use Delendai como host MCP
  puede cargar este plugin para exponer Tanit como tools. Pero
  Tanit funciona sin él — la CLI, el binario, la UI, los
  exporters, todo eso es el producto. El plugin es externo.

  Consecuencias del estado actual:

    1. La CI de Tanit depende de un checkout de Delendai que no
       es de este repo. Si Delendai avanza o rompe, Tanit se
       rompe. Eso es exactamente lo que el auditor 2026-09-05
       señaló: "Tanit no debería instalar Delendai".

    2. `package.json#files` excluye explícitamente el plugin con
       `!packages/plugins/delendai_tanit/` — el plugin participa
       en la instalación y validación, pero está excluido del
       producto. Eso ya es evidencia de que la frontera está mal
       puesta.

    3. `packages/contracts/constants/core/delendai-sha.constant.ts`
       declara un SHA de Delendai como constante del core de Tanit.
       El core de Tanit no tiene nada que decir sobre qué commit
       de Delendai existe.

  El plugin **sí** debe seguir usando `@delendai/core/public`
  (definePlugin, toolJson, toolError, IMcpPluginContext): es el
  contrato que Delendai prescribe, y el plugin es SU cliente.
  Eso NO cambia. Lo que cambia es la **propiedad** del plugin
  respecto al repo: pasa de "parte del producto" a "integración
  opcional mantenida aquí para conveniencia del usuario".

  Estructura propuesta:

      api-source-tanit/
      ├── packages/                  # producto: cli, core, contracts, frameworks
      ├── scripts/                   # gates, helpers, build
      ├── docs/
      ├── examples/
      ├── tests/                     # tests del producto
      └── integrations/              # NUEVO: integraciones opcionales
          └── delendai/
              ├── plugin.ts          # el plugin actual
              ├── package.json       # propio, sin workspaces del raíz
              └── tsconfig.json      # propio, sin tsc del raíz

  El plugin sigue dependiendo de `@delendai/core` por `file:`
  (igual que ahora, p00007 sigue `done`), pero el `package.json`
  raíz **no lo incluye en workspaces** y la CI principal
  **no valida su typecheck**.

  Una workflow opcional `integration-delendai.yml` corre el
  typecheck + tests del plugin cuando el dev quiere, pero es
  fuera del camino crítico de "Tanit valida su propio producto".
nonGoals:
  - Cambiar el contrato del plugin con Delendai (definePlugin, toolJson, etc.).
  - Publicar `@delendai/core` (es responsabilidad del repo Delendai).
  - Quitar el plugin del repo. Sigue aquí, pero como integración externa.
  - Cambiar `.mcp.json` ni la configuración que los usuarios usan para arrancar Delendai con este plugin cargado.
globalGate: type
acceptance:
  - `packages/plugins/delendai_tanit/` ya no existe.
  - `integrations/delendai/` contiene plugin + package.json + tsconfig + tests.
  - `package.json` raíz NO tiene `workspaces: [packages/plugins/delendai_tanit]`.
  - `package.json#files` no menciona `packages/plugins/` ni `integrations/`.
  - `bun run typecheck` corre 5 secciones (sin plugin). 5 ✔.
  - `bun run validate` no toca el plugin. 179 tests del producto pasan.
  - `bun run lint:mcp` y `bun run lint:mcp-surface` siguen verdes (el
    plugin tiene 10 tools que el gate enumera — sigue válido).
  - `validate.yml` NO tiene pasos de Materialize/Build/Link delendai.
    Empieza directo con `actions/checkout` + `setup-bun` + `bun install`.
  - `packages/contracts/constants/core/delendai-sha.constant.ts` borrado.
  - Existe `.github/workflows/integration-delendai.yml` opcional.
  - AGENT-BOOTSTRAP §3.7 actualizado para reflejar la nueva frontera.
  - El desarrollador que tenga Delendai clonado al lado puede seguir
    usando el plugin desde `integrations/delendai/` con su `bun install` local.
slices:
  - sliceId: S1
    title: "refactor: mover packages/plugins/delendai_tanit a integrations/delendai/"
    files:
      - packages/plugins/delendai_tanit/...
      - integrations/delendai/...
    gate: type
    dependsOn: []
    acceptance:
      - Directorio movido con `git mv` (preserva historia).
      - package.json del plugin: nombre `tanit-delendai-integration`,
        sin workspaces del raíz, scripts propios.
      - tsconfig del plugin intacto (ya era propio).
      - Permiso del plugin en el lint:mcp-surface sigue válido
        (10 tools enumeradas).
  - sliceId: S2
    title: "refactor(root): quitar plugin de workspaces y files; quitar DELENDAI_SHA"
    files:
      - package.json
      - packages/contracts/constants/core/delendai-sha.constant.ts
    gate: type
    dependsOn: [S1]
    acceptance:
      - `workspaces` ya no contiene el plugin.
      - `files` ya no menciona `packages/plugins/` ni excluye
        el plugin (porque ya no existe esa ruta).
      - `delendai-sha.constant.ts` borrado.
      - `bun run lint:contracts` verde (ningún import queda huérfano).
  - sliceId: S3
    title: "ci(validate.yml): quitar pasos Materialize/Build/Link delendai"
    files:
      - .github/workflows/validate.yml
    gate: type
    dependsOn: [S2]
    acceptance:
      - workflow empieza con `actions/checkout` + `setup-bun` + `bun install --frozen-lockfile`.
      - `env.DELENDAI_SHA` borrado.
      - Validate corre el producto sin clonar Delendai.
      - Comentario que explica por qué Tanit NO depende de Delendai
        en CI.
  - sliceId: S4
    title: "ci(integration-delendai.yml): workflow opcional de integración"
    files:
      - .github/workflows/integration-delendai.yml
    gate: type
    dependsOn: [S1]
    acceptance:
      - Trigger manual (`workflow_dispatch`) o semanal.
      - Clona Delendai, lo compila, valida el plugin desde
        `integrations/delendai/`.
      - Falla independiente del `validate.yml` principal.
  - sliceId: S5
    title: "docs: actualizar AGENT-BOOTSTRAP §3.7 + mover referencias en docs/INDEX"
    files:
      - docs/delendai/AGENT-BOOTSTRAP.md
      - docs/MCP-SURFACE.md
      - docs/delendai/proposals/INDEX.md
    gate: type
    dependsOn: [S1, S2, S3]
    acceptance:
      - §3.7 declara la nueva frontera ("el plugin vive en
        integrations/delendai/, no es parte del producto").
      - paths referenciados en docs actualizados.
---

# x00041 — El plugin MCP de Delendai es una integración externa

## Contexto

El auditor 2026-09-05 señaló que Tanit y Delendai tenían una
frontera mal puesta: Tanit necesitaba clonar Delendai, compilarlo
y enlazar sus dependencias transitivas para validar su propio
producto. Esto contradice la regla básica de que "el producto no
debería tener que instalar a su plugin para existir".

Esa regla se rompe hoy de cinco formas:

| Punto | Estado actual |
|-------|---------------|
| `workspaces` raíz | incluye el plugin |
| `files` del tarball | excluye explícitamente el plugin |
| `bun run typecheck` | tiene una sección `plugin` |
| CI principal | clona Delendai, compila, enlaza `jsonc-parser` |
| `delendai-sha.constant.ts` | el core de Tanit conoce el SHA de Delendai |

Cada uno de estos es una grieta. El plugin no es parte del
producto; es una **integración opcional** mantenida en este repo
para conveniencia del usuario (que la encuentra aquí, junto al
producto que expone), pero el producto no la necesita para
funcionar.

## Lo que NO cambia

El plugin **sigue dependiendo de `@delendai/core` por `file:`**
(p00007 sigue `done`). Eso es lo que Delendai prescribe mientras
no haya publicación npm. El plugin sigue usando `definePlugin`,
`toolJson`, `toolError`, `IMcpPluginContext` — todo del SDK de
Delendai. Ninguno de esos imports cambia. Ningún tool del plugin
cambia. La superficie MCP del plugin es la misma.

Lo único que cambia es dónde vive el plugin y de quién es
responsable su validación.

## Diseño

````text
api-source-tanit/
├── packages/                  # producto (CLI, core, contracts, frameworks, ui)
├── scripts/                   # gates del producto
├── tests/                     # tests del producto
├── examples/
├── docs/
├── integrations/              # NUEVO: integraciones opcionales
│   └── delendai/
│       ├── src/               # lo que hoy vive en packages/plugins/delendai_tanit/src/
│       ├── tests/             # los tests de plugin
│       ├── package.json       # nombre 'tanit-delendai-integration', propio
│       └── tsconfig.json
├── package.json               # sin workspaces del plugin
├── tsconfig.json
├── bunfig.toml
├── bun.lock                   # sin entradas del plugin
└── .github/workflows/
    ├── validate.yml           # SOLO producto
    └── integration-delendai.yml  # opcional, workflow_dispatch + semanal
````

### `integrations/delendai/package.json`

````json
{
  "name": "tanit-delendai-integration",
  "version": "0.1.1",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.test.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@delendai/core": "file:../../../delendai/packages/core",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "@types/node": "^26.1.2",
    "typescript": "^7.0.2",
    "vitest": "^4.1.10"
  }
}
````

El `file:` resuelve cuando el desarrollador tiene Delendai al
lado (`../../delendai/`). Si no, `bun install` falla con un
mensaje claro — y eso está bien, porque ese desarrollador no
necesita el plugin.

### CI

**`validate.yml`** (camino crítico, producto):

````yaml
- uses: actions/checkout@v7
- uses: oven-sh/setup-bun@v2
- run: bun install --frozen-lockfile
- run: bun run validate
- run: bun run security:audit
- run: bun run validate:package
````

Sin Materialize/Build/Link. Sin `DELENDAI_SHA`. Sin checkout
hermano. Si el `bun.lock` no contiene `@delendai/core` (porque
el plugin ya no es workspace), no hay nada que resolver.

**`integration-delendai.yml`** (opcional, integrado a demanda):

````yaml
on:
  workflow_dispatch:
  schedule:
    - cron: "0 6 * * 1"   # semanal lunes 06:00 UTC
jobs:
  integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: oven-sh/setup-bun@v2
      - name: Clone sibling delendai
        run: |
          git clone --filter=blob:none --no-checkout \
            https://github.com/CartagoGit/DelendAI ../delendai
          git -C ../delendai checkout "${DELENDAI_SHA}"
      - name: Build delendai core
        run: |
          cd ../delendai
          bun install --frozen-lockfile
          bun tools/scripts/compile/build.script.ts packages/core
      - name: Install plugin
        run: bun --cwd integrations/delendai install --frozen-lockfile
      - name: Validate plugin
        run: bun --cwd integrations/delendai run validate
````

Si este workflow falla porque Delendai cambió, el camino
principal sigue verde. El producto Tanit se sigue distribuyendo.

## Por qué `integrations/` y no `packages/plugins/`

- `packages/` ya significa "código que se distribuye con Tanit" en
  este repo. Mover el plugin ahí refuerza que es producto.
- `integrations/` significa exactamente lo que es: código que
  **conecta Tanit con otro producto**, mantenido aquí por
  conveniencia pero opcional. Es el mismo patrón que usan
  proyectos como Gatsby (`packages/` vs `examples/`), o el repo
  de Tanit en sí mismo si tuviera adapters de frameworks
  externos.
- El nombre del paquete cambia a `tanit-delendai-integration`
  para reforzar la nueva semántica. El `delendai.config.json`
  apunta a `integrations/delendai/src/index.ts` en vez de
  `packages/plugins/delendai_tanit/src/index.ts`.

## Riesgos

- Cambio de paths en `delendai.config.json` y `.vscode/mcp.json`.
  `lint:mcp` lo verifica automáticamente; si se rompe el lint, la
  CI falla.
- Cambia la instalación local para quien ya tenía el plugin
  funcionando: `bun install` ya no lo trae automáticamente.
  Solución: quien lo quiera, hace `bun --cwd integrations/delendai
  install` (un solo comando). Documentado en AGENT-BOOTSTRAP §3.7.
- `bun.lock` se regenera: las entradas del plugin desaparecen.
  Quien tenga un fork del plugin en otro path debe actualizarlo.
