---
id: p00039
title: "p00039 — soporte de tipos de autenticación avanzada: OAuth2, API Key y detección honesta"
kind: feat
status: done
type: proposal
track: export-to-postman
date: 2026-08-06
related:
    - p00015
    - p00031 # los scripts de test avanzados usan el esquema detectado
---

> **Cerrada el 2026-08-07.** Con un no-objetivo añadido: mTLS y HMAC no
> se detectan, y el motivo está abajo. El resto sí, y de paso salió que
> el problema no era "solo soportamos bearer" sino algo peor: la
> colección **afirmaba** bearer aunque la API no tuviera autenticación
> ninguna.

# p00039 — autenticación más allá del bearer

## por qué

El bloque `auth` de la colección estaba escrito a mano en
`collection-builder.service.ts`:

```ts
auth: {
  type: "bearer",
  bearer: [{ key: "token", value: "{{token}}", type: "string" }],
},
```

Sin condición ninguna. Una API que autentica con `X-API-Key` recibía un
bearer con un `{{token}}` que nadie rellena nunca. Una API **sin**
autenticación, también. Y `defaultHeaders()` remataba poniendo
`Authorization: Bearer {{token}}` en **todas** las peticiones, así que
importabas la colección, lanzabas cualquier endpoint público, y te
contestaba 401 por una cabecera que la herramienta había puesto sola.

Eso no es "falta soporte": es que la colección afirmaba algo falso sobre
la API, y quien la importaba no tenía forma de saber si el error era de
la detección o suyo.

## qué detecta, y con qué señal

El servicio es del **núcleo**, así que no puede mirar middlewares de
Laravel ni decoradores de NestJS. Deduce del resultado del escaneo, que
es lo único agnóstico que hay:

| Esquema | Señal | Confianza |
| --- | --- | --- |
| `apikey` | Una cabecera (`X-API-Key`, `api-key`…) o query param (`api_key`…) repetida en **≥2** endpoints | Alta: es un nombre exacto |
| `oauth2` | Un endpoint `/oauth/token` o `/oauth2/authorize` | Alta |
| `bearer` | El proyecto expone un login que el flujo de auth reconoce y cablea | Media |
| `none` | Nada de lo anterior | — |

El umbral de dos endpoints no es capricho: una cabecera en **un solo**
sitio puede ser un endpoint que habla con un tercero, no el esquema de
esta API.

`Authorization` está deliberadamente **fuera** de la lista de claves de
API. Es la del bearer, y confundirlas haría que una API con login normal
saliera configurada como API key.

Cada detección lleva su `evidence` ("la cabecera `X-API-Key` aparece en 4
endpoints"), porque una detección automática que no se puede contrastar
es una que hay que creerse a ciegas.

## lo que cambia en la colección

- **`none` no emite bloque `auth`.** No es lo mismo que emitir uno vacío:
  con bloque, Postman manda una `Authorization` sin resolver en cada
  petición.
- **La cabecera `Authorization: Bearer {{token}}` solo va si el esquema
  es bearer.** Con API key sobra: el bloque `auth` ya mete la clave donde
  toca.
- **Las variables de entorno dependen del esquema**: `apiKey` para clave
  de API, `clientId` + `clientSecret` para OAuth2, y las del login para
  bearer. Todas vacías y marcadas como secreto.

Medido sobre los 19 ejemplos: 15 salen con `bearer` (todos tienen login),
1 con `apikey` (el de OpenAPI) y 3 sin bloque —nestjs, springboot y
aspnet— que efectivamente no tienen ningún endpoint de sesión. Antes los
19 decían bearer.

## no-objetivos

- Ejecutar el flujo OAuth2 en runtime. Postman ya lo hace.
- Generar certificados TLS.
- **mTLS y HMAC** (estaban en la propuesta original). No hay señal
  agnóstica: mTLS se configura en el servidor —nginx, el ALB, el
  `server.ts`— y **no deja rastro en las rutas**, que es lo único que
  este servicio ve. HMAC sí dejaría rastro (`X-Signature`,
  `X-Timestamp`), pero Postman no tiene un tipo `auth` para HMAC: se
  resuelve con un pre-request script, que es p00031. Inventarse una
  detección para ninguno de los dos habría sido añadir dos formas nuevas
  de mentir sobre la API, que es justo lo que esta propuesta venía a
  quitar.

## slices

### S1 — detector de esquema
- **Estado**: done (2026-08-07)
- **Ficheros**: `packages/core/domain/auth-scheme.service.ts` (nuevo),
  `tests/core/auth-scheme.service.spec.ts` (nuevo, 16 tests).
- `hasLoginEndpoint()` sale de `auth-flow.service.ts` y **comparte los
  patrones** con `detectAuthFlow`. Dos listas de rutas de login se
  desincronizan, y entonces la colección diría bearer mientras el flujo
  no cablea ningún token.

### S2 — generador del bloque `auth`
- **Estado**: done (2026-08-07)
- **Ficheros**: `packages/core/domain/collection-builder.service.ts`,
  `packages/core/discovery/generation.pipeline.ts`.
- El esquema se resuelve **antes** de construir la colección: decide qué
  cabeceras lleva cada petición, así que no se puede parchear después.

### S3 — variables de entorno por esquema
- **Estado**: done (2026-08-07)
- **Ficheros**: `packages/core/discovery/generation.pipeline.ts`.

### S4 — el ejemplo que lo ejercita
- **Estado**: done (2026-08-07)
- `example-openapi-headers` tenía `X-API-Key` en **un** endpoint y
  `Authorization` en el otro, o sea ninguna de las dos cosas del todo.
  Ahora la clave va en los dos, que es lo que hace una API con clave, y
  `validate:examples` cubre el camino de `apikey` de punta a punta.

## aceptación

- La colección incluye la configuración de auth **que corresponde**. ✔
- Las variables incluyen los campos del esquema detectado. ✔
- Una API sin autenticación no recibe un bloque que diga lo contrario. ✔
- `bun run validate` verde. ✔ 1608 tests, 19/19 ejemplos.
