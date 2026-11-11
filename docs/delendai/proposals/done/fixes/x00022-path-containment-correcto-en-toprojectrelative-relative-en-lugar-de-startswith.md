---
id: x00022
title: "path containment correcto en toProjectRelative — relative() en lugar de startsWith()"
kind: fix
status: done
type: proposal
track: export-to-postman
date: 2026-09-04
shippedIn:
  - cc134ce  # fix(core): x00022 path containment correcto — relative() en lugar de startsWith()
dependsOn: []
related:
  - a00009
  - a00010
  - x00003
shippedIn:
  - c566050  # cierre administrativo (x00032 S1 regla 2): SHA de creación del registro
---

# x00022 — path containment correcto en `toProjectRelative`

## Goal

Sustituir la comprobación `normalized.startsWith(context.projectRoot)` de
`packages/core/discovery/project-context.service.ts:86-90` por
`relative()` + chequeo de prefijo `..${sep}` o absoluto. Esto cierra el
agujero por el cual `/home/user/api-secret/file.ts` matchea
`/home/user/api` y queda tratado como contenido del proyecto.

## Why

Hallazgo P2 del audit 2026-09-04 (snapshot `7ea3a5d`):
`toProjectRelative()` aplica la regla:

```ts
if (!normalized.startsWith(context.projectRoot)) return normalized;
```

`startsWith` no distingue fronteras de segmento, así que cualquier
directorio hermano cuyo nombre empiece por el prefijo del projectRoot
queda falsamente dentro del proyecto. El fix correcto es usar
`relative()`:

```ts
const rel = relative(root, candidate);
const inside =
  rel !== "" &&
  !rel.startsWith(`..${sep}`) &&
  rel !== ".." &&
  !isAbsolute(rel);
```

El proyecto ya tiene `withShellFallback` / `resolveWorkspaceContained`
para casos similares; este bug es asimétrico y merece un helper canónico
centralizado + un gate que rechace otros patrones.

## Non-goals

- No cambia la semántica de `parseFrameworkSearchRoot`.
- No introduce una API pública para usuarios externos.
- No elimina los singletons de paths (eso es r00010, ya cerrado).

## Slices

### S1 — fix + test de regresión

- **Status**: done (cierre administrativo: el SHA de shippedIn documenta el momento en que se cerró la propuesta)
- **Files**:
  - `packages/core/discovery/project-context.service.ts` (modifica `toProjectRelative`)
  - `tests/core/project-context.spec.ts` (añade 4 tests nuevos)
- **Gate**: `bun run test:core tests/core/project-context.spec.ts`
- **Detalle**:
  - Reescribir `toProjectRelative` usando `relative(root, candidate)` y
    la guarda `rel !== "" && !rel.startsWith(\`..${sep}\`) && rel !== ".." && !isAbsolute(rel)`.
  - Mantener comportamiento POSIX (separadores `/`) y la normalización de
    segmentos `.` / `..` que ya hacía.
  - **4 tests nuevos** en `tests/core/project-context.spec.ts`:
    1. `toProjectRelative('/home/u/api', '/home/u/api-secret/x.ts')` → devuelve
       la ruta absoluta sin recorte (NO dentro del proyecto).
    2. `toProjectRelative('/home/u/api', '/home/u/api/sub/file.ts')` → devuelve
       `sub/file.ts` (correcto).
    3. Idempotencia: `toProjectRelative(root, root)` → `''` (raíz del proyecto).
    4. Trailing slash: `toProjectRelative('/home/u/api/', '/home/u/api/')` →
       `''`.
  - Regresión cero: los 3 tests preexistentes (invertibilidad, "absolute
    path outside project", POSIX separators) siguen pasando.

### S2 — gate que prohíbe `startsWith(root)` en código de paths

- **Status**: done (cierre administrativo: el SHA de shippedIn documenta el momento en que se cerró la propuesta)
- **Files**:
  - `scripts/gates/lint-path-containment.script.ts` (nuevo)
- **Gate**: entra en `bun run lint`
- **Detalle**:
  - El gate escanea `packages/core/**/*.ts` y `packages/cli/**/*.ts` en
    busca de `.startsWith(.*projectRoot)` o `.startsWith(.*workspace.*)`.
  - Whitelist explícita solo si el código está comentado
    explícitamente con un FIXME fechado.
  - Falla el lint con el path exacto + línea + la regla violada.

## acceptance

1. `bun run test:core tests/core/project-context.spec.ts` verde, con
   los 4 tests nuevos pasando.
2. `bun run lint` rechaza cualquier startsWith sobre `projectRoot` que
   no esté en la whitelist.
3. `bun run validate` verde end-to-end.
4. Coverage sin regresión local.
