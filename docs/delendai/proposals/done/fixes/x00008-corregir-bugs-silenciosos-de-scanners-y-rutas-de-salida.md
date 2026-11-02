---
id: x00008
title: "corregir bugs silenciosos de scanners y rutas de salida"
kind: fix
status: done
type: proposal
track: export-to-postman
date: 2026-08-30
shippedIn:
  - 052031d  # cierre administrativo (x00032 S1 regla 2): SHA de creación del registro
---

# x00008 — corregir bugs silenciosos de scanners y rutas de salida

## Goal

Corregir los defectos F-001..F-010 y C-001..C-003 documentados en la auditoría canónica `a00006`, preservando los contratos existentes y añadiendo regresiones focalizadas.

## why

Los gates globales están verdes, pero la auditoría detectó rutas HTTP incorrectas, schemas de validación perdidos, métodos fantasma y resolución de paths defectuosa que producen colecciones inválidas sin fallar el pipeline.

## non-goals

- No rediseñar los parsers ni migrar a AST.
- No modificar el contrato público MCP salvo que una corrección lo exija explícitamente.
- No corregir hallazgos fuera de F-001..F-010 y C-001..C-003.
- No tocar la auditoría de desktop ni la deuda residual del singleton de r00008.

## Slices

- global_gate: lint

### S1 — Fastify y OpenAPI: schemas y prefijos
- **Status**: done
- **Files**: `packages/frameworks/scanners/fastify.scanner.ts`, `packages/frameworks/scanners/openapi.scanner.ts`, `tests/frameworks/fastify-scanner.spec.ts`, `tests/frameworks/openapi-scanner.spec.ts`
- **Gate**: e2e
- acceptance:
  - "app.route({ schema }) alimenta FastifySchemaProvider."
  - "OpenAPI 3 usa servers[0].url como prefijo cuando no hay basePath explícito."
  - "Las regresiones cubren schema de app.route y servers con URL absoluta y path."
- review-state: done
- review-implementer: orchestrator
- review-reviewer: delivery_verifier
- review-log: approved by delivery_verifier — Revisión independiente completada: el cambio registra schemas de app.route para cada método y deriva el pathname de servers[0].url manteniendo prioridad de opts.basePath/spec.basePath. Tests focalizados: 75/75; get_errors sin errores. Aprobado.
### S2 — Django y Gin: métodos y rawUri
- **Status**: done
- **Files**: `packages/frameworks/scanners/django.scanner.ts`, `packages/frameworks/scanners/gin.scanner.ts`, `tests/frameworks/django-scanner.spec.ts`, `tests/frameworks/gin-scanner.spec.ts`
- **Gate**: e2e
- acceptance:
  - "ReadOnlyModelViewSet solo genera GET."
  - "Los CBV bajo src/ resuelven su clase base."
  - "Gin conserva rawUri sin prefijos y no aborta el recorrido por una rama muerta."
- review-state: done
- review-implementer: orchestrator
- review-reviewer: delivery_verifier
- review-log: approved by delivery_verifier — Revisión independiente: ReadOnlyModelViewSet queda limitado a GET; findBaseClass incluye src; Gin conserva rawUri declarado y la rama de duplicado usa continue. Tests focalizados 76/76 y get_errors sin errores. Aprobado.
### S3 — Symfony: YAML, resources y limpieza
- **Status**: done
- **Files**: `packages/frameworks/scanners/symfony.scanner.ts`, `tests/frameworks/symfony-scanner.spec.ts`
- **Gate**: e2e
- acceptance:
  - "controller::action en YAML permite resolver assertions del método."
  - "resource en config/routes/*.yaml se resuelve relativo al archivo de origen."
  - "Se eliminan o consumen composerJson y controller muertos."
- review-state: done
- review-implementer: orchestrator
- review-reviewer: delivery_verifier
- review-log: approved by delivery_verifier — Revisión independiente: sourceFile mantiene el YAML de origen, controllerClass/actionName conectan el provider con el controller PHP, resource se resuelve relativo al YAML con fallback compatible. Suite Symfony 46/46 y get_errors sin errores. Aprobado.
### S4 — Express, Next y FastAPI: métodos y handlers
- **Status**: done
- **Files**: `packages/frameworks/scanners/express.scanner.ts`, `packages/frameworks/scanners/nextjs.scanner.ts`, `packages/frameworks/scanners/fastapi.scanner.ts`, `tests/frameworks/express-scanner.spec.ts`, `tests/frameworks/nextjs-scanner.spec.ts`, `tests/frameworks/fastapi-scanner.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Express concatena prefijos reales aunque el path incluya /api o /v1."
  - "Next.js no inventa métodos no declarados por el handler."
  - "FastAPI reconoce async def y localiza el modelo Pydantic."
- review-state: done
- review-implementer: orchestrator
- review-reviewer: delivery_verifier
- review-log: approved by delivery_verifier — Revisión independiente: Express conserva la concatenación real de prefijos; Next.js usa métodos explícitos y fallback GET; FastAPI reconoce async def. Suites focalizadas 89/89 y get_errors sin errores. Aprobado.
### S5 — Paths y nombres de environments
- **Status**: done
- **Files**: `packages/core/discovery/paths.service.ts`, `tests/core/paths.service.spec.ts`, `tests/cli/output-dir.test.ts`, `tests/cli/cli-external-project.test.ts`
- **Gate**: e2e
- acceptance:
  - "outputEnvironmentPath no duplica postman_collection."
  - "outputDir distingue correctamente packageRoot dentro y fuera de projectRoot."
  - "Los tests cubren ambos sentidos y mantienen la resolución de CLI/env."
- review-state: done
- review-implementer: orchestrator
- review-reviewer: delivery_verifier
- review-log: approved by delivery_verifier — Revisión independiente: outputEnvironmentPath elimina el sufijo de colección duplicado y outputDir usa una comprobación inequívoca de contención. Tests paths/CLI 31/31 y get_errors sin errores. Aprobado.
### S6 — Validación integradora y cierre
- **Status**: done
- **DependsOn**: [S1, S2, S3, S4, S5]
- **Files**: `docs/delendai/proposals/done/audits/a00006-auditoria-exhaustiva-de-tipado-validacion-lint-y-bugs.md`
- **Gate**: lint
- acceptance:
  - "El informe queda actualizado con los fixes aplicados y evidencia de validación."
  - "typecheck, lint, tests y validate:examples pasan tras integrar los slices."
- review-state: done
- review-implementer: orchestrator
- review-reviewer: delivery_verifier
- review-log: approved by delivery_verifier — Revisión independiente completada. La auditoría canónica `a00006` fue verificada contra `x00008`: los 13 hallazgos (F-001..F-010, C-001..C-003) están transcritos fielmente, las correcciones y conteos de tests coinciden con los review-logs de S1–S5 (75+76+46+89+31=317/317), el mapa de slices en §3 es consistente y la evidencia refleja los gates de `a00006`. lint:docs y lint:proposals pasan para el árbol canónico. Aprobado.
## acceptance

- app.route({ schema }) alimenta FastifySchemaProvider.
- OpenAPI 3 usa servers[0].url como prefijo cuando no hay basePath explícito.
- Las regresiones cubren schema de app.route y servers con URL absoluta y path.
- ReadOnlyModelViewSet solo genera GET.
- Los CBV bajo src/ resuelven su clase base.
- Gin conserva rawUri sin prefijos y no aborta el recorrido por una rama muerta.
- controller::action en YAML permite resolver assertions del método.
- resource en config/routes/*.yaml se resuelve relativo al archivo de origen.
- Se eliminan o consumen composerJson y controller muertos.
- Express concatena prefijos reales aunque el path incluya /api o /v1.
- Next.js no inventa métodos no declarados por el handler.
- FastAPI reconoce async def y localiza el modelo Pydantic.
- outputEnvironmentPath no duplica postman_collection.
- outputDir distingue correctamente packageRoot dentro y fuera de projectRoot.
- Los tests cubren ambos sentidos y mantienen la resolución de CLI/env.
- El informe queda actualizado con los fixes aplicados y evidencia de validación.
- typecheck, lint, tests y validate:examples pasan tras integrar los slices.

> **Cerrada 2026-08-30.** Los seis slices quedaron implementados y
> revisados. Evidencia: `bun run validate` verde, 21/21 ejemplos válidos,
> suites focalizadas de scanners y paths verdes, y sin hallazgos en
> typecheck, SAST, secrets o escrituras durables.
