---
id: p00034
title: "p00034 — inferencia inteligente de payloads: TypeScript DTOs, Pydantic, FormRequests, Zod, Joi, Marshmallow y JSON Schema"
kind: feat
status: ready
type: proposal
track: postman-exporter
date: 2026-08-06
related:
    - p00024
    - p00030
---

# p00034 — inferencia inteligente de payloads: TypeScript DTOs, Pydantic, FormRequests, Zod, Joi, Marshmallow y JSON Schema

## Goal

Extraer automáticamente la estructura completa de los cuerpos de petición
(*request bodies*) y generar ejemplos realistas en cada endpoint de la
colección Postman, analizando los tipos y esquemas de validación declarados
en el código fuente del proyecto escaneado.

## why

Actualmente, cuando se genera una colección, muchos endpoints incluyen bodies
vacíos o genéricos (`{}`) porque la inferencia de validaciones solo cubre
parcialmente las reglas. Para llegar a 11/10, cada POST/PUT/PATCH debe
incluir un body de ejemplo con campos reales, tipos correctos y valores
sensatos, derivados directamente del código del proyecto.

### Esquemas soportados por framework

| Framework | Esquema de validación | Estado actual |
|---|---|---|
| Laravel | `FormRequest::rules()` | ✅ Parcial (reglas simples) |
| Symfony | PHP 8 `#[Assert\...]` | ✅ Parcial |
| Express | Zod schemas / Joi schemas | ✅ Parcial |
| NestJS | `class-validator` decorators + DTOs | 🔴 Sin DTO inference |
| FastAPI | Pydantic models (v1 & v2) | ✅ Parcial |
| Flask | Marshmallow schemas | ✅ Parcial |
| Django | DRF Serializers (fields, nested) | ✅ Parcial |
| Spring Boot | Bean Validation `@Valid` + DTO | 🔴 Sin DTO inference |
| ASP.NET | Data Annotations `[Required]` | 🔴 Sin DTO inference |
| Next.js | Zod / JSON Schema | ✅ Parcial |
| Gin | Binding struct tags | ✅ Parcial |
| OpenAPI | JSON Schema `requestBody` | ✅ Funcional |

## non-goals

- Ejecutar código del proyecto escaneado.
- Inferir bodies en lenguajes no tipados sin esquema explícito.

## slices

### S1 — Motor de generación de valores de ejemplo por tipo
- **Files**: `helpers/example-value.helper.ts`.
- **Gate**: `bun test tests/unit/example-value.spec.ts`.
- Dado un tipo (`string`, `email`, `integer`, `uuid`, `boolean`, `date`,
  `array<T>`, `object`) genera un valor realista (no `"string"` genérico
  sino `"user@example.com"` para email, `"550e8400-..."` para uuid, etc.).

### S2 — Inferencia profunda de DTOs TypeScript (NestJS)
- **Files**: `helpers/dto-inference.helper.ts`, `services/scanners/nestjs.scanner.ts`.
- **Gate**: `bun test tests/frameworks/nestjs-dto.spec.ts`.
- Analiza clases DTO con decoradores `@IsString()`, `@IsEmail()`,
  `@IsOptional()`, `@ValidateNested()` y genera el body de ejemplo
  completo incluyendo objetos anidados.

### S3 — Inferencia de Pydantic v2 Models (FastAPI)
- **Files**: `helpers/pydantic-schema.helper.ts`.
- **Gate**: `bun test tests/frameworks/pydantic-v2.spec.ts`.
- Parsea `model_fields`, `Optional[T]`, `List[T]`, `Field(default=...)`
  y genera el JSON de ejemplo correspondiente.

### S4 — Inferencia de Bean Validation DTOs (Spring Boot) y Data Annotations (ASP.NET)
- **Files**: `helpers/java-dto.helper.ts`, `helpers/csharp-dto.helper.ts`.
- **Gate**: `bun test tests/frameworks/spring-aspnet-dto.spec.ts`.
- Extrae campos de clases Java/Kotlin y C# anotadas con `@NotNull`,
  `@Size`, `@Email`, `[Required]`, `[MaxLength]`, etc.

### S5 — Inferencia avanzada de FormRequests Laravel (reglas anidadas)
- **Files**: `services/form-request-parser.service.ts`.
- **Gate**: `bun test tests/frameworks/laravel-nested-rules.spec.ts`.
- Soporta reglas como `'items.*.id' => 'required|uuid'`,
  `'address.street' => 'required|string'` y genera arrays de objetos
  anidados en el body de ejemplo.

## acceptance

- Cada endpoint POST/PUT/PATCH incluye un body de ejemplo no vacío derivado
  del código fuente.
- Los valores de ejemplo son semánticamente correctos (emails, UUIDs, fechas).
- Toda la suite `bun run validate` mantiene cero regresiones.
