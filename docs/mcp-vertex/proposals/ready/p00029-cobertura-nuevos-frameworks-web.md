---
id: p00029
title: "p00029 — ampliación de cobertura de frameworks: Fastify, Hono, Fiber, Ktor, Rails, Phoenix, Actix/Rocket"
kind: feat
status: ready
type: proposal
track: postman-exporter
date: 2026-08-06
related:
    - p00024
---

# p00029 — ampliación de cobertura de frameworks: Fastify, Hono, Fiber, Ktor, Rails, Phoenix, Actix/Rocket

## Goal

Extender la matriz de soporte de 12 a 19 frameworks universales agregando escáneres nativos para Fastify, Hono, Fiber (Go), Ktor (Kotlin), Ruby on Rails, Phoenix (Elixir) y Actix-web/Rocket (Rust).

## why

Aunque `export-to-postman` ya soporta 12 frameworks populares (Laravel, Symfony, Express, NestJS, FastAPI, Flask, Django, Next.js, Gin, Spring Boot, ASP.NET y OpenAPI), existen frameworks de altísimo rendimiento en la industria moderna:
1. **Node.js / Edge**: Fastify (esquemas JSON Schema / TypeBox) y Hono (Cloudflare Workers / Deno / Bun).
2. **Go**: Fiber (sintaxis inspirada en Express).
3. **Kotlin / JVM**: Ktor (framework asíncrono idiomático).
4. **Ruby / Elixir**: Ruby on Rails (`config/routes.rb`) y Phoenix (`lib/my_app_web/router.ex`).
5. **Rust**: Actix-web y Rocket (`#[get("/")]`).

Ampliar la matriz a 19 frameworks garantizará una cobertura casi total en cualquier stack tecnológico del mercado.

## non-goals

- Requerir compilación previa de binarios en Go, Rust, Kotlin o C#. El escaneo analiza los archivos fuente de forma estática.

## slices

### S1 — Scanners Node.js/Edge: Fastify & Hono
- **Files**: `services/scanners/fastify.scanner.ts`, `services/scanners/hono.scanner.ts`.
- **Gate**: `bun test tests/frameworks/fastify-hono.spec.ts`.
- Extrae esquemas `schema: { body: ..., querystring: ... }` de Fastify y rutas `.get()`, `.post()` de Hono.

### S2 — Scanners Go (Fiber) & Rust (Actix-web / Rocket)
- **Files**: `services/scanners/fiber.scanner.ts`, `services/scanners/rust.scanner.ts`.
- **Gate**: `bun test tests/frameworks/fiber-rust.spec.ts`.
- Mapea `app.Get()`, `app.Post()` de Fiber y atributos `#[get(...)]`, `#[post(...)]` en Rust.

### S3 — Scanners Ruby on Rails, Phoenix (Elixir) & Ktor (Kotlin)
- **Files**: `services/scanners/rails.scanner.ts`, `services/scanners/phoenix.scanner.ts`, `services/scanners/ktor.scanner.ts`.
- **Gate**: `bun test tests/frameworks/rails-phoenix-ktor.spec.ts`.
- Mapea `resources :users` en Rails, `scope "/api"` en Phoenix Router y bloques `routing { get(...) }` en Ktor.

### S4 — Registro en `scanner-registry.ts` y Ejemplos de Validación
- **Files**: `services/scanner-registry.ts`, `examples/example-*`.
- **Gate**: `bun run validate:examples`.
- Registra los 7 nuevos escáneres en `DEFAULT_REGISTRY` y añade proyectos de ejemplo comprobables.

## acceptance

- Detección automática y extracción de rutas en proyectos Fastify, Hono, Fiber, Ktor, Rails, Phoenix y Rust.
- Los 19 frameworks se validan sin regresiones en `bun run validate`.
