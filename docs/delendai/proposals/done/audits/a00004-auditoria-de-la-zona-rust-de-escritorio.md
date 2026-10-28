---
id: a00004
title: "auditoria de la zona Rust de escritorio"
kind: audit
status: done
type: proposal
track: export-to-postman
date: 2026-08-30
---

# a00004 — auditoría de la zona Rust de escritorio

## Goal

Auditar `packages/desktop/` (la única superficie del repo sin pasada:
la auditoría de 2026-08-29 la declara explícitamente "no auditada")
con los mismos criterios que el resto: build reproducible, permisos
de Tauri/sistema, side effects, secretos, empaquetado deb/dmg/msi y
coherencia entre lo que el workflow de release promete y lo que hace.

## why

`packages/desktop/` es la zona de distribución real hacia usuarios
finales (instaladores nativos) y es la que escapa a todos los gates
TS: `validate` no la toca, sus lints no la alcanzan, y
`docker:validate` (que cubriría su toolchain) no se ejecuta en local
sin daemon. Un problema ahí no se ve hasta que un usuario instala.

Attacker surface concreta: permisos del shell/plugins de Tauri, rutas
de descarga y actualización, firma de instaladores, y los comandos
que el frontend de escritorio puede ejecutar en el sistema.

## non-goals

- Cambiar la tecnología de escritorio ni añadir features.
- Auditar los workflows de release móvil/web (no existen).

## Slices

- global_gate: none

### S1 — Inventario y threat model de packages/desktop
- **Status**: done
- **Files**: esta propuesta canónica `a00004` (resultado de auditoría incluido)
- **Gate**: none
- acceptance:
  - "Queda escrito el inventario real (ficheros Rust/TS, permisos Tauri, comandos expuestos) y los trust boundaries"
  - "Build de escritorio reproducido al menos una vez en local (o documentado el bloqueo exacto si no hay toolchain)"

### S2 — Hallazgos con clasificación y destino
- **Status**: done
- **Files**: el mismo informe; propuestas hijas si hay fixes
- **Gate**: none
- acceptance:
  - "Cada hallazgo tiene clasificación, evidencia y propuesta o decisión explícita de no actuar"

## acceptance

- "La propuesta canónica contiene snapshot, hallazgos clasificados y cobertura declarada"
- "Los hallazgos CRITICAL/HIGH tienen propuesta creada o corrección hecha"

> **Cerrada 2026-08-30.** El resultado de la auditoría está incorporado en
> esta propuesta canónica `a00004`. Contiene el inventario, trust boundaries,
> hallazgos clasificados y decisiones de destino. No aparecieron hallazgos
> CRITICAL/HIGH. El build nativo queda documentado como no ejecutado por falta
> de toolchain Rust/Tauri y dependencias de plataforma en este entorno.
