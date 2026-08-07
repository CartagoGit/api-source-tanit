---
id: p00018
title: "p00018 — gate de calidad autocontenido (`bun run validate`)"
kind: chore
status: done
type: proposal
track: export-to-postman
date: 2026-08-06
related:
    - p00011 # lint:tools forma parte del gate
    - p00016 # las suites homogéneas son parte del gate
---

> **Cerrada 2026-08-06.** Implementado: `bun run validate` = typecheck + lint:tools + test + validate:examples, más el workflow de CI.

# p00018 — gate de calidad autocontenido

## Goal

Un único comando, `bun run validate`, que se pueda ejecutar en limpio
sobre un clone reciente y diga sí o no. Hoy no existe tal comando.

## why

`mcp-vertex.config.json` declara `validationCommand: "bun run check"` como
la puerta que un agente debe pasar antes de cerrar una slice. Ejecutado en
limpio, falla:

```
$ bun run check
ENOENT: no such file or directory, open
  '.../build/unnamed.postman_collection.json'
error: script "check" exited with code 1
```

`check` encadena `diff.script.ts` y `validate-json.script.ts`, y ambos
asumen que ya existe una colección generada. Es decir: **el gate del
proyecto está rojo por diseño** salvo que hayas corrido `build` antes,
contra un proyecto host que el repo no incluye.

Y lo que sí importa no está en el gate: `tsc --noEmit` llevaba tiempo con
8 errores sin que nada lo señalara, y el cuelgue infinito del scanner de
Next.js habría sido evidente en cuanto `bun test` fuese obligatorio.

## non-goals

- Montar CI en GitHub Actions. Esto es el gate local; el workflow viene
  después y se limitará a invocarlo.
- Cubrir cobertura mínima. Útil, pero es otra propuesta.

## slices

### S1 — `bun run validate` encadenando los gates reales
- **Files**: `package.json`.
- **Gate**: `bun run validate` en verde sobre un clone limpio.

- `validate` = `typecheck` → `lint:tools` → `test`.
- `check` se redefine como lo que de verdad es: la verificación de una
  colección **ya generada**, y se documenta que necesita `build` antes.
- `mcp-vertex.config.json` apunta su `validationCommand` a `validate`.
- **Acceptance**: `git clone && bun install && bun run validate` en verde.

### S2 — smoke de generación real dentro del gate
- **Files**: `scripts/validate.script.ts` (nuevo).
- **Gate**: forma parte de `bun run validate`.

- Genera la colección de los 11 proyectos de `examples/` en un directorio
  temporal y verifica sobre cada una: schema v2.1.0, al menos un request,
  `_postman_id` presente, cero requests duplicadas y todo `{{var}}`
  declarado.
- Es la comprobación empírica de "este repo sabe sacar el fichero para
  Postman", ejecutada en cada cambio en lugar de a mano.
- **Acceptance**: romper un scanner hace fallar el gate con el nombre del
  ejemplo afectado.

### S3 — workflow de CI
- **Files**: `.github/workflows/validate.yml` (nuevo).
- **Gate**: verde en el primer push.

- Un job en `ubuntu-latest`, `oven-sh/setup-bun`, `bun install`,
  `bun run validate`.
- **Acceptance**: un PR que rompa tipos o tests sale en rojo.

## acceptance

- `bun run validate` es el único comando que un contribuidor necesita.
- El gate incluye tipos, lint, tests y generación real.
- Ningún gate depende de artefactos previos ni de proyectos externos.
