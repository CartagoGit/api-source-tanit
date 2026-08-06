---
id: p00016
title: "p00016 — suites homogéneas por framework con mocks reutilizables"
kind: test
status: done
type: proposal
track: postman-exporter
date: 2026-08-06
related:
    - p00009 # vitest suite core
---

> **Cerrada 2026-08-06.** S1 y S2 hechos: `scanner-fixture.ts` y
> `describeScannerContract` aplicado a los 12 scanners (+147 tests). S3 (contrato
> equivalente sobre la colección en los e2e) queda pendiente.

# p00016 — suites homogéneas por framework con mocks reutilizables

## Goal

Que los 12 frameworks se prueben **contra el mismo contrato**: una tabla
de casos compartida que cada framework instancia con su fixture, en lugar
de 12 suites escritas a mano que cubren cosas distintas.

## why

Hoy la cobertura por framework es desigual y no es evidente qué falta.
Conteo actual de tests unitarios por scanner:

```
aspnet 8   django 7   express 7   fastapi 7   flask 9   gin 8
laravel 9  nestjs 6   nextjs 8    openapi 8   springboot 8   symfony 10
```

Los números parecidos esconden que **no prueban lo mismo**. Ejemplos
reales encontrados en la auditoría:

- Sólo Symfony tenía test de "no duplica endpoints" — y estaba escrito
  al revés, asertando que **sí** duplicaba.
- Sólo Laravel probaba la resolución de bodies desde reglas de
  validación de forma exhaustiva.
- Ningún scanner tenía test de "`sourceFile` es relativo al proyecto",
  que es precisamente lo que estaba roto en Symfony.
- Ningún scanner tenía test de "un endpoint comentado no aparece".

Además el setup se repite: cada spec construye a mano su `IProjectMatch`,
y `laravel-scanner.spec.ts` llega a montar un proyecto Laravel completo en
`mkdtemp` con `mkdir`/`copyFile` línea a línea (ahí vivía el bug de
`mkdir("artisan")` sobre un fichero).

## non-goals

- Sustituir los fixtures comprehensive. Siguen siendo la prueba de
  integración realista; esto es la capa de contrato por encima.
- Forzar que todos los frameworks pasen todos los casos. Algunos no
  aplican (Gin no tiene FormRequests). El contrato declara qué casos son
  obligatorios y cuáles opcionales por capacidad.

## slices

### S1 — `tests/helpers/scanner-fixture.ts`: builder de proyectos temporales
- **Files**: `tests/helpers/scanner-fixture.ts` (nuevo).
- **Gate**: `bun test tests/unit/scanner-fixture.spec.ts`.

- `createTempProject({ files: Record<string, string> })` monta un árbol
  temporal desde un mapa ruta→contenido, crea los directorios padre solos
  y devuelve `{ root, cleanup }`.
- `matchFor(framework, root)` construye el `IProjectMatch` vía el registry
  en lugar de a mano.
- Reemplaza el setup manual de `laravel-scanner.spec.ts` y de cualquier
  otro spec que monte directorios.
- **Acceptance**: ningún spec vuelve a llamar a `mkdtemp`/`mkdir`
  directamente.

### S2 — tabla de contrato compartida
- **Files**: `tests/helpers/scanner-contract.ts` (nuevo).
- **Gate**: `bun test tests/unit/*-scanner.spec.ts`.

- `describeScannerContract({ framework, fixtureRoot, capabilities })`
  genera los casos comunes:
  1. `detect()` > 0 en su fixture y === 0 en un directorio vacío.
  2. `scan()` no devuelve endpoints duplicados (method+uri).
  3. Todo `sourceFile` es relativo al proyecto y existe en disco.
  4. Todo `method` está en la lista de verbos HTTP soportados.
  5. Toda `uri` empieza por `/` y no contiene `//`.
  6. Un endpoint comentado en el fuente no aparece.
  7. `scan()` sobre un directorio vacío devuelve `[]` sin lanzar.
  8. Si `capabilities.validation`: el provider resuelve al menos un
     campo en el POST principal, con `location` válida.
  9. Si `capabilities.pathParams`: los params de path se extraen.
- Cada `*-scanner.spec.ts` invoca el contrato y añade **solo** lo
  específico de su framework.
- **Acceptance**: los 12 scanners pasan los casos obligatorios; las
  excepciones se declaran explícitamente en `capabilities`, no por
  omisión.

### S3 — igualar los e2e comprehensive
- **Files**: `tests/helpers/collection-contract.ts` (nuevo),
  `tests/e2e/*-comprehensive.test.ts`.
- **Gate**: `bun test tests/e2e/`.

- `describeCollectionContract(fixtureName)` verifica sobre la colección
  generada: schema v2.1.0, cero requests duplicadas, toda url resoluble,
  todo `{{var}}` declarado en variables o environment, carpetas no
  vacías, y `_postman_id` presente y estable (p00014).
- **Acceptance**: los 12 e2e comparten ese bloque; lo propio de cada
  framework queda debajo.

## acceptance

- `bun test` sigue en verde y por debajo de 5 s.
- Añadir un scanner nuevo exige escribir su fixture y una línea de
  contrato; los 9 casos comunes salen gratis.
- Un bug como el de la duplicación de Symfony falla en 12 sitios a la
  vez, no en cero.
