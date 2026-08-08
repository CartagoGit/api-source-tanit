---
id: t00001
title: "Cobertura: los seis comandos sin test y el parser de YAML sin red"
kind: test
status: done
type: proposal
track: export-to-postman
date: 2026-08-08
---

> **Cerrada 2026-08-08. Tres de los seis comandos sin test estaban
> rotos**, que era exactamente lo que la propuesta predecía:
>
> · `list` no listaba **nada**, en los 21 frameworks.
> · `init` **empeoraba** el proyecto que venía a configurar.
> · `enrich` destruía 8 de 18 requests (cerrado en r00004).
>
> El parser de YAML no lanza ni se cuelga, y esa robustez es el problema:
> `a: &x 1` devolvía la cadena `"&x 1"` sin avisar. Ahora lo detecta y lo
> dice. `lint:command-coverage` impide el siguiente comando sin test.

# t00001 — Cobertura: los seis comandos sin test y el parser de YAML sin red

## Goal

Que ningún comando pueda estar roto sin que nadie se entere, y que el parser que lee ficheros ajenos se pruebe con entradas que nadie escribió a mano.

## why

Hallazgos 14 y 16 de a00001. Ningún test lanza `scan`, `open-postman`, `init`, `push`, `watch` ni `summary`: la mitad de la superficie del CLI no se ejercita nunca de punta a punta. Algunos tienen probada su pieza pura, pero no el comando — parseo de flags, códigos de salida, mensajes. Que eso importa lo demostró esta misma ronda: el vaciado de `enrich`, que dejaba una colección de 27.514 bytes en 502 imprimiendo un ✔, vivía en un comando sin test y apareció al primer intento de ejecutarlo. Y `parseYamlLite` son 267 líneas de parser escrito a mano que leen specs OpenAPI de otra gente —entrada no controlada— para el framework con más endpoints medidos del proyecto; hoy se prueba con ejemplos concretos, así que una entrada rara da un resultado silenciosamente distinto en vez de un error.

## non-goals

- Sustituir `parseYamlLite` por una librería: el binario compilado no puede cargar paquetes en ejecución, que es por lo que existe
- Tests de `open-postman` que abran de verdad una aplicación: se prueba la elección de comando por plataforma, no el lanzamiento

## Slices

- global_gate: e2e

### S1 — Los comandos de solo lectura: scan, list, stats, summary
- **Status**: pending
- **Files**: `tests/cli/read-only-commands.test.ts`
- **Gate**: e2e
- acceptance:
  - "Cada uno se lanza contra un ejemplo REST y uno de RPC sobre POST (GraphQL o tRPC)"
  - "Se comprueba el código de salida, no solo que imprima algo"
  - "Sin colección en disco, cada uno dice qué falta y con qué arreglarlo"

### S2 — Los comandos que escriben o hablan fuera: init, push, watch, open
- **Status**: pending
- **Files**: `tests/cli/writing-commands.test.ts`, `tests/cli/push-command.test.ts`
- **Gate**: e2e
- acceptance:
  - "`init` genera una configuración que el propio `generate` puede leer después"
  - "`push` sin clave sale con 1 y dice dónde se saca una; con clave falsa no filtra la clave en la salida"
  - "`watch` arranca, reacciona a un cambio y termina limpio ante SIGTERM"
  - "`open` elige el comando correcto por plataforma sin llegar a lanzarlo"

### S3 — El parser de YAML contra entradas que nadie escribió
- **Status**: pending
- **Files**: `tests/frameworks/yaml-parser-fuzz.spec.ts`
- **Gate**: type
- acceptance:
  - "Property-based sobre documentos generados: indentación mezclada, tabuladores, claves repetidas, anclas, valores multilínea, UTF-8 y ficheros truncados"
  - "La invariante es que nunca cuelga, nunca lanza sin mensaje y nunca devuelve una ruta con el nombre vacío"
  - "Lo que no sepa parsear lo dice, en vez de devolver algo distinto en silencio"

### S4 — Gate que exija test a todo comando nuevo
- **Status**: pending
- **DependsOn**: [S1, S2]
- **Files**: `scripts/gates/lint-command-coverage.script.ts`, `tests/cli/command-coverage.spec.ts`, `package.json`
- **Gate**: lint
- acceptance:
  - "El lint falla si un `*.script.ts` de `projects/cli/commands/` no aparece en ningún test que lo ejecute"
  - "Se comprueba añadiendo un comando vacío y viendo romper el gate"
  - "Entra en la cadena de `bun run lint`"

## acceptance

- Cada uno se lanza contra un ejemplo REST y uno de RPC sobre POST (GraphQL o tRPC)
- Se comprueba el código de salida, no solo que imprima algo
- Sin colección en disco, cada uno dice qué falta y con qué arreglarlo
- `init` genera una configuración que el propio `generate` puede leer después
- `push` sin clave sale con 1 y dice dónde se saca una; con clave falsa no filtra la clave en la salida
- `watch` arranca, reacciona a un cambio y termina limpio ante SIGTERM
- `open` elige el comando correcto por plataforma sin llegar a lanzarlo
- Property-based sobre documentos generados: indentación mezclada, tabuladores, claves repetidas, anclas, valores multilínea, UTF-8 y ficheros truncados
- La invariante es que nunca cuelga, nunca lanza sin mensaje y nunca devuelve una ruta con el nombre vacío
- Lo que no sepa parsear lo dice, en vez de devolver algo distinto en silencio
- El lint falla si un `*.script.ts` de `projects/cli/commands/` no aparece en ningún test que lo ejecute
- Se comprueba añadiendo un comando vacío y viendo romper el gate
- Entra en la cadena de `bun run lint`
