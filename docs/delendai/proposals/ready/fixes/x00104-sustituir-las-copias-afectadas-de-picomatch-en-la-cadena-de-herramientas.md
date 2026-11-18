---
id: x00104
title: "Sustituir las copias afectadas de picomatch en la cadena de herramientas"
kind: fix
status: ready
type: proposal
track: dependencies
date: 2026-11-18
---

# x00104 — Sustituir las copias afectadas de picomatch en la cadena de herramientas

## goal

Restablecer la auditoría y las pruebas de entrega tras el aviso GHSA-fc5q-39xc-vjpf.

## why

Angular, Vite y Vitest resuelven dependencias de picomatch afectadas. No hay versión oficial corregida publicada. Un fork público con el parche puede sustituirlas temporalmente si su contenido y compatibilidad se verifican.

## non-goals

- Omitir el aviso, modificar los umbrales de auditoría o cambiar la configuración de CI.
- Actualizar Angular, Vite, Vitest o dependencias ajenas al aviso.

## slices

- global_gate: e2e

### S1 — Fijar y verificar el reemplazo temporal
- **Status**: pending
- **Files**: `package.json`, `bun.lock`, `docs/delendai/AGENT-BOOTSTRAP.md`, `docs/delendai/proposals/INDEX.md`
- **Gate**: e2e
- acceptance:
  - "La instalación congelada resuelve cada copia de picomatch al reemplazo exacto y el lock conserva el hash de integridad del paquete revisado."
  - "Comprobar el código e integridad contra el commit publicado, ejecutar la auditoría actual sin cambiar su alcance y ejecutar pruebas y build Angular."
  - "Registrar el criterio para retirar el reemplazo cuando el paquete oficial ofrezca una versión corregida, y conservar el mismo control de auditoría para todos los PR."

## acceptance

- La instalación congelada resuelve cada copia de picomatch al reemplazo exacto y el lock conserva el hash de integridad del paquete revisado.
- Comprobar el código e integridad contra el commit publicado, ejecutar la auditoría actual sin cambiar su alcance y ejecutar pruebas y build Angular.
- Registrar el criterio para retirar el reemplazo cuando el paquete oficial ofrezca una versión corregida, y conservar el mismo control de auditoría para todos los PR.
