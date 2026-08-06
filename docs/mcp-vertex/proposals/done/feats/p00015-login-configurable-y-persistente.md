---
id: p00015
title: "p00015 — login configurable y token persistente en Postman"
kind: feat
status: done
type: proposal
track: postman-exporter
date: 2026-08-06
related:
    - p00014 # identidad de colección
    - p00019 # documentación del flujo
---

> **Cerrada 2026-08-06.** Detección por método+URI, script que prueba 8 caminos
> de token en ejecución y persiste en el environment, credenciales como variables
> secret, y body de login saneado. De 0/11 ejemplos con auto-token a 7/11 (los 4
> restantes no tienen endpoint de login).

# p00015 — login configurable y token persistente en Postman

## Goal

Que tras importar la colección el usuario pueda:

1. Rellenar usuario y contraseña **una vez**, en el environment.
2. Lanzar el request de Login.
3. Usar cualquier otro endpoint sin volver a tocar el token.

Y que el token **persista** entre sesiones de Postman, sin copiar y pegar.

## why

La infraestructura está a medias. Medido sobre los 11 proyectos de
ejemplo:

| | estado |
|---|---|
| `auth: bearer` a nivel de colección | ✅ en 11/11 |
| header `Authorization: Bearer {{token}}` | ✅ |
| endpoint de login detectado | ✅ en 7/11 |
| **script que guarda el token al hacer login** | ❌ **0/11** |

`applyLoginTokenScript()` existe en `collection-builder.service.ts` pero
sale por la puerta de atrás en dos sitios:

```ts
const tokenPath = (options.tokenResponsePath ?? "").trim();
if (!tokenPath) return;                       // ← vacío por defecto
```

y el matching del endpoint compara contra
`["login","authenticate","obtain token","get token"]` mientras los
nombres generados son `"Crear Login"`, `"/POST auth/login"`,
`"/api_login"`… así que tampoco casaría.

Resultado: sólo funciona si el host escribe a mano un
`config.constant.ts` con `tokenResponsePath`. Un proyecto zero-config
—el caso que este paquete promete cubrir— no obtiene nada, y el usuario
acaba pegando el token en cada sesión. Que es literalmente el dolor que
motivó esta propuesta.

## non-goals

- Soportar OAuth2 con redirect de navegador. Fuera de alcance para v0.1;
  Postman ya tiene su propio flujo para eso.
- Guardar credenciales en el repo. Usuario y contraseña van en el
  environment de Postman, que se marca como `secret` y no se commitea.
- Refrescar el token automáticamente en cada request. Se cubre el
  refresh explícito si el proyecto expone endpoint de refresh.

## slices

### S1 — detección de login independiente del nombre generado
- **Files**: `service/auth-flow.service.ts` (nuevo),
  `service/collection-builder.service.ts`.
- **Gate**: `bun test tests/unit/auth-flow.service.spec.ts`.

- Detectar el endpoint de login por **URI y método**, no por el nombre
  legible: `POST` cuya uri termine en `/login`, `/signin`, `/auth/token`,
  `/oauth/token`, `/authenticate`, `/sessions`.
- Mismo criterio para `refresh` (`/refresh`, `/auth/refresh`) y
  `logout`.
- Devolver un `IAuthFlow { login, refresh?, logout? }` con las
  referencias a los specs.
- **Acceptance**: los 7 ejemplos con login lo detectan; los 4 sin login
  devuelven `null` sin romper nada.

### S2 — inferir `tokenResponsePath` en vez de exigirlo
- **Files**: `service/auth-flow.service.ts`.
- **Gate**: tests unitarios con las formas de respuesta habituales.

- El script de test se genera **siempre** que haya login, y prueba en
  orden los caminos habituales en tiempo de ejecución:
  `access_token`, `token`, `data.access_token`, `data.token`,
  `accessToken`, `data.accessToken`, `jwt`, `id_token`.
- Si `config.tokenResponsePath` está declarado, ese gana y es el único
  que se prueba.
- El script escribe en `pm.environment` (persiste entre sesiones) con
  fallback a `pm.collectionVariables`, y hace `pm.test(...)` para que el
  fallo sea visible en el runner en lugar de silencioso.
- **Acceptance**: un mock de respuesta con cada una de las 8 formas
  guarda el token; una respuesta sin token deja un test en rojo con
  mensaje accionable.

### S3 — variables de credenciales en el environment
- **Files**: `service/environment-builder.service.ts`.
- **Gate**: `bun test tests/unit/environment-builder.spec.ts`.

- Cuando hay flujo de login, el environment incluye `authUsername`,
  `authPassword` (ambas `type: "secret"`) y `token` vacío.
- El body del request de login referencia `{{authUsername}}` /
  `{{authPassword}}` en lugar de un ejemplo inventado, usando los
  nombres de campo reales que el scanner haya extraído
  (`email`/`password`, `username`/`password`…).
- **Acceptance**: importar environment + colección y rellenar dos campos
  basta para autenticarse.

### S4 — orden y descripción en la colección
- **Files**: `service/collection-builder.service.ts`.
- **Gate**: `bun test tests/e2e/*-comprehensive.test.ts`.

- La carpeta de auth se emite **primera** en la colección.
- El request de login lleva una `description` explicando el flujo de tres
  pasos, visible en la UI de Postman.
- **Acceptance**: en los 11 ejemplos la carpeta de auth (si existe) es la
  primera.

## acceptance

- En los 11 ejemplos con login, importar y ejecutar Login deja `token`
  poblado sin intervención manual.
- El token sobrevive a cerrar y reabrir Postman.
- Un proyecto sin endpoint de login sigue generando una colección válida.
- Documentado paso a paso en el README (p00019).
