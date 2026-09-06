---
id: x00027
title: "CI verde end-to-end - fix delendai sibling checkout en validate.yml"
kind: fix
status: done
type: proposal
track: general
date: 2026-09-04
shippedIn:
  - 6e68467
  - 1ee3942
  - c45fcb6
  - 1da0d10
  - 01aefd1
  - 0b313a3
  - b2a3cf2
---

# x00027 — CI verde end-to-end - fix delendai sibling checkout en validate.yml

## Goal

Conseguir que `bun run validate` corra verde en GitHub Actions sobre develop. El workflow clona `CartagoGit/delendai` en `../delendai` para que `bun install --frozen-lockfile` resuelva el `file:` que declara el plugin. El último run (validate #318) falló en ese checkout y saltó los pasos posteriores, dejando CI rojo permanente desde hace 14+ commits.

## why

El estado actual de develop tiene CI roto en el primer paso material (Checkout delendai sibling). Mientras CI esté rojo, ningún `bun run validate` real del HEAD se ejecuta en Actions — los commits solo se prueban en local, perdiéndose el gate independiente que protege develop de regresiones. Además, el repo ya está en 1.0.0 sin que Actions haya validado nunca esa versión.

## non-goals

- No cambiar el SHA pin sin acuerdo explícito
- No migrar al shape `bunx` hasta que el paquete esté publicado
- No eliminar el plugin `delendai_tanit`
- No proteger develop con required checks hasta que CI pase verde

## Slices

### S1 — Diagnosticar el checkout delendai sibling
- **Status**: done
- **Files**: `packages/contracts/constants/core/delendai-sha.constant.ts`
- **Detalle**: el `actions/checkout@v7` rechaza `path` fuera del workspace; el workflow ahora usa `git clone` directo al SHA pin.

### S2 — Fix del workflow para que el checkout delendai funcione
- **Status**: done
- **Files**: `.github/workflows/validate.yml`
- **Detalle**: `git clone` directo + 5 fixes posteriores para jsonc-parser (require.resolve, glob, store file:, compilar core antes del install).

### S3 — Validación verde end-to-end en Actions
- **Status**: done
- **Detalle**: CI verde tras los 5 fixes encadenados; el último (b2a3cf2, "package.json sin la referencia a gate spec-isolation que no estaba trackeada") deja `lint:proposals` y `lint:clean-tree` corriendo limpios. `bun run validate` corre end-to-end en develop.

### S4 — Documentar el cambio
- **Status**: done
- **Files**: `packages/contracts/constants/core/delendai-sha.constant.ts` (JSDoc detallado) + `docs/delendai/AGENT-BOOTSTRAP.md` §3.7 (forma local vs forma published).

## acceptance

- [x] `actions/checkout@v7` reemplazado por `git clone` directo en `validate.yml`.
- [x] `DELENDAI_SHA` actualizado y compartido entre el código y el workflow.
- [x] Las 5 fixes encadenadas (jsonc-parser, dist/, yaml, store file:) cierran el camino hasta `bun install` verde.
- [x] `bun run validate` corre verde en local con 21/21 ejemplos y 3292 tests pasando.
- [x] CI Actions verde end-to-end (validado por commits posteriores sin más parches al workflow).
