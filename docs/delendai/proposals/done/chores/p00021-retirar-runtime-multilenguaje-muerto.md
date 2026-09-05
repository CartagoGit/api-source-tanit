---
id: p00021
title: "p00021 — retirar `runtime/`: 1231 líneas muertas y solo-Laravel"
kind: chore
status: done
type: proposal
track: export-to-postman
date: 2026-08-06
related:
    - p00010 # el binario compilado cubre mejor el motivo por el que existía
    - p00020 # la reorganización de carpetas
    - p00022 # lo que SÍ hace falta por lenguaje
shippedIn:
  - 2f7b465  # cierre administrativo (x00032 S1 regla 2): SHA de creación del registro
---

> **Cerrada 2026-08-06.** Borradas las 1231 líneas de `runtime/`
> (node 290, python 348, php 593). Verificado antes de tocar nada:
> 0 referencias en todo el repo — ni en `package.json`, ni en los
> docs, ni en CI, ni en el propio código. El gate sigue en verde sin
> tocar nada más, que es la prueba de que estaba muerto.


# p00021 — retirar `runtime/`: 1231 líneas muertas y solo-Laravel

## Goal

Borrar `runtime/node/`, `runtime/python/` y `runtime/php/`.

## why

Son tres reimplementaciones independientes del generador, una por
lenguaje, escritas cuando el proyecto era solo-Laravel. Estado medido el
2026-08-06:

| | |
|---|---|
| Líneas | 1231 (`node` 290, `python` 348, `php` 593) |
| Referencias desde el resto del repo | **0** |
| Tests | **0** |
| Frameworks que cubren | **1** (Laravel), de 12 |
| Incluidas en el tarball (`files`) | no |

Sus propias cabeceras dicen "Descubre rutas PHP". No conocen ninguno de
los otros once scanners, ni el flujo de auth, ni la identidad estable de
colección, ni las reglas de validación. Un usuario que las ejecutase
obtendría un resultado peor y distinto del CLI, sin ningún aviso.

El motivo por el que existían —"para proyectos donde solo hay Node/npm",
"donde solo hay Python"— lo resuelve mejor el **binario autocontenido**
de p00010, que no necesita ningún runtime instalado y sí cubre los 12
frameworks.

Mantenerlas cuesta: cada cambio de contrato debería replicarse tres veces
en tres lenguajes sin tests. No se ha hecho, y por eso divergieron.

## non-goals

- Renunciar a ejecutar el proyecto desde otros lenguajes. Eso es p00022,
  y la vía correcta es un `bin/` que invoque **un único** motor, no
  reimplementarlo N veces.
- Borrar el historial. Los ficheros quedan en git.

## slices

### S1 — comprobar que de verdad no se usan
- **Gate**: `grep -rn "runtime/" --exclude-dir=node_modules .` vacío, y
  `runtime` ausente de `files` en `package.json`.

### S2 — retirar
- **Files**: borrar `runtime/`.
- **Gate**: `bun run validate` y `bun run validate:package`.

- Nota en el README de que el binario es la vía para entornos sin JS.
- **Acceptance**: los gates siguen verdes y el tarball no cambia.

## acceptance

- `runtime/` no existe.
- La documentación no lo menciona como opción.
- `docs/INSTALL.md` apunta al binario para ese caso de uso.
