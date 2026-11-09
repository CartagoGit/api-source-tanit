---
id: p00031
title: "p00031 — enriquecimiento de colecciones: aserciones automáticas y documentación derivada"
kind: feat
status: done
type: proposal
track: export-to-postman
date: 2026-08-06
related:
    - p00015
    - p00039 # el esquema de auth decide qué cabeceras lleva cada request
shippedIn:
  - 1eae4d9  # cierre administrativo (x00032 S1 regla 2): SHA de creación del registro
---

> **Cerrada el 2026-08-07.** S1 ya estaba hecha. S2 se hace entera. S3
> —las respuestas simuladas— **no se hace**, y el motivo está abajo: no
> se puede generar sin inventar, y la propuesta de al lado (p00039) acaba
> de cerrarse quitando exactamente esa clase de invento.

# p00031 — colecciones listas para pulsar Send

## lo que había, medido

| | laravel (17 requests) | express (9) | fastapi (9) |
| --- | --: | --: | --: |
| Con script | 3 | 2 | 2 |
| Con respuesta de ejemplo | 0 | 0 | 0 |

Los tres con script eran login, refresh y logout: el flujo de auth, o sea
**S1, que ya estaba hecha**. El resto de las requests no comprobaban
nada.

## S1 — scripts de auth
- **Estado**: ya estaba. `applyAuthFlow` cablea el guardado y el borrado
  del token desde p00015.
- **Lo que sí hacía falta**: `applyAuthFlow` **sustituía** el array
  `event` (`flow.login.event = [tokenCaptureEvent(paths)]`). En cuanto S2
  empezó a poner aserciones en todas las requests, esa asignación se las
  llevaba por delante justo en los tres endpoints del ciclo de sesión.
  Ahora se añade al array en vez de reemplazarlo.

## S2 — aserciones en todas las requests
- **Estado**: done (2026-08-07)
- **Ficheros**: `packages/core/domain/test-script.service.ts` (nuevo),
  `packages/core/domain/collection-builder.service.ts`,
  `packages/core/domain/auth-flow.service.ts`,
  `tests/core/test-script.service.spec.ts` (nuevo, 12 tests).

La regla que gobierna el fichero: **no se afirma nada que no se sepa**.
Una aserción falsa es peor que ninguna — falla en rojo y manda a alguien
a investigar un problema que no existe.

- **El código esperado sale del verbo**, no de un 200 fijo. Un `POST` que
  crea contesta 201 y un `DELETE` contesta 204: exigirles 200 daría rojo
  en una API perfectamente correcta. Se acepta el conjunto razonable para
  cada verbo.
- **El cuerpo solo se comprueba si puede haberlo.** Un 204 no trae JSON,
  y `pm.response.json()` sobre un cuerpo vacío lanza.
- **No se comprueba la forma de la respuesta.** Este proyecto escanea lo
  que la API **recibe**; lo que devuelve no lo sabe. Afirmar que un
  `GET /users` responde un array fallaría en cualquier API que envuelva
  en `{ data: [...] }`.

De 3/17 a **17/17** en el ejemplo de Laravel.

## S3 — respuestas simuladas: no se hace, y por qué

La propuesta pedía respuestas de ejemplo 200, 400, 401, 422 y 500. No se
pueden generar sin inventárselas:

- Un **200** exigiría saber qué devuelve el endpoint. Este proyecto
  escanea lo que **recibe** — rutas, reglas de validación, DTOs. La forma
  de la respuesta no está en ninguna de esas señales.
- Un **422** o un **400** sí podría listar los campos que fallan, pero su
  **formato** es de cada framework: Laravel manda
  `{message, errors: {…}}`, DRF manda `{campo: […]}`, FastAPI manda
  `{detail: […]}`. El núcleo es agnóstico y no puede elegir uno.

Una respuesta de ejemplo que no se parece a la real es peor que ninguna:
quien la lee la toma por documentación y escribe su cliente contra ella.
Es el mismo error que p00039 acaba de quitar del bloque `auth`, y no
tiene sentido volver a meterlo por otra puerta.

**Lo que sí es derivable, y se ha hecho en su lugar**: la descripción de
la request. Toda la información de las reglas —tipo, obligatoriedad,
formato, cotas, valores de enum— ya se extraía del código fuente para
construir el body de ejemplo, y se tiraba. El ejemplo enseña **un** valor
válido; la tabla dice cuáles lo son.

- **Ficheros**: `packages/core/domain/request-doc.service.ts` (nuevo),
  `packages/core/contracts/postman.interface.ts` (`EndpointSpec.fields`),
  `packages/core/adapters/parsed-route-to-spec.adapter.ts`,
  `tests/core/request-doc.service.spec.ts` (nuevo, 12 tests).

```
POST /users — create

#### Body
| Campo   | Tipo    | Obligatorio | Restricciones                    |
| `name`  | string  | sí          | mín. 1 car., máx. 100 car.       |
| `email` | string  | sí          | formato `email`                  |
| `age`   | integer | no          | ≥ 0, ≤ 120                       |
| `role`  | enum    | no          | uno de: `admin`, `user`, `guest` |
```

Y de paso destapó un bug: el fallback del provider de NestJS emparejaba
un decorador con **cualquier** campo dentro de las 9 líneas anteriores
(un `[\s\S]*?` entre medias) y lo marcaba todo como `body`. Un
`@Query("page")` de un GET salía documentado como campo de body, con el
tipo del primer `@IsString()` que pillara por encima — o sea, la
colección describía una petición imposible, porque un GET no tiene body.
Ahora los parámetros de la firma se leen por su decorador: `@Query` →
query, `@Param` → path, `@Headers` → header.

## aceptación

- La colección autentica sin intervención manual. ✔ (S1, ya estaba)
- Cada petición incluye aserciones funcionales. ✔ 17/17
- ~~y respuestas de ejemplo simuladas~~ → sustituido por documentación
  **derivada** de las reglas reales, por los motivos de arriba.
- `bun run validate` limpio. ✔ 1635 tests, 19/19 ejemplos.
