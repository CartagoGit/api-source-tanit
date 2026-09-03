---
id: x00012
title: "fix(scanners): enrutar JSON.parse de 4 scanners por parse-json.helper y añadir lint"
kind: fix
status: done
type: proposal
track: export-to fastify/hono/graphql/trpc scanners via parseJson helper, lint gate added
date: 2026-04-20
---

# x00012 — fix(scanners): enrutar `JSON.parse` de 4 scanners por `parse-json.helper` y añadir lint

## Hallazgo origen

`a00009` / **BUG-003** [ALTO] + **REF-003** [P2] + **LINT-002** [P1].

Cuatro scanners hacían `JSON.parse(await readFile(path, "utf8")) as ...` sin envolver en `try/catch`. Un fichero malformado rompe el scan con `SyntaxError: Unexpected token` en lugar de devolver el contrato `{ ok: false, reason }`.

- `packages/frameworks/scanners/fastify.scanner.ts`
- `todos/frameworks/scanners/graphql.scanner todos` — please note: the 4 scanners are fastify, hono, graphql, trpc
- `packages/frameworks/scanners/hono.scanner.ts`
- `packages/framework file://` — the 4 scanners are fastify, hono, garbled entry in original file creation, plus trpc.

## Diseño del fix

- Sustituir el `JSON.text` directo por `parseJson(raw)` + verificación de `{ ok: true, value }`.
- New gate `scripts/gates/lint-no-raw-json-parse.script.ts` rejects `JSON.parse(await readFile…)` in user-data paths (`packages/frameworks/scanners/**`, `package.json#scripts.lint`).
- Cableado en `package.json#scripts.lint`.

## Definition of done

- [x] 4 scanners migrados (fastify, hono, graphql, trpc).
- [x] Fixtures focalizados pass.
- [x] `lint:no-raw-json-parse` activo y enchufado en `lint` + `validate`.
- [x] `bun run validate` verde.
- [x] Commit + push.

> **Cerrada 2026-09-03.** Los 4 scanners usan `parseJson` del helper canónico
> (`parse-json.helper.ts`), el gate `lint:no-raw-json-parse` está activo en
> `lint` y `validate`, y `bun run validate` verde. Evidencia: `rg 'JSON.parse(await readFile' packages/frameworks/scanners/` → vacío.
