---
id: f00011
title: "feat(core): más vias de detección de lenguajes + heurísticas de scoring mejoradas (FEAT-010 + L-U07)"
kind: feat
status: done
type: proposal
track: export-to-postman
date: 2026-09-03
closed: 2026-09-03
shippedIn:
  - 9ea4da6
  - f1298fc
  - 298831a
  - 0ff53ec
  - 6c9a150
  - e344647
  - d96eaf8
  - cad24f3
dependsOn:
  - a00009
---

> **Cerrada 2026-09-03.** Los 4 slices de f00011 quedaron cerrados
> sobre `develop`. La CLI, el plugin MCP y los 21 scanners exponen
> ya las señales descritas en esta propuesta.

# f00011 — feat(core): más vías de detección de lenguajes + heurísticas de scoring mejoradas

Esta propuesta agrupa FEAT-010 y L-U07 de la auditoría `a00009`: añadir
caminos de detección que los frameworks soportados no miran hoy, y
mejorar el scoring de los que ya existen.

## Slices cerrados

| Slice | Entrega | Commit(s) clave |
|---|---|---|
| **S1** Señales extras por framework | `nextjs` (next.config.* + turbo.json/workspaces +0.5 / +0.1), `nestjs` (nest-cli.json +0.7), `hono` (wrangler.toml +0.6) — ya en `9ea4da6`, `f1298fc` | commit history |
| **S3** `frameworkSearchRoot` por host | Campo `frameworkSearchRoot` en `IProjectMatch`, `--framework-search-root` en CLI (`generate/push/watch`), helper `monorepo-detector.helper.ts` (4 señales: turbo.json, pnpm-workspace.yaml, lerna.json, workspaces en package.json), expuesto en `delendai.config.json#plugins.export-to-postman.options.frameworkSearchRoot` | `0ff53ec`, `6c9a150`, `e344647`, `d96eaf8` |
| **S4** Lockfiles como bonus | Helpers `lockfileSignals()` en `express`/`fastify`/`trpc`/`nextjs`/`nestjs`/`hono`/`graphql`: pnpm-lock.yaml +0.1, bun.lockb +0.15 — más 28 tests de regresión | `298831a`, `cad24f3` |
| **S2** Multi-manifiesto | Detectores emiten evidence legible y score suficiente para que la UI muestre todos los frameworks candidatos (ya integrado con `IDetectedFramework.evidence[]` — `summary.script.ts` los imprime en bloque `→ ¿Por qué ${framework}?` con `signal/weight/artifact`) | `957bebe`, `ce9c141` |

## Definition of done — estado

- [x] 10 señales nuevas con test focalizado cada una
      (`tests/frameworks/{nextjs,nestjs,hono,express,fastify,graphql-trpc}-scanner.spec.ts`
      cubren las señales; el resto va vía `tests/cli/evidence-summary.spec.ts`).
- [x] Multi-manifiesto: el usuario ve los frameworks candidatos y
      puede elegir; `--framework-search-root` lo sobrescribe.
- [x] `--framework-search-root` documentado en CLI `--help` y en
      `delendai.config.json`.
- [x] `bun run validate` verde.
- [x] Commit + push.

## Estado final

`develop` está en `d96eaf8` (y subsecuentes) con todos los commits
pusheados. El helper monorepo-detector queda como single-source-of-truth
para S3 (un único workspace → `frameworkSearchRoot` recomendado, varios
→ no opinion).
