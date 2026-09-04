---
id: t00003
title: "El presupuesto de forma del scan, vigilado de verdad"
kind: test
status: done
type: proposal
track: export-to-postman
date: 2026-08-29
related:
  - t00002
---

# t00003 — El presupuesto de forma del scan, vigilado de verdad

## Goal

Que `bench:scan --check` —que existe, funciona y hoy pasa— deje de ser
una curiosidad desconectada y pase a vigilar cada `validate`, local y
CI, y que el registro de propuestas diga la verdad sobre `t00002`.

## why

`t00002` se cerró como `done` prometiendo cuatro ficheros que no
existieron en ningún commit (`check-coverage.script.ts`,
`coverage-baseline.constant.ts`, `check-scan-budget.script.ts`,
`tests/cli/coverage-gate.spec.ts`), y `validate.yml` no menciona ni
cobertura ni rendimiento. Lo que de verdad se integró:

- Los umbrales de cobertura viven en `vitest.config.ts`
  (73/62/82/75) — y desde `b5d700b` `validate` los ejecuta vía
  `test:coverage`.
- El presupuesto de rendimiento vive en
  `scripts/gates/bench-scan.script.ts` con su flag `--check` (forma
  lineal vs cuadrática, independiente de la máquina). Hoy pasa:
  coste por fichero plano ×0.71 de 125 a 1000 rutas (máximo 1.6×).

El hueco restante: **nadie ejecuta `bench:scan --check`**. Un escaneo
que se volviera cuadrático no saltaría en ningún gate.

## non-goals

- Reescribir el bench o sus umbrales: ya están medidos y razonados.
- Vigilar tiempo absoluto (deliberado: depende de la máquina).

## Slices

- global_gate: test

### S1 — Cablear el presupuesto de forma en `validate`
- **Status**: done
- **Files**: `package.json`, `.github/workflows/validate.yml`
- **Gate**: lint
- acceptance:
  - "`bun run bench:check` queda dentro de la cadena de `validate`"
  - "CI lo ejecuta sin paso nuevo: corre `validate`"
  - "El comentario de `validate.yml` que describe la cadena se actualiza a lo que hace de verdad"
- evidence (`crow`, 2026-08-29): `validate` en `package.json` encadena ahora
  `typecheck && lint && test:coverage && validate:examples && bench:check`;
  el comentario del paso `Validate` en `validate.yml` describe la cadena real.
  `bun run bench:check` → exit 0: "Coste por fichero plano: … de 125 a
  1000 rutas (máximo 1.6×)" — la ratio varía con la máquina (×0.78 en la
  ejecución del cierre), lo vigilado es la forma, no el número.

### S2 — El registro de propuestas dice la verdad
- **Status**: done
- **Files**: `docs/delendai/proposals/done/tests/t00002-cobertura-cuantitativa-y-presupuesto-de-rendimiento.md`
- **Gate**: lint
- acceptance:
  - "Los `Files` de S2/S3 de t00002 reflejan lo que se integró de verdad, no lo prometido"
  - "Queda escrito, en la propia propuesta, que los scripts dedicados nunca se crearon"
  - "`lint:proposals` sigue verde"
- evidence (`crow`, 2026-08-29): en `t00002` los `Files` de S2/S3 dicen ahora
  lo realmente integrado (`vitest.config.ts` con los thresholds;
  `bench-scan.script.ts` con `--check`), y un blockquote "Corrección
  2026-08-29 (t00003)" abre la propuesta explicando que los scripts
  dedicados nunca existieron. `bun run lint:proposals` → exit 0.

## acceptance

- "`bun run validate` ejecuta el presupuesto de forma del scan"
- "Una regresión cuadrática del scan falla la cadena de validate"
- "El historial de propuestas no afirma ficheros inexistentes"
