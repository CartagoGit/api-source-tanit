---
id: x00107
title: "Exigir firma GPG detached canónica al preparar el manifest"
kind: fix
status: ready
type: proposal
track: beta
date: 2026-11-19
---

# x00107 — Exigir firma GPG detached canónica al preparar el manifest

## goal

Impedir que un recibo GPG produzca un manifest que apunta al instalador u omite la firma: exigir directamente el sidecar regular canónico, preservando firmas embebidas y verificación existente.

## why

TODO: why this work matters now.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: none

### S1 — Exigir sidecar GPG regular y cubrir ausencia y dry run
- **Status**: pending
- **Files**: `scripts/release/prepare-artifacts.mjs`, `tests/release/signing.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Con recibo GPG y sin sidecar .sig regular canónico, preparar el manifest falla claramente sin apuntar al instalador, para artefactos y SHA256SUMS."
  - "El dry run positivo describe las firmas GPG como archivos .sig canónicos y pasa la verificación portable existente sin escribir en el staging."
  - "La regresión usa fixtures locales sin secretos ni staging ajeno; no atribuye una carrera no probada, no debilita verificación ni modifica reglas, releases o t00007."

## acceptance

- Con recibo GPG y sin sidecar .sig regular canónico, preparar el manifest falla claramente sin apuntar al instalador, para artefactos y SHA256SUMS.
- El dry run positivo describe las firmas GPG como archivos .sig canónicos y pasa la verificación portable existente sin escribir en el staging.
- La regresión usa fixtures locales sin secretos ni staging ajeno; no atribuye una carrera no probada, no debilita verificación ni modifica reglas, releases o t00007.
