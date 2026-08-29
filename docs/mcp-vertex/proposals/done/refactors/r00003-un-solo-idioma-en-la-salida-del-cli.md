---
id: r00003
title: "Un solo idioma en la salida del CLI"
kind: refactor
status: done
type: proposal
track: export-to-postman
date: 2026-08-08
---

> **Entregada, y no como decía S1.** El aplazamiento anterior partía de
> una cifra mal enfocada: 181 llamadas a `console`, sí, pero solo **41
> estaban en español**. El resto ya hablaba inglés.
>
> Eso cambia la solución. S1 pedía «recoger los mensajes en un solo
> sitio», y un módulo de strings para 181 mensajes dinámicos es
> exactamente el sistema de i18n que los no-objetivos descartan. Lo que
> hacía falta era traducir 41 cadenas y **poner un gate**, que cuesta
> menos y sostiene igual.
>
> El idioma es el inglés, y no por gusto: el README, el `--help` y el
> paquete publicado ya lo hablan. La prosa interna sigue en español.
>
> `lint:output-language` mira los literales de `console.*` y los campos
> `reason`/`nextAction` —que son la forma canónica de un error accionable
> aquí, y viajan al agente por el sobre de `toolError`—. Ese segundo
> caso no era decoración: fue el hueco por el que se escapó
> `collection-file.helper`, que vive en `core/` y habla por pantalla.
>
> Verificado metiendo una frase en español: cae. Los tests que buscaban
> texto en español se actualizaron a la vez, no después.

# r00003 — Un solo idioma en la salida del CLI

## Goal

Que la salida del CLI hable un idioma, elegido a propósito y no por el orden en que se fueron escribiendo los comandos.

## why

Hallazgo 13 de a00001. `generate` y `push` hablan inglés; `diff`, `enrich`, `init`, `stats`, `validate-json` y `watch` hablan español. Y `generate` mezcla los dos en la misma ejecución: dice `→ Enriching with validation-rule variants…` y, si falla, `✗ No se ha encontrado ningún endpoint`. La prosa interna en español es una decisión del proyecto y se queda; lo que ve quien usa la herramienta es superficie de producto y tiene que ser una sola cosa. No rompe nada — hace que la herramienta parezca dos herramientas.

## non-goals

- Traducir los comentarios ni las propuestas: la prosa interna en español es deliberada
- Un sistema de i18n con ficheros de locale: son doce comandos, no un producto multilenguaje; eso sería otra propuesta y otra decisión

## Slices

- global_gate: e2e

### S1 — Recoger los mensajes en un solo sitio
- **Status**: done
- **Files**: `packages/ui/messages.constant.ts`, `tests/cli/messages.spec.ts`
- **Gate**: type
- acceptance:
  - "Todo texto que ve el usuario vive en un módulo, no repartido por `console.log`"
  - "El idioma elegido queda escrito con su motivo: el README, `--help` y los mensajes de error son la misma superficie y hoy no coinciden"
  - "Un test comprueba que no queda ningún literal suelto en los comandos"

### S2 — Los doce comandos usan esos mensajes
- **Status**: done
- **DependsOn**: [S1]
- **Files**: `packages/cli/commands/generate.script.ts`, `packages/cli/commands/diff.script.ts`, `packages/cli/commands/enrich.script.ts`, `packages/cli/commands/init.script.ts`, `packages/cli/commands/stats.script.ts`, `packages/cli/commands/validate-json.script.ts`, `packages/cli/commands/watch.script.ts`, `packages/cli/commands/push.script.ts`, `packages/cli/commands/scan.script.ts`, `packages/cli/commands/list-endpoints.script.ts`, `packages/cli/commands/summary.script.ts`, `packages/cli/commands/open-postman.script.ts`
- **Gate**: e2e
- acceptance:
  - "Ningún comando mezcla idiomas, y menos dentro de la misma ejecución"
  - "Los tests que hoy buscan texto en español se actualizan a la vez, no después"
  - "Los 21 ejemplos siguen generando colección válida"

### S3 — Gate que no deje volver a mezclarlos
- **Status**: done
- **DependsOn**: [S2]
- **Files**: `scripts/gates/lint-output-language.script.ts`, `package.json`
- **Gate**: lint
- acceptance:
  - "El lint falla ante un literal de usuario escrito directamente en un comando"
  - "Se comprueba metiendo uno y viendo romper el gate"

## acceptance

- Todo texto que ve el usuario vive en un módulo, no repartido por `console.log`
- El idioma elegido queda escrito con su motivo: el README, `--help` y los mensajes de error son la misma superficie y hoy no coinciden
- Un test comprueba que no queda ningún literal suelto en los comandos
- Ningún comando mezcla idiomas, y menos dentro de la misma ejecución
- Los tests que hoy buscan texto en español se actualizan a la vez, no después
- Los 21 ejemplos siguen generando colección válida
- El lint falla ante un literal de usuario escrito directamente en un comando
- Se comprueba metiendo uno y viendo romper el gate
