---
id: x00005
title: "`check` dice que hay deriva en 13 de 22 proyectos recien generados"
kind: fix
status: done
type: proposal
track: export-to-postman
date: 2026-08-11
---

> **Cerrada el mismo dia.** El test de S1 fallaba en los 13 medidos y
> ahora pasan los 23 ejemplos.
>
> De los tres defectos que la propuesta describia, **uno no existia**:
> `normalizeForComparison` ya unificaba las cuatro sintaxis de parametro
> (`:id`, `{id}`, `<int:id>`, `{{id}}`). Lo comprobe leyendo el helper en
> vez de fiarme del sintoma — `/api/users/:id` y `/api/users/{{id}}`
> aparecian como deriva por el **segundo** defecto, no por el primero.
> S2 se queda sin trabajo.
>
> Los otros dos si:
>
> · **El nombre entraba asimetrico.** El scanner REST no emite
>   `displayName`; la coleccion siempre tiene nombre de request, derivado
>   de la URI por el constructor. `GET /api/orders`, sin un solo
>   parametro, salia a la vez en «falta» y en «sobra».
>
> · **Laravel comparaba contra el camino legacy** (7 rutas frente a las
>   17 del pipeline). La rama `match.framework !== "laravel"` ha
>   desaparecido: `check` no puede tener una excepcion para uno de los
>   veintiun frameworks.
>
> Y salio un tercero que la propuesta no preveia: al preguntar
> `needsNameToDisambiguate` sobre **la coleccion**, las variantes del
> enricher —el mismo endpoint con dos cuerpos— parecian dos operaciones
> y forzaban el nombre en la clave. La decision sale ahora **solo de la
> fuente**, que es el codigo: si dos rutas comparten metodo y URI ahi, el
> protocolo es RPC y el nombre hace falta.

# x00005 — `check` dice que hay deriva en 13 de 22 proyectos recien generados

## Goal

Que `check` compare la misma cosa en los dos lados, y que decir «esta al dia» sobre una coleccion recien generada sea imposible de fallar: un test que genere y compruebe en los 21 frameworks, no en dos.

## why

Medido ejecutando `generate` seguido de `check` sobre los 22 ejemplos: **13 reportan deriva total** —django, express, fastify, fiber, gin, hono, ktor, laravel, nextjs, phoenix, rails, rust, springboot— y 9 dicen que estan al dia. La coleccion se acaba de generar de esa misma fuente, asi que la respuesta correcta es «al dia» en los 22.

`check` es de los diez tools MCP y su unica pregunta es «¿se ha desincronizado mi coleccion?». Hoy contesta que si, siempre, en la mayoria de frameworks. Un agente que se fie regenera en bucle.

Son **tres defectos independientes**, y por eso no es un arreglo de una linea:

1. **Sintaxis de parametros de ruta.** El lado fuente trae la sintaxis del framework (`/api/users/:id` en Express, `/users/{id}` en Spring) y el lado coleccion trae la plantilla de Postman (`/api/users/{{id}}`). `normalizeForComparison` no las unifica, asi que cada endpoint con parametro sale como «falta» y «sobra» a la vez.

2. **El nombre entra asimetrico en la clave.** `endpointKey` añade el nombre solo cuando existe —lo cual es correcto—, pero el lado fuente pasa `r.displayName`, que en los scanners REST viene vacio, mientras el lado coleccion siempre tiene el nombre de la request. Resultado: `GET /api/orders`, sin ningun parametro, aparece en las dos listas. Es el mismo endpoint con dos claves distintas.

3. **Laravel compara contra otro descubrimiento.** La rama `match.framework !== "laravel"` manda a Laravel al camino legacy, que encuentra 7 rutas donde el pipeline encuentra 17. `check` no compara la coleccion contra lo que `generate` ve: la compara contra una heuristica distinta. Es exactamente la divergencia que ya tuvo `summary` frente a `generate`.

Y hay una causa de fondo comun a los tres: **el test que deberia haberlo cazado solo mira dos frameworks**. `check.tool.spec.ts` prueba GraphQL y `check-rpc.test.ts` tambien; los dos estan entre los 9 que funcionan. La cobertura por framework de este comando es del 9%, y ahi es justo donde vivia el bug.

## non-goals

- Cambiar `endpointKey`: la usan tambien `dedupeSpecs` y los invariantes de coleccion, y ahi funciona. El problema es como la alimenta `check`, no la clave
- Rehacer el camino legacy de Laravel: se retira o se arregla en su propia propuesta; aqui solo deja de usarse para comparar
- Tocar la salida de `generate`: la coleccion esta bien, lo que esta mal es quien la lee

## Slices

- global_gate: e2e

### S1 — El test que lo habria cazado: generar y comprobar en los 21 frameworks
- **Status**: done
- **Files**: `tests/e2e/check-after-generate.test.ts`
- **Gate**: e2e
- acceptance:
  - "Para cada framework: se genera, se comprueba, y `check` tiene que decir que esta al dia"
  - "El test se escribe **antes** del arreglo y falla en los 13 medidos, para que quede constancia de que caza lo que dice cazar"
  - "No se afirma un numero de endpoints: se afirma que las dos listas de deriva estan vacias, que es lo que hace el test valido en los 21 sin mantenerlo"

### S2 — Unificar la sintaxis de parametros antes de comparar
- **Status**: done
- **DependsOn**: [S1]
- **Files**: `packages/core/helpers/uri.helper.ts`, `tests/core/uri.helper.spec.ts`
- **Gate**: type
- acceptance:
  - "`normalizeForComparison` deja `/users/:id`, `/users/{id}`, `/users/<id>` y `/users/{{id}}` en la misma forma"
  - "Se cubren las cuatro sintaxis con un test por cada una, nombrando el framework de donde sale"
  - "Un parametro con tipo —`/users/<int:id>` de Django, `/users/{id:int}` de Rust— normaliza igual que sin el"

### S3 — `check` alimenta la clave igual por los dos lados, y sin excepciones por framework
- **Status**: done
- **DependsOn**: [S1]
- **Files**: `packages/cli/commands/diff.script.ts`
- **Gate**: e2e
- acceptance:
  - "`GET /api/orders` deja de aparecer en las dos listas a la vez: el nombre entra en la clave solo cuando los dos lados lo tienen"
  - "En RPC sobre POST —GraphQL, tRPC— el nombre sigue entrando: es lo unico que distingue las operaciones, y quitarlo romperia lo que hoy si funciona"
  - "`check` sobre Laravel lee las 17 rutas que ve el pipeline, no las 7 del camino legacy: la rama especial por nombre de framework desaparece"
  - "Las dos decisiones quedan escritas en el codigo, no deducibles"

### S4 — Laravel deja de ser un caso aparte, y se demuestra
- **Status**: done
- **DependsOn**: [S3]
- **Files**: `tests/e2e/check-laravel.test.ts`
- **Gate**: e2e
- acceptance:
  - "Un test compara lo que ve `check` con lo que ve `generate` sobre el mismo proyecto Laravel: tienen que coincidir"
  - "Si el camino legacy sigue haciendo falta para otra cosa, el test dice donde y por que"
  - "Cubre el caso que hoy falla: 7 frente a 18"

### S5 — El tool MCP hereda el arreglo y lo demuestra
- **Status**: done
- **DependsOn**: [S2, S3, S4]
- **Files**: `packages/plugins/delendai_expostman/tests/integration/check.tool.spec.ts`
- **Gate**: e2e
- acceptance:
  - "El spec del tool deja de probar solo GraphQL y cubre al menos un REST con parametros de ruta y uno de RPC"
  - "`inSync: true` sobre una coleccion recien generada, en los dos protocolos"
  - "La deriva de verdad —borrar una request de la coleccion— se sigue detectando"

## acceptance

- Para cada framework: se genera, se comprueba, y `check` tiene que decir que esta al dia
- El test se escribe **antes** del arreglo y falla en los 13 medidos, para que quede constancia de que caza lo que dice cazar
- No se afirma un numero de endpoints: se afirma que las dos listas de deriva estan vacias, que es lo que hace el test valido en los 21 sin mantenerlo
- `normalizeForComparison` deja `/users/:id`, `/users/{id}`, `/users/<id>` y `/users/{{id}}` en la misma forma
- Se cubren las cuatro sintaxis con un test por cada una, nombrando el framework de donde sale
- Un parametro con tipo —`/users/<int:id>` de Django, `/users/{id:int}` de Rust— normaliza igual que sin el
- `GET /api/orders` deja de aparecer en las dos listas a la vez: el nombre entra en la clave solo cuando los dos lados lo tienen
- En RPC sobre POST —GraphQL, tRPC— el nombre sigue entrando: es lo unico que distingue las operaciones, y quitarlo romperia lo que hoy si funciona
- `check` sobre Laravel lee las 17 rutas que ve el pipeline, no las 7 del camino legacy: la rama especial por nombre de framework desaparece
- Las dos decisiones quedan escritas en el codigo, no deducibles
- Un test compara lo que ve `check` con lo que ve `generate` sobre el mismo proyecto Laravel: tienen que coincidir
- Si el camino legacy sigue haciendo falta para otra cosa, el test dice donde y por que
- Cubre el caso que hoy falla: 7 frente a 18
- El spec del tool deja de probar solo GraphQL y cubre al menos un REST con parametros de ruta y uno de RPC
- `inSync: true` sobre una coleccion recien generada, en los dos protocolos
- La deriva de verdad —borrar una request de la coleccion— se sigue detectando
