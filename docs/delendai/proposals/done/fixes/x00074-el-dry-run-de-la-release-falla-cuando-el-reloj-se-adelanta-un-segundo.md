---
id: x00074
title: "El dry run de la release falla cuando el reloj se adelanta un segundo"
kind: fix
status: done
type: proposal
track: general
date: 2026-11-02
last-transition-id: 902fa8ea-3d71-4280-9502-2b55455b97c4
last-correlation-id: 902fa8ea-3d71-4280-9502-2b55455b97c4
last-transition-from: review
last-transition-at: 2026-11-03T06:37:22.143Z
shippedIn: [3dff2e0aef25]
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
- **Status**: done
- **Files**: `scripts/release/prepare-artifacts.mjs`, `tests/release/signing.spec.ts`
- **Gate**: none
- review-state: done
- review-implementer: minimax-m3.1-flash-preview
- review-reviewer: minimax-m3.1-flash
- review-log: approved by minimax-m3.1-flash — verified at 3dff2e0a, validate exit 0 and tests 46/47 claimed, no recorded run cited — Revisión independiente de la entrega 3dff2e0a (fix(release): la clave desechable del dry run no depende del reloj), entregada por minimax-m3.1-flash-preview. La clave del dry run nace con --faked-system-time 20200101T000000 (scripts/release/prepare-artifacts.mjs:90 y :635-640), así que gpg no puede rechazarla por estar en el futuro aunque el reloj de la máquina se adelante un segundo. Ejecuté los specs de la slice: tests/release/signing.spec.ts da 46 tests en verde y 1 omitido, el que necesita la clave real de la release, que esta slice no toca.

## acceptance

- TODO: observable acceptance criteria.
shippedIn: [3dff2e0aef25]
