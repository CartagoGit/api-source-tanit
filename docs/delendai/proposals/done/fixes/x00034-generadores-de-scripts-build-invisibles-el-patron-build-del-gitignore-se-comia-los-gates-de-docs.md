---
id: x00034
title: "Generadores de scripts/build/ invisibles: el patrón build/ del .gitignore se comía los gates de docs"
kind: fix
status: done
type: proposal
track: api-source-tanit
date: 2026-09-05
shippedIn:
  - beb26cd  # versionar scripts/build/ (api-reference, changelog, frameworks-table)
  - 01aefd1  # enlazar jsonc-parser en el store file: del core (dependencias transitivas)
---

# x00034 — `package.json` invoca 3 generadores que no llegaban al repo

## Goal

Que `bun run validate` pueda ejecutar `lint:api`, `lint:frameworks-table` y
`changelog` sin `Module not found`.

## Why

Hallado al correr `bun run validate` local (2026-09-05): `package.json` declara

```json
"changelog":   "bun run scripts/build/changelog.script.ts",
"docs:api":    "bun run scripts/build/api-reference.script.ts",
"lint:api":    "bun run scripts/build/api-reference.script.ts --check",
"docs:frameworks": "scripts/build/frameworks-table.script.ts"
```

Pero `scripts/build/` **no aparecía en `git ls-files`**. La causa real no era
"trabajo perdido en un dirty tree" como sospeché al abrirla: el `.gitignore`
tenía un patrón genérico `build/` (para ignorar `build/coverage` y similares)
que también se comía `scripts/build/`. Los generadores existían en disco pero
estaban invisibles para git → cada clon limpio (CI) moría en `lint:api`.

## Slices

### S1 — Versionar `scripts/build/`

- **Status**: done (beb26cd: anclar el patrón `build/` → `/build/` en el
  `.gitignore`, solo la raíz de compilación; `scripts/build/` vuelve a ser
  visible y los tres generadores quedan trackeados)

### S2 — Dependencias transitivas del enlace `file:`

- **Status**: done (01aefd1: `jsonc-parser`, dependencia del core del hermano,
  no se instala dentro del store `file:` de bun; el workflow la enlaza)

## acceptance

1. `bun run lint:api && bun run lint:frameworks-table` verdes en local y CI. ✅
2. `git ls-files scripts/build/` no vacío. ✅

## Cierre

Propuesta creada por esta revisión (snapshot 2026-09-05) y cerrada contra los
commits del agente paralelo que ejecutó el fix. Registros cruzados: el hole
"gate done sin artefacto verificado" que esta propuesta ejemplifica queda
cubierto por el gate propuesto en x00032.
