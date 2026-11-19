---
id: t00007
title: "Recuperar cobertura del actualizador firmado sin cambiar el producto"
kind: test
status: done
type: proposal
track: beta
date: 2026-11-19
last-transition-id: bc5ec2a8-3657-4a9f-b4dd-b3df933ff565
last-correlation-id: bc5ec2a8-3657-4a9f-b4dd-b3df933ff565
last-transition-from: review
last-transition-at: 2026-11-19T15:08:55.096Z
shipped-in:
  - "d98765f9"
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
- **Status**: done
- **Files**: `tests/release/updater.spec.ts`, `tests/desktop/updater-contract.rs`, `docs/UPDATER.md`
- **Gate**: none
- acceptance:
  - "El verificador rechaza firma inválida del instalador con hash del artefacto y firma del manifest válidos, distinguiendo el error de los del manifest y hash."
  - "Los tests atan comandos reales a manifest firmado, versión aprobada antes de descargar y verificación de hash y firma antes de escribir. Reutilizan helpers actuales sin recuperar tablas ni las 395 líneas históricas duplicadas."
  - "Los gates TypeScript y Rust existentes pasan con fixtures locales sin red ni D-Bus/keyring, sin modificar reglas, producto ni releases. Documentación concisa solo si aporta evidencia."
- shipped-in: `1c6bd1bfb104`
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-6.1-terra
- review-log: approved by openai-gpt-6.1-terra — verified at d98765f9, validate exit 0 and tests 59/59 claimed, no recorded run cited; acceptance 3/3: (1) tests/release/updater.spec.ts; CI 44481136868 test-coverage 19/19 (2) tests/desktop/updater-contract.rs diff 1c6bd1b; CI updater_contract 40/40 (3) CI 44481136868 typecheck, test-coverage, desktop-tests y clippy verdes; diff solo tests y docs — CI 44481136868: updater Vitest 19/19, updater_contract 40/40 y clippy exitosos; diff revisado.

## acceptance

- El verificador rechaza firma inválida del instalador con hash del artefacto y firma del manifest válidos, distinguiendo el error de los del manifest y hash.
- Los tests atan comandos reales a manifest firmado, versión aprobada antes de descargar y verificación de hash y firma antes de escribir. Reutilizan helpers actuales sin recuperar tablas ni las 395 líneas históricas duplicadas.
- Los gates TypeScript y Rust existentes pasan con fixtures locales sin red ni D-Bus/keyring, sin modificar reglas, producto ni releases. Documentación concisa solo si aporta evidencia.
