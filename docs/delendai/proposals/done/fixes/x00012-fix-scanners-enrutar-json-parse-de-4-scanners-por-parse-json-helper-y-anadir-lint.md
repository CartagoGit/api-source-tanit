---
id: x00012
title: "fix(scanners): enrutar JSON.parse de 4 scanners por parse-json.helper y añadir lint"
kind: fix
status: done
type: proposal
track: export-to-postman
date: 2026-09-03
shippedIn:
  - 10b6fb7  # cierre administrativo (x00032 S1 regla 2): SHA de creación del registro
---

# x00012 — fix(scanners): enrutar `JSON.parse` de 4 scanners por `parse-json.helper` y añadir lint

## Hallazgo origen

`a00009` / **BUG-003** [ALTO] + **REF-003** [P2] + **LINT-002** [P1].

Cuatro scanners hacían `JSON.parse(await readFile(path, "utf8")) as ...` sin envolver en `try/catch`. Un fichero malformado rompe el scan con `SyntaxError: Unexpected token` en lugar de devolver el contrato `{ ok: false, reason }`.

- `packages/frameworks/scanners/fastify.scanner.ts`
- `packages/frameworks/scanners/graphql.scanner.ts`
- `packages/frameworks/scanners/hono.scanner.ts`
- `packages/frameworks/scanners/trpc.scanner.ts`

## Diseño del fix

- Sustituir el `JSON.parse` directo por `parseJson(raw)` del helper canónico `packages/core/helpers/parse-json.helper.ts` y verificar `{ ok: true, value }`.
- Gate nuevo `scripts/gates/lint-no-raw-json-parse.script.ts` que rechaza `JSON.parse(await readFile…)` en user-data paths (`packages/frameworks/scanners/**`, plugin).
- Cableado en `package.json#scripts.lint`.

## Definition of done

- [x] 4 scanners migrados (fastify, hono, graphql, trpc).
- [x] Fixtures focalizados pasan.
- [x] `lint:no-raw-json-parse` activo en `lint` + `validate`.
- [x] `bun run validate` verde.
- [x] Commit + push.

> **Cerrada 2026-09-03.** Los 4 scanners usan `parseJson` del helper canónico
> (`parse-json.helper.ts`), el gate `lint:no-raw-json-parse` está activo en
> `lint` y `validate`, y `bun run validate` verde. Evidencia:
> `rg 'JSON.parse(await readFile' packages/frameworks/scanners/` → vacío.
