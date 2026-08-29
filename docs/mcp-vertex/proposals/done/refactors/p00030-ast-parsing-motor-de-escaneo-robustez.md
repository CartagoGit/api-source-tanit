---
id: p00030
title: "p00030 — motor de escaneo robusto basado en AST (Abstract Syntax Tree)"
kind: refactor
status: done
type: proposal
track: export-to-postman
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

## lo que se midió antes de decidir

Se escribió un fichero con las tres trampas y se pasó por el escáner:

| Caso | Antes |
| --- | --- |
| `// router.get("/x")` | **ya se ignoraba** ✔ |
| `/* router.post("/x") */` | **ya se ignoraba** ✔ |
| Docblock que menciona una ruta | **ya se ignoraba** ✔ |
| `router.post(\n "/x",\n handler\n)` | **perdida** ✗ |
| `const ayuda = 'usa router.get("/x")'` | **endpoint inventado** ✗ |

O sea que la primera premisa de esta propuesta —los comentarios— era
**falsa**: `stripJsComments` ya lo resolvía. La segunda —multilínea— era
cierta. Y había una tercera que la propuesta no mencionaba y es la peor
de las dos que quedaban: una ruta escrita dentro de un texto producía un
endpoint **que no existe en ninguna parte**, y eso no se nota mirando la
colección, se nota cuando alguien le da a Send y recibe un 404.

## por qué no se mete un parser de AST

Las dos causas reales no eran el regex:

- La multilínea fallaba porque el bucle miraba **una línea cada vez**. El
  patrón daba igual: el path estaba en otra línea que la llamada.
- El falso positivo pasaba porque nadie distinguía código de texto dentro
  del código.

Las dos se arreglan sin parser. `maskStringLiterals` sustituye el
contenido de las cadenas por espacios **conservando la longitud**, así
que se puede buscar en la máscara y leer en el original; y el escaneo
pasa a hacerse sobre el fichero entero.

Meter `ts-morph` o SWC habría añadido megas al binario compilado —que es
como se distribuye esto— para resolver algo que ya estaba resuelto (los
comentarios) y dos cosas que no necesitaban un AST. Además contradice el
no-objetivo de la propia propuesta: *"no requerir compiladores pesados
durante la ejecución del CLI"*. Y quedaría en pie para **un** lenguaje de
los nueve que se escanean: PHP, Python, Go, Rust, Java, Kotlin, C#, Ruby
y Elixir seguirían con regex, así que la "robustez del 100%" no llegaría
igualmente.

## no-objetives

- Requerir compiladores o runtimes pesados externos durante la ejecución del CLI.

## slices

### S1 — Robustez en JS/TS, sin parser
- **Estado**: done (2026-08-07) por otra vía.
- **Ficheros**: `packages/core/helpers/source-scan.helper.ts`
  (`maskStringLiterals`, `findOutsideStrings`), los scanners de
  `express`, `hono` y `fastify`, `tests/core/mask-strings.spec.ts`.
- Express pasa a escanear el fichero entero; los tres dejan de contar
  las llamadas escritas dentro de una cadena.

### ~~S1 original — parser AST con ts-morph/SWC~~
- **Files**: `helpers/ast-ts.helper.ts`, `services/scanners/express.scanner.ts`, `services/scanners/nestjs.scanner.ts`.
- **Gate**: `bun test tests/unit/ast-ts.spec.ts`.
- Reemplaza el parsing RegEx en Express, NestJS y Next.js por recorrido del AST para detectar llamadas a métodos de enrutamiento y tipos DTO.

### S2 y S3 — Python, PHP, Java y C#
- **Estado**: no se hacen. Sus scanners ya quitan comentarios
  (`stripPyComments`, `stripPhpComments`) y ya escanean el fichero
  entero. Si aparece un caso real que se les escape, se abre con ese
  caso delante y se decide entonces — que es como han salido los dos
  bugs que sí se han arreglado aquí.

### ~~S2 original — Parser de Tokens / AST para Python~~
- **Files**: `helpers/ast-python.helper.ts`, `services/scanners/fastapi.scanner.ts`, `services/scanners/django.scanner.ts`.
- **Gate**: `bun test tests/unit/ast-python.spec.ts`.
- Implementa tokenizer y extractor de AST para detectar decoradores `@app.get` y routers de Django REST Framework ignorando comentarios y docstrings.

### S3 — Parser de Tokens / AST para PHP y Java/C#
- **Files**: `helpers/ast-php.helper.ts`, `services/scanners/laravel.scanner.ts`, `services/scanners/symfony.scanner.ts`.
- **Gate**: `bun test tests/unit/ast-php.spec.ts`.
- Analiza atributos PHP 8 (`#[Route]`) y llamadas fluent `Route::get()` descomponiendo la estructura léxica del archivo.

## aceptación

- Rutas en código comentado, ignoradas. ✔ (ya lo estaban)
- Declaraciones multilínea, capturadas. ✔
- **Y una que no estaba pedida**: una ruta escrita dentro de una cadena
  ya no produce un endpoint inventado. ✔
- `bun run validate` verde. ✔ 1816 tests, 19/19 ejemplos.
