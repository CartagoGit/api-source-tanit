---
id: t00007
title: "Recuperar cobertura del actualizador firmado sin cambiar el producto"
kind: test
status: review
type: proposal
track: beta
date: 2026-11-19
last-transition-id: b886d0d4-d945-44a4-91a9-e5809251e0fa
last-correlation-id: b886d0d4-d945-44a4-91a9-e5809251e0fa
last-transition-from: in-progress
last-transition-at: 2026-11-19T07:17:31.795Z
---

# t00007 — Recuperar cobertura del actualizador firmado sin cambiar el producto

## goal

Recuperar las pruebas útiles omitidas en los squash de i00003: firma del instalador con manifest válido y comandos reales atados a manifest firmado, versión aprobada y verificación antes de escribir. Sin cambiar producto, releases ni reglas.

## why

La auditoría del archivo `refs/retired/minimax-m3/implement/i00003-S3-g1/updater-firmado` (`c552cfad`) encontró cobertura útil que no entró en los squash #37 (`27e27258`) y #39 (`03aaef88`). Los commits `96f0f602`, `09d6c760` y `e796a463` añaden pruebas de cableado y de la firma del instalador; el producto equivalente ya está integrado. Los tests actuales llaman las funciones Rust de hash/firma y corrompen la firma del manifest, pero no prueban la rama de firma del instalador del verificador ni atan todas las comprobaciones al comando que descarga.

La recuperación debe ser mínima: reutilizar `main_source` y `cuerpo_de_funcion`, mantener fixtures locales y añadir aserciones de orden o comportamiento donde aporten evidencia. La tabla histórica de 16 anclas y los helpers duplicados no son necesarios.

## non-goals

- No cambiar código de producto, formatos, claves, versiones, releases ni reglas de validación.
- No ejecutar D-Bus, keyring, servicios externos ni proyectos de terceros.
- No recuperar en bloque tablas, índices de superficie o las 395 líneas históricas.
- No modificar `f00020` ni propuestas archivadas.

## slices

- global_gate: none

### S1 — Cubrir firma del instalador y contrato de los comandos reales
- **Status**: review
- **Files**: `tests/release/updater.spec.ts`, `tests/desktop/updater-contract.rs`, `docs/UPDATER.md`
- **Gate**: none
- acceptance:
  - "El verificador rechaza firma inválida del instalador con hash del artefacto y firma del manifest válidos, distinguiendo el error de los del manifest y hash."
  - "Los tests atan comandos reales a manifest firmado, versión aprobada antes de descargar y verificación de hash y firma antes de escribir. Reutilizan helpers actuales sin recuperar tablas ni las 395 líneas históricas duplicadas."
  - "Los gates TypeScript y Rust existentes pasan con fixtures locales sin red ni D-Bus/keyring, sin modificar reglas, producto ni releases. Documentación concisa solo si aporta evidencia."
- shipped-in: `1c6bd1bfb104`
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol

## acceptance

- El verificador rechaza firma inválida del instalador con hash del artefacto y firma del manifest válidos, distinguiendo el error de los del manifest y hash.
- Los tests atan comandos reales a manifest firmado, versión aprobada antes de descargar y verificación de hash y firma antes de escribir. Reutilizan helpers actuales sin recuperar tablas ni las 395 líneas históricas duplicadas.
- Los gates TypeScript y Rust existentes pasan con fixtures locales sin red ni D-Bus/keyring, sin modificar reglas, producto ni releases. Documentación concisa solo si aporta evidencia.
