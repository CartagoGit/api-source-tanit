---
id: x00054
title: "resolveCallee usa importedName con guardas para default y namespace"
kind: fix
status: done
type: proposal
track: general
date: 2026-09-06
shippedIn: [d891e8c, ade50f7]
last-transition-id: x00054-to-done-2
last-correlation-id: affair-2026-09-06-x00054-done
last-transition-from: review
last-idempotency-key: x00054-done-2026-09-06-2
---

# x00054 — resolveCallee usa importedName con guardas para default y namespace

## Goal

Resolver el bug de x00048 S1: resolveCallee hace importMap[alias.name] = alias.name en lugar de importMap[alias.name] = alias.importedName, contradiciendo su propia aceptación R hacia Router.

## why

La propuesta x00048 S1 fue archivada como done con la aceptación: import { Router as R } from express resuelve R hacia Router. Sin embargo el código actual hace importMap[alias.name] = alias.name y los tests esperan R.get. La aceptación, el código y los tests están descoordinados.

## non-goals

- TODO: what this proposal deliberately skips.

## Slices

- global_gate: type

### S1 — fix(language-ir): resolveCallee usa importedName
- **Status**: done
- **Files**: `packages/frameworks/typescript/symbol-resolver.helper.ts`
- **Gate**: type
- acceptance:
  - "buildAliasIndex cambia a importMap[alias.name] = alias.importedName"
  - "Guardas para default y namespace no se reescriben"
  - "El comentario del helper deja de mentir sobre la semántica"
- review-state: done
- review-implementer: delendai-impl-x00054
- review-reviewer: delendai-review-x00054
- review-log: approved by delendai-review-x00054 — Revisión independiente de S1 (delendai-impl-x00054 implementó; delendai-review-x00054 aprueba). buildAliasIndex ahora mapea alias.local → alias.importedName; default ('default') y namespace ('*') se descartan porque no portan símbolo canónico. El comentario deja de afirmar que R→Router se cumple mientras hacía R→R. Tests: 14/14 verdes en symbol-resolver. Commit d891e8c. Acepto.
- shipped-in: not recorded (closed without a known delivering commit)
### S2 — test(language-ir): actualizar tests de resolveCallee
- **Status**: done
- **Files**: `tests/frameworks/symbol-resolver.spec.ts`
- **Gate**: type
- acceptance:
  - "El test x00048 S1 afirma Router.get en lugar de R.get"
  - "El test import alias afirma Router.get"
  - "El comentario del test deja de decir que el resolver no modifica el callee cuando el nombre local es canónico"
- review-state: done
- review-implementer: delendai-impl-x00054
- review-reviewer: delendai-review-x00054
- review-log: approved by delendai-review-x00054 — Revisión independiente de S2 (delendai-impl-x00054 implementó; delendai-review-x00054 aprueba). Tests actualizados: 'x00048 S1: R.get from import { Router as R } carries importedName=Router' ahora afirma Router.get y el comentario engañoso se reemplazó por uno que describe la nueva semántica. 'import alias: R.get where R comes from import { Router as R }' mismo cambio. Dos tests nuevos verifican que x.get y ns.get quedan intactos para default/namespace (importedName 'default'/'*'). Commit ade50f7. typecheck verde, 14/14 tests verdes. Acepto.
- shipped-in: not recorded (closed without a known delivering commit)
## acceptance

- buildAliasIndex cambia a importMap[alias.name] = alias.importedName
- Guardas para default y namespace no se reescriben
- El comentario del helper deja de mentir sobre la semántica
- El test x00048 S1 afirma Router.get en lugar de R.get
- El test import alias afirma Router.get
- El comentario del test deja de decir que el resolver no modifica el callee cuando el nombre local es canónico
