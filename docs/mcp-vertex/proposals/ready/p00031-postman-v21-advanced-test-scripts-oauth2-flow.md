---
id: p00031
title: "p00031 — enriquecimiento de colecciones Postman: Pre-request scripts, Test assertions y Mocks HTTP"
kind: feat
status: ready
type: proposal
track: postman-exporter
date: 2026-08-06
related:
    - p00015
---

# p00031 — enriquecimiento de colecciones Postman: Pre-request scripts, Test assertions y Mocks HTTP

## Goal

Enriquecer las colecciones Postman v2.1.0 generadas incluyendo automáticamente scripts de pre-solicitud (*Pre-request scripts* para inyección y auto-refresh de tokens JWT/OAuth2), pruebas automáticas (*Test scripts* con aserciones de código de estado y contrato JSON) y respuestas de ejemplo preparadas (*Mock responses* 200, 400, 401, 422, 500).

## why

Una colección Postman estándar que solo contiene URLs y métodos requiere trabajo manual significativo por parte de los desarrolladores y equipos de QA para poder probar la API.
Para alcanzar la **excelencia 11 de 10**, `export-to-postman` debe entregar colecciones "listas para presionar Send":
1. **Flujo Autenticado Transparente**: El endpoint de Login o Auth incluye un script Postman en `tests` que guarda automáticamente el `access_token` en las variables de la colección (`pm.collectionVariables.set("token", pm.response.json().token)`).
2. **Aserciones Automáticas**: Cada petición incluye scripts de prueba por defecto que verifican que el tiempo de respuesta sea razonable y que la estructura corresponda con los esquemas esperados (`pm.response.to.have.status(200);`).
3. **Respuestas de Ejemplo de Éxito y Error**: Generación de respuestas simuladas en Postman para permitir mockear la API al instante.

## non-goals

- Ejecutar las peticiones HTTP reales durante la generación de la colección.

## slices

### S1 — Generador de Pre-request & Auth Refresh Scripts
- **Files**: `service/auth-flow.service.ts`, `service/collection-builder.service.ts`.
- **Gate**: `bun test tests/unit/auth-flow.spec.ts`.
- Inserta automáticamente scripts en la sección `event` de Postman para gestionar refrescos de token en peticiones protegidas.

### S2 — Generador de Test Scripts de Validación Automática
- **Files**: `helper/postman-script.helper.ts`, `service/collection-builder.service.ts`.
- **Gate**: `bun test tests/unit/collection-builder.spec.ts`.
- Añade aserciones Postman Javascript (`pm.test(...)`) en cada request para verificar status codes e invariantes de respuesta.

### S3 — Generador de Respuestas Simuladas (Mock Responses)
- **Files**: `helper/postman-response.helper.ts`.
- **Gate**: `bun test tests/unit/mock-responses.spec.ts`.
- Mapea las reglas de validación inferidas para generar respuestas de ejemplo con payloads formateados para códigos 200 OK, 400 Bad Request y 422 Unprocessable Entity.

## acceptance

- La colección importada en Postman autentica de forma transparente sin intervención manual.
- Cada petición incluye aserciones de pruebas funcionales y respuestas de ejemplo simuladas.
- Toda la suite `bun run validate` pasa limpiamente.
