---
id: t00007
title: "Recuperar cobertura del actualizador firmado sin cambiar el producto"
kind: test
status: ready
type: proposal
track: beta
date: 2026-11-19
---

# t00007 — Recuperar cobertura del actualizador firmado sin cambiar el producto

## goal

Recuperar las pruebas útiles omitidas en los squash de i00003: firma del instalador con manifest válido y comandos reales atados a manifest firmado, versión aprobada y verificación antes de escribir. Sin cambiar producto, releases ni reglas.

## why

TODO: why this work matters now.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: none

### S1 — Cubrir firma del instalador y contrato de los comandos reales
- **Status**: pending
- **Files**: `tests/release/updater.spec.ts`, `tests/desktop/updater-contract.rs`, `docs/UPDATER.md`
- **Gate**: none
- acceptance:
  - "El verificador rechaza firma inválida del instalador con hash del artefacto y firma del manifest válidos, distinguiendo el error de los del manifest y hash."
  - "Los tests atan comandos reales a manifest firmado, versión aprobada antes de descargar y verificación de hash y firma antes de escribir. Reutilizan helpers actuales sin recuperar tablas ni las 395 líneas históricas duplicadas."
  - "Los gates TypeScript y Rust existentes pasan con fixtures locales sin red ni D-Bus/keyring, sin modificar reglas, producto ni releases. Documentación concisa solo si aporta evidencia."

## acceptance

- El verificador rechaza firma inválida del instalador con hash del artefacto y firma del manifest válidos, distinguiendo el error de los del manifest y hash.
- Los tests atan comandos reales a manifest firmado, versión aprobada antes de descargar y verificación de hash y firma antes de escribir. Reutilizan helpers actuales sin recuperar tablas ni las 395 líneas históricas duplicadas.
- Los gates TypeScript y Rust existentes pasan con fixtures locales sin red ni D-Bus/keyring, sin modificar reglas, producto ni releases. Documentación concisa solo si aporta evidencia.
