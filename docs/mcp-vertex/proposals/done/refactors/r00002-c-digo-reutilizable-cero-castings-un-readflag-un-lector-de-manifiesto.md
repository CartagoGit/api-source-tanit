---
id: r00002
title: "Código reutilizable: cero castings, un readFlag, un lector de manifiesto"
kind: refactor
status: done
type: proposal
track: export-to-postman
date: 2026-08-08
---

> **Cerrada 2026-08-08.** Cero aserciones de tipo salvo una declarada
> con motivo (el doble del `McpServer`, tipo de terceros). Un solo
> `readFlag`, que además acepta `--flag=valor`. `walk.helper` para el
> tooling.
>
> **El hallazgo de fondo**: ninguno de los cuatro castings de producción
> hacía falta — los cuatro tapaban una **declaración equivocada**, no un
> problema del código. Tres de los de tests sobraban directamente.

# r00002 — Código reutilizable: cero castings, un readFlag, un lector de manifiesto

## Goal

Que el compilador vuelva a poder contradecir al código, y que las tres preguntas que el repo se hace siete veces —¿qué flag hay?, ¿qué declara este manifiesto?, ¿esto es un Uint8Array?— tengan una sola respuesta.

## why

Hallazgos 8, 9, 10 y 15 de a00001. Veintiún castings apagan el compilador: `as unknown as T` es una aserción que no se puede contradecir, y ninguno de los cuatro de producción hace falta — `Buffer` **es** un `Uint8Array`, y lo que miente es la declaración ambient escrita a mano, no el código. Ya pasó factura: los doce `as never` de `readdir` corregidos en `ecb9505` escondían un tipo que llevaba tiempo mintiendo. `readFlag` tiene cuatro copias y las dos del núcleo discrepan en cómo dicen "no está" (`string | null` contra `string | undefined`), así que quien escriba `?? ""` acertará en dos sitios y fallará en los otros dos. Y la detección por manifiesto está reimplementada siete veces con reglas distintas sobre `devDependencies`: un framework declarado ahí se detecta o no según cuál sea el scanner.

## non-goals

- Instalar `@types/node`: las declaraciones a mano existen para que el binario compilado no arrastre tipos de un runtime que puede no estar
- Tocar los scanners que no leen manifiestos de Node: Python y Go van en su propio slice porque su forma es otra

## Slices

- global_gate: type

### S1 — Arreglar las declaraciones que obligan a mentir
- **Status**: done
- **Files**: `packages/core/contracts/postman.d.ts`, `packages/core/helpers/collection-identity.helper.ts`, `packages/plugins/mcp-vertex_expostman/src/lib/helpers/runner.helper.ts`
- **Gate**: type
- acceptance:
  - "`Buffer` se declara como lo que es, un `Uint8Array`, y el casting de `collection-identity` desaparece sin sustituto"
  - "La salida de `spawnSync` se tipa de verdad y los dos castings de `runner.helper` desaparecen"
  - "Cero castings en producción fuera de los dos de `openapi.scanner`, que se van en r00001"

### S2 — Factorías tipadas en vez de aserciones en los tests
- **Status**: done
- **Files**: `tests/helpers/postman-builders.ts`, `tests/core/collection-invariants.helper.spec.ts`, `tests/core/postman-api.service.spec.ts`, `tests/core/auth-flow.service.spec.ts`, `tests/frameworks/python-schema.helper.spec.ts`, `tests/e2e/flask-comprehensive.test.ts`
- **Gate**: type
- acceptance:
  - "Construir un item inválido a propósito se hace con una factoría que declara qué le falta, no con `as unknown as`"
  - "El stub de `fetch` se inyecta por una interfaz estrecha, no se castea sobre `typeof fetch`"
  - "Cero castings en `tests/`"

### S3 — Lint que prohíba que vuelvan
- **Status**: done
- **DependsOn**: [S1, S2]
- **Files**: `scripts/gates/lint-no-type-escapes.script.ts`, `tests/cli/no-type-escapes.spec.ts`, `package.json`
- **Gate**: lint
- acceptance:
  - "El lint falla ante `as any`, `as unknown as`, `as never`, `@ts-ignore` y `@ts-expect-error`"
  - "Se comprueba metiendo uno y viendo romper el gate"
  - "Entra en la cadena de `bun run lint`"

### S4 — Un solo `readFlag`
- **Status**: done
- **Files**: `packages/core/helpers/argv.helper.ts`, `packages/core/discovery/project-loader.service.ts`, `packages/core/discovery/project-context.service.ts`, `packages/cli/commands/push.script.ts`, `tests/core/argv.helper.spec.ts`
- **Gate**: type
- acceptance:
  - "Una implementación, un tipo de retorno, y el criterio de por qué ese y no el otro escrito al lado"
  - "Las cuatro copias desaparecen, incluida la que se llamaba `flag`"
  - "El test cubre `--flag valor`, `--flag=valor`, flag ausente y flag sin valor"

### S5 — Un lector de manifiesto por ecosistema
- **Status**: done
- **Files**: `packages/frameworks/parsers/manifest.helper.ts`, `packages/frameworks/scanners/hono.scanner.ts`, `packages/frameworks/scanners/fastify.scanner.ts`, `packages/frameworks/scanners/express.scanner.ts`, `packages/frameworks/scanners/nextjs.scanner.ts`, `packages/frameworks/scanners/nestjs.scanner.ts`, `packages/frameworks/scanners/graphql.scanner.ts`, `packages/frameworks/scanners/trpc.scanner.ts`, `tests/frameworks/manifest.helper.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Los siete scanners de Node preguntan por el mismo sitio"
  - "La regla sobre `devDependencies` es una, está escrita y está probada: hoy unos las miran y otros no"
  - "Un `package.json` roto da el mismo resultado en los siete"
  - "Los 21 ejemplos siguen detectándose"

### S6 — Partir el `main()` de 325 líneas de `generate`
- **Status**: done
- **DependsOn**: [S4]
- **Files**: `packages/cli/commands/generate.script.ts`, `tests/cli/generate-phases.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Cada fase —descubrir, construir, auth, enriquecer, exportar, escribir, informar— es una función con nombre y con test propio"
  - "El comando principal deja de ser el sitio donde se concentra el riesgo de regresión"
  - "La salida por pantalla no cambia: es contrato con quien lo usa"

## acceptance

- `Buffer` se declara como lo que es, un `Uint8Array`, y el casting de `collection-identity` desaparece sin sustituto
- La salida de `spawnSync` se tipa de verdad y los dos castings de `runner.helper` desaparecen
- Cero castings en producción fuera de los dos de `openapi.scanner`, que se van en r00001
- Construir un item inválido a propósito se hace con una factoría que declara qué le falta, no con `as unknown as`
- El stub de `fetch` se inyecta por una interfaz estrecha, no se castea sobre `typeof fetch`
- Cero castings en `tests/`
- El lint falla ante `as any`, `as unknown as`, `as never`, `@ts-ignore` y `@ts-expect-error`
- Se comprueba metiendo uno y viendo romper el gate
- Entra en la cadena de `bun run lint`
- Una implementación, un tipo de retorno, y el criterio de por qué ese y no el otro escrito al lado
- Las cuatro copias desaparecen, incluida la que se llamaba `flag`
- El test cubre `--flag valor`, `--flag=valor`, flag ausente y flag sin valor
- Los siete scanners de Node preguntan por el mismo sitio
- La regla sobre `devDependencies` es una, está escrita y está probada: hoy unos las miran y otros no
- Un `package.json` roto da el mismo resultado en los siete
- Los 21 ejemplos siguen detectándose
- Cada fase —descubrir, construir, auth, enriquecer, exportar, escribir, informar— es una función con nombre y con test propio
- El comando principal deja de ser el sitio donde se concentra el riesgo de regresión
- La salida por pantalla no cambia: es contrato con quien lo usa
