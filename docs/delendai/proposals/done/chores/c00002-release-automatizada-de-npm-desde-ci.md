---
id: c00002
title: "release automatizada de npm desde CI"
kind: chore
status: done
type: proposal
track: export-to-postman
date: 2026-08-30
related:
  - p00008
shippedIn:
  - adf267f  # cierre administrativo (x00032 S1 regla 2): SHA de creación del registro
---

# c00002 — release automatizada de npm desde CI

## Goal

Que publicar a npm no dependa de que el dueño tenga credenciales en su
máquina: un workflow de release, disparado por tag, construya el paquete,
lo valide (`validate:package`) y lo publique con `npm publish --provenance`
desde CI.

## why

La auditoría de 2026-08-29 lo marca como riesgo operativo: "sin release
automatizada con credenciales de repo, cada versión es manual".
`p00008` (done) cerró la publicación manual del paquete; lo que queda
abierto es el cuello de botella: cada versión requiere la máquina y las
dependencias del dueño. Un release por tag con `NPM_TOKEN` en secrets
de repo elimina el cuello de botella y de paso añade provenance, que
hoy no existe.

## non-goals

- Binarios de escritorio y `build:binary`: quedan en sus workflows
  actuales (`release-desktop.yml`); esta propuesta solo toca el paquete npm.
- Cambios de versionado o changelog manual: siguen igual.

## Slices

- global_gate: none

### S1 — Workflow de release por tag
- **Status**: done
- **Files**: `.github/workflows/release-npm.yml` (nuevo)
- **Gate**: none (workflow; se valida a posteriori con el primer tag real)
- acceptance:
  - "El workflow corre `validate` completo antes de publicar"
  - "Publica con `--provenance` y `NPM_TOKEN` de secrets, solo en tag vX.Y.Z"
  - "`validate:package` (instalación real del tarball) es parte del gate"

## acceptance

- "Un tag vX.Y.Z en origin dispara build + validate + publish automático"
- "El paquete publicado lleva provenance y no requiere la máquina del dueño"

> **Cerrada 2026-08-30.** Añadido `.github/workflows/release-npm.yml`,
> limitado a tags `v*.*.*`, con `bun install --frozen-lockfile`,
> `bun run validate`, `bun run validate:package` y publicación con
> `npm publish --provenance` usando `NPM_TOKEN`. El disparo real de un tag
> queda pendiente de verificarse en GitHub Actions al publicar una versión.
