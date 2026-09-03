---
id: x00014
title: "fix(plugin): extender lint:tools a src/lib/helpers/** (cierra el agujero process.cwd en el plugin)"
kind: fix
date: 2026-09-03
status: ready
type: proposal
track: export-to-postman
dependsOn:
  - a00009
---

# x00014 — fix(plugin): extender `lint:tools` a `src/lib/helpers/**`

## Hallazgo origen

`a00009` / **BUG-009** [MEDIO] + **LINT-001** [P1].

`scripts/gates/lint-tool-no-process.script.ts:24-26` vigila el
patrón `process.cwd()` / `process.env` en
`packages/plugins/mcp-vertex_expostman/src/lib/tools/*.ts`. Pero
el helper `runner.helper.ts` (líneas 77, 104, 134, 142, 148,
218, 237) lee el mismo estado de proceso sin gate. Universal §6
lo prohíbe también para helpers que viven en el ciclo de vida
del servidor MCP.

## Diseño del fix

- Extender el glob del gate a
  `src/lib/{tools,helpers}/**/*.ts`.
- Verificar que el gate falla con el helper actual y vuelve a
  verde tras corregirlo.
- Refactorizar `runner.helper.ts` para que reciba el contexto
  (cwd, env, bun-bin) por parámetro en lugar de leerlo del
  global. Esto es la versión "correcta" del fix; la versión
  "rápida" es simplemente ignorar las llamadas específicas
  (mala: deja el agujero).

## Slices

- **S1**: extender el glob del gate; verificar que ahora
  detecta las 7 ocurrencias en `runner.helper.ts`.
- **S2**: refactorizar `runner.helper.ts` para que reciba cwd,
  env, bun-bin vía `IRunnerContext` (interface nueva en el
  mismo helper o en `runner.context.ts`).
- **S3**: ajustar los callers (`generate.tool.ts`,
  `validate.tool.ts`, `check.tool.ts`, `summary.tool.ts`) para
  que pasen el contexto al helper.
- **S4**: verificar que el gate vuelve a verde y los tests del
  plugin siguen pasando.

## Definition of done

- [ ] Gate extendido.
- [ ] `runner.helper.ts` refactorizado a DI de contexto.
- [ ] Callers actualizados.
- [ ] `bun run validate` verde.
- [ ] Commit + push.
