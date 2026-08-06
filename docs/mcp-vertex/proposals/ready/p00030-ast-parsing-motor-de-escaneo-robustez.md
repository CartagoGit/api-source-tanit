---
id: p00030
title: "p00030 — motor de escaneo robusto basado en AST (Abstract Syntax Tree)"
kind: refactor
status: ready
type: proposal
track: postman-exporter
date: 2026-08-06
related:
    - p00024
---

# p00030 — motor de escaneo robusto basado en AST (Abstract Syntax Tree)

## Goal

Evolucionar los escáneres de rutas de expresiones regulares simples hacia un motor híbrido basado en **Árboles de Sintaxis Abstracta (AST)**, eliminando falsos positivos, omitiendo comentarios y procesando sintaxis multilínea complejas con total precisión.

## why

El uso exclusivo de RegEx para parsear archivos fuente tiene limitaciones inherentes en casos bordes:
1. **Comentarios**: Rutas comentadas (`// app.get(...)` o `/* Route::get(...) */`) a veces son capturadas por error si la RegEx no ignora bloques de comentarios.
2. **Sintaxis Multilínea**: Cadenas de llamadas o anotaciones distribuidas en múltiples líneas pueden romper patrones RegEx rígidos.
3. **Inferencia de DTOs y Tipos**: Con AST es posible inspeccionar la estructura real de interfaces TypeScript, clases DTO de NestJS/Spring o modelos Pydantic sin ejecutar el código.

Un motor basado en AST garantizará una robustez del **100% (nivel 11/10)** en la detección de endpoints.

## non-goals

- Requerir compiladores o runtimes pesados externos durante la ejecución del CLI.

## slices

### S1 — Integración de parser AST para TypeScript/JavaScript (`ts-morph` / SWC lightweight)
- **Files**: `helpers/ast-ts.helper.ts`, `services/scanners/express.scanner.ts`, `services/scanners/nestjs.scanner.ts`.
- **Gate**: `bun test tests/unit/ast-ts.spec.ts`.
- Reemplaza el parsing RegEx en Express, NestJS y Next.js por recorrido del AST para detectar llamadas a métodos de enrutamiento y tipos DTO.

### S2 — Parser de Tokens / AST para Python (FastAPI, Flask, Django)
- **Files**: `helpers/ast-python.helper.ts`, `services/scanners/fastapi.scanner.ts`, `services/scanners/django.scanner.ts`.
- **Gate**: `bun test tests/unit/ast-python.spec.ts`.
- Implementa tokenizer y extractor de AST para detectar decoradores `@app.get` y routers de Django REST Framework ignorando comentarios y docstrings.

### S3 — Parser de Tokens / AST para PHP y Java/C#
- **Files**: `helpers/ast-php.helper.ts`, `services/scanners/laravel.scanner.ts`, `services/scanners/symfony.scanner.ts`.
- **Gate**: `bun test tests/unit/ast-php.spec.ts`.
- Analiza atributos PHP 8 (`#[Route]`) y llamadas fluent `Route::get()` descomponiendo la estructura léxica del archivo.

## acceptance

- Rutas en código comentado son ignoradas al 100%.
- Declaraciones de rutas y DTOs multilínea se capturan sin error.
- Toda la suite de tests `bun run validate` se mantiene en verde.
