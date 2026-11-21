---
id: x00104
title: "Sustituir las copias afectadas de picomatch en la cadena de herramientas"
kind: fix
status: done
type: proposal
track: dependencies
date: 2026-11-18
last-transition-id: 73b8f94e-1e22-44a2-917b-7321f668f01b
last-correlation-id: 73b8f94e-1e22-44a2-917b-7321f668f01b
last-transition-from: review
last-transition-at: 2026-11-19T20:45:15.383Z
shipped-in:
  - "3359658d039fe33ded1ab224e9a1f402951209e5"
---

# x00104 — Sustituir las copias afectadas de picomatch en la cadena de herramientas

## goal

Restablecer la auditoría y las pruebas de entrega tras el aviso GHSA-fc5q-39xc-vjpf.

## why

Angular, Vite y Vitest resuelven dependencias de picomatch afectadas. No hay versión oficial corregida publicada. Un fork público con el parche puede sustituirlas temporalmente si su contenido y compatibilidad se verifican.

## dependency resolution

The official [security advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
lists no patched upstream release. Use `@ryotsu/picomatch@4.0.7` as a temporary
replacement for every transitive `picomatch` resolution. The lockfile pins
the exact registry tarball and its integrity. The package contains the
[public fork patch](https://github.com/ryotsu-kankichi/secured-picomatch/commit/ef699ef45d5ad5ad976fb30d2939b4c814b7ca01).
The reviewed files match that commit. The entry points remain unchanged.
The fork also changes some bracket and globstar behavior, so the full
Tanit proof and an Angular production build are required.

Remove the override when an official patched release is available. Confirm
that Angular, Vite, Vitest and watcher dependencies all resolve to a corrected
version, then run the same frozen installation, audit and full validation.

## non-goals

- Omitir el aviso, modificar los umbrales de auditoría o cambiar la configuración de CI.
- Actualizar Angular, Vite, Vitest o dependencias ajenas al aviso.

## slices

- global_gate: e2e

### S1 — Fijar y verificar el reemplazo temporal
- **Status**: done
- **Files**: `package.json`, `bun.lock`, `docs/delendai/AGENT-BOOTSTRAP.md`, `docs/delendai/proposals/INDEX.md`
- **Gate**: e2e
- acceptance:
  - "La instalación congelada resuelve cada copia de picomatch al reemplazo exacto y el lock conserva el hash de integridad del paquete revisado."
  - "Comprobar el código e integridad contra el commit publicado, ejecutar la auditoría actual sin cambiar su alcance y ejecutar pruebas y build Angular."
  - "Registrar el criterio para retirar el reemplazo cuando el paquete oficial ofrezca una versión corregida, y conservar el mismo control de auditoría para todos los PR."
- shipped-in: `8ab94839b03d`
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-6.1-terra
- review-log: approved by openai-gpt-6.1-terra — verified at 3359658d039f, validate exit 0 and tests 1/1 claimed, no recorded run cited; acceptance 3/3: (1) override y bun.lock revisados; frozen install CI #161 (2) evidencia /tmp/tanit-review-picomatch.QKi6JL/result.json siete archivos y SHA512; CI #161 audit tests desktop build verdes (3) sección dependency resolution de propuesta y diff #161 sin cambios CI — CI #161 verde; evidencia de comparación de tarball y commit verificada por equipo.

## acceptance

- La instalación congelada resuelve cada copia de picomatch al reemplazo exacto y el lock conserva el hash de integridad del paquete revisado.
- Comprobar el código e integridad contra el commit publicado, ejecutar la auditoría actual sin cambiar su alcance y ejecutar pruebas y build Angular.
- Registrar el criterio para retirar el reemplazo cuando el paquete oficial ofrezca una versión corregida, y conservar el mismo control de auditoría para todos los PR.
