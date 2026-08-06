---
id: p00039
title: "p00039 — soporte de tipos de autenticación avanzada: OAuth2 PKCE, API Key, mTLS, HMAC y Basic Auth"
kind: feat
status: ready
type: proposal
track: export-to-postman
date: 2026-08-06
related:
    - p00015
    - p00031
---

# p00039 — soporte de tipos de autenticación avanzada: OAuth2 PKCE, API Key, mTLS, HMAC y Basic Auth

## Goal

Ampliar la capacidad del generador de colecciones Postman para autodetectar
y configurar automáticamente los cinco esquemas de autenticación más comunes
en APIs modernas, generando la sección `auth` de la colección con la
configuración correcta para cada tipo.

## why

Actualmente el flujo de autenticación solo cubre Bearer Token (JWT/Sanctum).
Muchas APIs enterprise usan:

1. **OAuth2 con PKCE** (SPAs, mobile apps) — requiere `grant_type`, `code_verifier`, etc.
2. **API Key** (header `X-API-Key` o query param `?api_key=`) — detectable por middleware.
3. **Basic Auth** — detectable por middleware `auth:basic` o `BasicAuthMiddleware`.
4. **HMAC Signature** — headers `X-Signature` / `X-Timestamp` — detectable por middleware.
5. **mTLS** (Mutual TLS) — certificados de cliente — detectable por config de servidor.

## non-goals

- Implementar el flujo OAuth2 completo en runtime (Postman ya lo maneja).
- Generar certificados TLS.

## slices

### S1 — Detector de esquema de auth
- **Files**: `services/auth-detector.service.ts`.
- **Gate**: `bun test tests/core/auth-detector.spec.ts`.
- Analiza middleware, decoradores y configuraciones para clasificar el
  esquema de auth predominante.

### S2 — Generador de sección `auth` por tipo
- **Files**: `services/auth-flow.service.ts`, `services/collection-builder.service.ts`.
- **Gate**: `bun test tests/core/auth-flow.spec.ts`.
- Genera la sección `auth` de la colección Postman con los campos correctos
  para cada tipo (Bearer, API Key, Basic, OAuth2).

### S3 — Auto-configuración de variables de auth
- **Files**: `services/environment-builder.service.ts`.
- **Gate**: `bun test tests/core/environment-builder.spec.ts`.
- Añade variables de entorno relevantes (`api_key`, `client_id`,
  `client_secret`, `username`, `password`) según el tipo detectado.

## acceptance

- La colección generada incluye la configuración de auth correcta.
- Las variables de entorno incluyen los campos específicos del esquema.
- `bun run validate` verde.
