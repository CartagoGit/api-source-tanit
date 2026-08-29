---
id: r00001
title: "Identidad de endpoint: la causa raíz que ha mordido cuatro veces"
kind: refactor
status: done
type: proposal
track: export-to-postman
date: 2026-08-08
---

> **Cerrada 2026-08-08.** `route-identity.helper` responde una vez la
> pregunta que se respondía de tres formas, y `ParsedRoute.framework`
> retira `__params` con sus dos `as any`.
>
> **Lo que NO se unificó, a propósito**: el chequeo de duplicados de los
> invariantes. Pregunta otra cosa —compara la colección consigo misma— y
> normalizar ahí colapsaría el nombre del parámetro, convirtiendo el caso
> documentado de Laravel (`{{historico}}` contra `{{matricula}}`) en un
> aviso falso. Queda escrito en el helper.

# r00001 — Identidad de endpoint: la causa raíz que ha mordido cuatro veces

## Goal

Que una ruta sepa decir qué operación es y de qué scanner viene, y que todo el que hoy improvisa su propia clave use esa. Tres parches se convierten en una pieza.

## why

Hallazgos 3 (FATAL) y 6 (BAD) de a00001. `ParsedRoute` describe una ruta con `method`, `uri`, `sourceFile`, `prefixChain`… y nada que diga qué operación es ni de qué scanner viene. La suposición "la URL identifica la operación" vale en REST y no vale en GraphQL ni tRPC, donde hay un endpoint y lo que distingue una consulta de otra es el nombre. El mismo fallo ha aparecido cuatro veces y las tres primeras se parchearon una a una: `dedupeSpecs` hacía que un esquema entero produjera una request; los invariantes avisaban de las otras cuatro como duplicadas; `check` contaba 1 ruta de 5 y no detectaba deriva ninguna. La cuarta es `__params`, que el scanner de OpenAPI escribe y lee con `as any` porque no tiene forma de decir "esta ruta es mía" — y ahí el contrato deja de describir lo que circula por el pipeline. Nada impide la quinta.

## non-goals

- Cambiar el formato de la colección: el `_postman_id` y la identidad del documento no se tocan
- Unificar `EndpointSpec` con `ParsedRoute`: son dos capas y la traducción entre ellas es el adapter

## Slices

- global_gate: e2e

### S1 — El contrato: `framework` y clave de operación
- **Status**: done
- **Files**: `packages/core/contracts/scanner.interface.ts`, `packages/core/helpers/route-identity.helper.ts`, `tests/core/route-identity.helper.spec.ts`
- **Gate**: type
- acceptance:
  - "`ParsedRoute` lleva `framework`, que hoy no se puede saber desde la ruta"
  - "Una función única devuelve la clave de una operación: `método + uri` en REST, y con el nombre cuando el protocolo lo necesita"
  - "Los casos de GraphQL y tRPC están en el test, no solo el REST"

### S2 — Retirar `__params` y sus dos `as any`
- **Status**: done
- **DependsOn**: [S1]
- **Files**: `packages/frameworks/scanners/openapi.scanner.ts`, `tests/frameworks/openapi-hybrid.spec.ts`
- **Gate**: type
- acceptance:
  - "`supports()` decide por el `framework` de la ruta, no por una propiedad escondida"
  - "Cero `as any` en el fichero"
  - "Un test cubre el proyecto híbrido que era la razón de existir de `__params`: Express con un spec OpenAPI al lado"

### S3 — Los cuatro sitios que improvisaban su clave usan la misma
- **Status**: done
- **DependsOn**: [S1]
- **Files**: `packages/core/discovery/generation.pipeline.ts`, `packages/core/helpers/collection-invariants.helper.ts`, `packages/cli/commands/diff.script.ts`, `tests/e2e/route-identity-rpc.test.ts`
- **Gate**: e2e
- acceptance:
  - "`dedupeSpecs`, los invariantes y `check` llaman a la misma función"
  - "Un test recorre los tres sobre GraphQL y tRPC a la vez, que es donde los tres fallaron por separado"
  - "Los 21 ejemplos siguen generando colección válida"

## acceptance

- `ParsedRoute` lleva `framework`, que hoy no se puede saber desde la ruta
- Una función única devuelve la clave de una operación: `método + uri` en REST, y con el nombre cuando el protocolo lo necesita
- Los casos de GraphQL y tRPC están en el test, no solo el REST
- `supports()` decide por el `framework` de la ruta, no por una propiedad escondida
- Cero `as any` en el fichero
- Un test cubre el proyecto híbrido que era la razón de existir de `__params`: Express con un spec OpenAPI al lado
- `dedupeSpecs`, los invariantes y `check` llaman a la misma función
- Un test recorre los tres sobre GraphQL y tRPC a la vez, que es donde los tres fallaron por separado
- Los 21 ejemplos siguen generando colección válida
