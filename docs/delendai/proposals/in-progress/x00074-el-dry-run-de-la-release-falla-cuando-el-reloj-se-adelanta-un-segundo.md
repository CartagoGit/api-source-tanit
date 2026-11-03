---
id: x00074
title: "El dry run de la release falla cuando el reloj se adelanta un segundo"
kind: fix
status: in-progress
type: proposal
track: general
date: 2026-11-02
last-transition-id: dc8abce0-1fb9-480e-b7d8-447092dd2cf7
last-correlation-id: dc8abce0-1fb9-480e-b7d8-447092dd2cf7
last-transition-from: ready
last-transition-at: 2026-11-03T02:37:39.476Z
---

# x00074 — El dry run de la release falla cuando el reloj se adelanta un segundo

## goal

Que la suite de release no falle —y la publicación no se bloquee— porque el reloj del sistema quedó un segundo por delante de sí mismo.

## why

La suite de release es flaky: el dry run genera una clave GPG desechable con el reloj del sistema, la exporta y la vuelve a importar en otro keyring. `gpg` rechaza una clave cuya fecha de creación esté en el futuro —«created 1 second in the future (time warp or clock problem)»— y la omite: el keyring importado queda vacío y el dry run muere con «The GPG keyring could not be imported». Bajo carga, el reloj se adelanta un segundo a sí mismo y el fallo aparece sin causa aparente: `tests/release/signing.spec.ts` y `tests/release/sbom.spec.ts` fallan de forma intermitente, y con ellos se bloquea `delendai work publish`, que exige que la prueba pase. La clave del dry run se tira al terminar: no necesita una fecha real.

## non-goals

- No se toca la clave real de la release, que es la que el usuario publica y verifica.
- No se baja la exigencia de los tests de firma: siguen probando que la firma verifica contra el keyring publicado.

## slices

- global_gate: none

### S1-clave-desechable-con-fecha-fija — S1 — La clave desechable del dry run se crea con una fecha fija
- **Status**: pending
- **Files**: `scripts/release/prepare-artifacts.mjs`, `tests/release/signing.spec.ts`
- **Gate**: none

## acceptance

- TODO: observable acceptance criteria.
