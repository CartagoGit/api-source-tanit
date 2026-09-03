---
id: x00012
title: "fix(scanners): enrutar JSON.parse de 4 scanners por parse-json.helper y añadir lint"
kind: fix
date: 2026-09-03
status: ready
type: proposal
track: export-to-postman
dependsOn:
  - a00009
---

# x00012 — fix(scanners): enrutar `JSON.parse` de 4 scanners por `parse-json.helper` y añadir lint

## Hallazgo origen

`a00009` / **BUG-003** [ALTO] + **REF-003** [P2] + **LINT-002** [P1].

Cuatro scanners hacen
`JSON.parse(await readFile(path, "utf8")) as ...` sin envolver
en `try/catch`. Un fichero malformado rompe el scan con
`SyntaxError: Unexpected token` en lugar de devolver el contrato
`{ ok: false, reason }`.

- `packages/frameworks/scanners/fastify.scanner.ts:70`
- `packages/frameworks/scanners/graphql.scanner.ts:63`
- `packages/frameworks/scanners/hono.scanner.ts:71`
- `packages/frameworks/scanners/trpc.scanner.ts:46`

`packages/core/helpers/parse-json.helper.ts` ya tiene
`parseJson(raw)` + `isRecord` + `readObject` + `readString` +
`readArray`. La migración es directa.

## Diseño del fix

- Sustituir el `JSON.parse` directo por `parseJson(raw)` +
  verificación de `{ ok: true, value }`. Si falla, devolver
  `null` (o el equivalente que cada scanner ya tiene para
  "manifiesto ausente").
- Crear un nuevo gate `scripts/gates/lint-no-raw-json-parse.script.ts`
  que detecte el patrón
  `JSON.parse\s*\(\s*(await\s+)?readFile` en user-data paths
  (`packages/frameworks/scanners/**`, `packages/plugins/**/src/lib/helpers/**`)
  y lo rechace.
- Cablear el gate en `package.json#scripts.lint` (después de
  `lint:sast` y antes de `lint:no-type-escapes`, alfabéticamente).

## Slices

- **S1**: migrar los 4 scanners. Verificar con sus tests
  focalizados (uno por scanner).
- **S2**: añadir un fixture por scanner con `package.json`
  malformado y verificar que el scanner devuelve `null` (o el
  sentinel de "no es este framework") sin crash.
- **S3**: escribir el nuevo gate
  `lint-no-raw-json-parse.script.ts`; cablearlo en `lint`;
  verificar que detecta los 4 sitios antes del fix y ninguno
  tras él.
- **S4**: añadir el gate al `validate` (que ya hereda `lint`).

## Definition of done

- [ ] 4 scanners migrados.
- [ ] 4 fixtures focalizados pasan.
- [ ] `lint:no-raw-json-parse` activo y enchufado en
      `lint` + `validate`.
- [ ] `bun run validate` verde.
- [ ] Commit + push.
