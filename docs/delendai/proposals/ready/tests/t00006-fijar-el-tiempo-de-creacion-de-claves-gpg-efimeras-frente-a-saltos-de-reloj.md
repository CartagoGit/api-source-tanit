---
id: t00006
title: "Fijar el tiempo de creación de claves GPG efímeras frente a saltos de reloj"
kind: test
status: ready
type: proposal
track: quality
date: 2026-11-10
---

# t00006 — Fijar el tiempo de creación de claves GPG efímeras frente a saltos de reloj

## goal

Evitar fallos Time conflict en fixtures sin relajar verificaciones de firma del producto.

## why

La entrega aislada del fix AST falló en createThrowawayKeyring porque la clave era un segundo futura durante su autofirma. El mismo código pasó previamente la validación completa. GPG compara tiempos dentro de generación y un reloj WSL que retrocede puede romper la fixture.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: none

### S1 — S1
- **Status**: pending
- **Files**: `tests/release/signing.spec.ts`
- **Gate**: e2e
- acceptance:
  - "La fixture genera claves con reloj de prueba estable anterior al actual; firmas y verificadores reales conservan sus comprobaciones de tiempo."
  - "La suite de firma real valida claves protegidas y no protegidas sin pinentry gráfico, sin cambiar el almacén personal ni ignorar Time conflict."
  - "No modificar scripts de firma o validación de producción para ocultar la condición."

## acceptance

- La fixture genera claves con reloj de prueba estable anterior al actual; firmas y verificadores reales conservan sus comprobaciones de tiempo.
- La suite de firma real valida claves protegidas y no protegidas sin pinentry gráfico, sin cambiar el almacén personal ni ignorar Time conflict.
- No modificar scripts de firma o validación de producción para ocultar la condición.
