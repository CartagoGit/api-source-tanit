---
id: c00003
title: "Fijar Bun y hacer reproducible la CI"
kind: chore
status: done
type: proposal
track: export-to-postman
date: 2026-09-03
related:
  - p00007
  - a00009
  - a00010
  - a00011
shippedIn:
  - fb8cfe5  # cierre administrativo (x00032 S1 regla 2): SHA de creación del registro
---

# c00003 — fijar Bun y hacer reproducible la CI

## Goal

Evitar que los workflows dependan de la versión cambiante de `latest` y asegurar que todos los jobs instalan exactamente el lockfile comprometido.

## Contexto

La auditoría externa del 3 de septiembre de 2026 detectó que los workflows usaban `bun-version: latest` y que `release-desktop.yml` instalaba sin lockfile congelado. Eso permite que una actualización del runtime altere CI sin un cambio explícito en el repo.

La dependencia local de `@delendai/core` queda fuera y sigue bloqueada en `p00007` (paquete sin publicar).

## Qué se entregó

- Bun fijado a `1.3.14` en los cuatro workflows (validate, release-npm, release-binaries, release-desktop).
- `release-desktop.yml` usa `bun install --frozen-lockfile`.
- Gate nuevo `scripts/gates/lint-bun-ci.script.ts` (`bun run lint:bun-ci`), integrado en `bun run lint`:
  - exige versión semver concreta en cada `setup-bun`;
  - detecta `latest`/variables incluso con comentario YAML inline (el gate elimina comentarios respetando comillas antes de analizar);
  - analiza comandos dentro de bloques `run: |` multilínea y de una línea;
  - ignora comentarios y strings incidentales (`# bun install`, `echo "bun install"`);
  - detecta `bun install` sin `--frozen-lockfile` aunque el workflow no declare `setup-bun`.
- 7 tests focalizados en `tests/cli/lint-bun-ci.spec.ts`.
- Referencias obsoletas de `p00007` (`plugins/postman-exporter/…` → `packages/plugins/delendai_expostman/…`) corregidas.

## Definition of done

- [x] Ningún workflow usa `bun-version: latest`.
- [x] Ningún workflow usa `bun install` sin `--frozen-lockfile`.
- [x] El gate falla ante ambas derivas (7 tests) y pasa con los workflows corregidos.
- [x] `bun run validate` verde (typecheck 6/6, 24 lints, tests, 21/21 ejemplos, bench).

> **Cerrada 2026-09-03.** Evidencia: `lint:bun-ci — 4 workflow(s) revisado(s),
> sin deriva`; 7/7 tests del gate; `bun run validate` verde (136 archivos de
> test, 2826 tests, 21/21 ejemplos). Commits `79825b3` y el endurecimiento del
> gate del mismo día.
