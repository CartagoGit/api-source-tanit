---
id: x00027
title: "CI verde end-to-end - fix delendai sibling checkout en validate.yml"
kind: fix
status: ready
type: proposal
track: general
date: 2026-09-04
---

# x00027 — CI verde end-to-end - fix delendai sibling checkout en validate.yml

## Goal

Conseguir que bun run validate corra verde en GitHub Actions sobre develop. El workflow clona CartagoGit/delendai en ../delendai para que bun install --frozen-lockfile resuelva el file: que declara el plugin. El ultimo run (validate #318) fallo en ese checkout y salto los pasos posteriores, dejando CI rojo permanente desde hace 14+ commits.

## why

El estado actual de develop tiene CI roto en el primer paso material (Checkout delendai sibling). Mientras CI este rojo, ningun bun run validate real del HEAD se ejecuta en Actions - los commits solo se prueban en local, perdiéndose el gate independiente que protege develop de regresiones. Ademas, el repo ya esta en 1.0.0 sin que Actions haya validado nunca esa version.

## non-goals

- No cambiar el SHA pin sin acuerdo explicito
- No migrar al shape bunx hasta que el paquete este publicado
- No eliminar el plugin delendai_tanit
- No proteger develop con required checks hasta que CI pase verde

## Slices

- global_gate: e2e

### S1 — Diagnosticar el checkout delendai sibling
- **Status**: pending
- **Files**: `packages/contracts/constants/core/delendai-sha.constant.ts`
- **Gate**: none

### S2 — Fix del workflow para que el checkout delendai funcione
- **Status**: pending
- **DependsOn**: [S1]
- **Files**: `.github/workflows/validate.yml`
- **Gate**: type

### S3 — Validacion verde end-to-end en Actions
- **Status**: pending
- **DependsOn**: [S2]
- **Files**: `README.md`
- **Gate**: e2e

### S4 — Documentar el cambio si aplica
- **Status**: pending
- **DependsOn**: [S3]
- **Files**: `docs/delendai/proposals/README.md`
- **Gate**: none

## acceptance

- TODO: observable acceptance criteria.
