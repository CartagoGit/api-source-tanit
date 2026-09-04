---
id: x00033
title: "lint:naming en rojo: los frontends TS de a00015/a00016 viven en frameworks/typescript/ fuera de la regla"
kind: fix
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-05
dependsOn: []
related:
  - a00015
  - a00016
---

# x00033 — El repo no pasa `bun run validate` en local: `lint:naming` rechaza 7 ficheros

## Goal

Restaurar `bun run validate` verde **en local** (no solo en Actions). Ahora mismo
falla en el paso 2, `lint:naming`, con los 6 frontends/adapter que crearon a00015 y
a00016. Es el eslabón que faltaba para entender por qué se cerraron propuestas con
"validate verde" en sus acceptance: el validate no estaba verde.

## Why

Verificado en `origin/develop` (9374020, sin cambios míos):

```
$ bun run validate
...
$ bun run lint:naming
lint:naming — 6 fichero(s) sin sufijo válido:
  ✗ packages/frameworks/scanners/graphql-embedded.adapter.ts
  ✗ packages/frameworks/typescript/scanner-bridge.ts
  ✗ packages/frameworks/typescript/tagged-template.ts
  ✗ packages/frameworks/typescript/symbol-resolver.ts
  ✗ packages/frameworks/typescript/constant-propagation.ts
  ✗ packages/frameworks/typescript/collect-method-calls.ts
error: script "validate" exited with code 1
```

(7 entradas: la 6ª es `graphql-embedded.adapter.ts`; el `tests/…/graphql-embedded-adapter.spec.ts`
sí es válido.)

La regla del gate (líneas 82-89 de `scripts/gates/lint-naming.script.ts`) declara:

> Los frontends de lenguaje son su propio tipo de módulo, y el dir canónico es
> `packages/core/language-frontends/<lenguaje>/` con sufijo `.parser.ts` (con
> `index.ts` permitido).

a00015/a00016 en vez crearon `packages/frameworks/typescript/*.ts` y un
`.adapter` en `scanners/`, donde el gate solo permite `.scanner`, `.service`,
`.helper`, `.registry`, `index` y `legacy-discovery`. Implementación que el gate
no reconoce. **Es el hallazgo** y la prueba de por qué la disciplina de cierre
falló: se cerró a00014/15/16 marcando `done` mientras `bun run validate`
(local) era rojo en `lint:naming`.

## Non-goals

- No renombra los ficheros a mano en esta rama mientras otro agente sigue
  escribiendo slices de a00015/a00016 en develop — primero el acuerdo de destino.

## Slices

### S1 — Decidir destino (elección documentada)

- **Status**: pending
- **Files**: esta propuesta + `scripts/gates/lint-naming.script.ts`
- **Gate**: revisión de propuestas
- **Detalle**: dos caminos, elegir uno:

  **Opción A (la recomendada, sigue la regla del gate)**: mover los frontends
  multi-lenguaje a `packages/core/language-frontends/typescript/` con el prefijo
  `.parser.ts` (p. ej. `collect-method-calls.ts` → `collect-paths.parser.ts`,
  `tagged-template.ts` → `tagged-templates.parser.ts`, etc.) más un `index.ts`
  barril. Ajustar imports de los 6 scanners y specs; el `.adapter.ts` de
  graphql pasa a `graphql-embedded.adapter.ts` en `packages/core/discovery/`
  (donde `.adapter.ts` sí está permitido) o a un `.helper.ts` en scanners.

  **Opción B (relajar el gate)**: reconocer `packages/frameworks/typescript/`
  como directorio de frontend con sus sufijos actuales. **Ventaja**: sin churn de
  renombrado. **Desventaja**: el gate se afloja para acomodar a quien lo saltó,
  normalizando la inconsistencia. Esta opción necesita justificación escrita en
  `docs/NAMING.md`.

  La Opción A es más limpia. La regla "un parse por fichero, un sitio para los
  frontends" se alinea con el `buildLanguageIR()` propuesto en S6/a00016.

### S2 — Ejecutar el movimiento (depende de S1; tras la decisión)

- **Status**: pending
- **Files**: `git mv` de `packages/frameworks/typescript/*` → destino elegido
  + reexport + import rewrite + specs.
- **Gate**: `bun run validate`
- **Detalle**: el `validate` local pasa `lint:naming` y `lint:boundaries`
  (si el nuevo sitio en `core` importa algo de `frameworks`, cuidado: core no
  puede importar frameworks).

## acceptance

1. `bun run validate` **verde en local** sobre HEAD limpio (este es el hallazgo
   central: hoy no pasa).
2. `lint:naming` sin ficheros fuera de regla.
3. `docs/NAMING.md` refleja la decisión tomada (o la regla inalterada si Opción A).
4. Las propuestas a00015/a00016 pueden citar esta evidencia al cerrar.
