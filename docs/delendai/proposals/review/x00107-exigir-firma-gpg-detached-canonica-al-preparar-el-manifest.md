---
id: x00107
title: "Exigir firma GPG detached canónica al preparar el manifest"
kind: fix
status: review
type: proposal
track: beta
date: 2026-11-19
last-transition-id: 1384525e-9a7e-4134-868f-aef8da4fba94
last-correlation-id: 1384525e-9a7e-4134-868f-aef8da4fba94
last-transition-from: in-progress
last-transition-at: 2026-11-19T00:22:05.989Z
---

# x00107 — Exigir firma GPG detached canónica al preparar el manifest

## goal

Impedir que un recibo GPG produzca un manifest que apunta al instalador u omite la firma: exigir directamente el sidecar regular canónico, preservando firmas embebidas y verificación existente.

## why

La ejecución de CI `44426868409` falló en `it does not write into the staging it verifies`: el manifest describía un recibo GPG del `.deb`, pero el verificador encontró su `.deb.sig` sin describir. El código permitía `detached.get(entry.relPath) ?? entry.relPath`; para `SHA256SUMS` omitía la firma si el listado previo no la incluía. Esto demuestra una degradación silenciosa permitida por el constructor, no la causa de una carrera de archivos.

El recibo real tiene `kind: gpg-detached`. Su ruta se deriva del propietario y se comprueba con `lstat` directamente, sin depender de que aparezca en el listado. La ausencia o un objeto no regular deben impedir escribir el nuevo manifest. Las firmas embebidas conservan su comportamiento.

## non-goals

- No modificar verificadores, reglas de validación, versiones ni publicación de releases.
- No tocar staging ajeno, keyring del usuario, credenciales o D-Bus.
- No implementar `t00007` ni modificar `f00020`.
- No atribuir el incidente a una carrera sin evidencia.

## slices

- global_gate: none

### S1 — Exigir sidecar GPG regular y cubrir ausencia y dry run
- **Status**: review
- **Files**: `scripts/release/prepare-artifacts.mjs`, `tests/release/signing.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Con recibo GPG y sin sidecar .sig regular canónico, preparar el manifest falla claramente sin apuntar al instalador, para artefactos y SHA256SUMS."
  - "El dry run positivo describe las firmas GPG como archivos .sig canónicos y pasa la verificación portable existente sin escribir en el staging."
  - "La regresión usa fixtures locales sin secretos ni staging ajeno; no atribuye una carrera no probada, no debilita verificación ni modifica reglas, releases o t00007."
- shipped-in: `08108e8f29e4`
- review-state: in_review
- review-implementer: openai-gpt-6.1-sol

## acceptance

- Con recibo GPG y sin sidecar .sig regular canónico, preparar el manifest falla claramente sin apuntar al instalador, para artefactos y SHA256SUMS.
- El dry run positivo describe las firmas GPG como archivos .sig canónicos y pasa la verificación portable existente sin escribir en el staging.
- La regresión usa fixtures locales sin secretos ni staging ajeno; no atribuye una carrera no probada, no debilita verificación ni modifica reglas, releases o t00007.
