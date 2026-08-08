---
id: r00003
title: "Un solo idioma en la salida del CLI"
kind: refactor
status: ready
type: proposal
track: export-to-postman
date: 2026-08-08
---

> **Aplazada a 2026-08-08, con motivo.** Se midió antes de empezar: son
> **173 llamadas a `console`** repartidas por los once comandos.
>
> Un módulo de strings para 173 mensajes dinámicos es justo el sistema de
> i18n que los no-objetivos de esta propuesta descartan, y la
> alternativa —traducir a mano— es mucha rotación sobre los comandos
> recién estabilizados, para un hallazgo que la auditoría clasificó como
> MINOR.
>
> Lo que sí cambió el orden: ahora los once comandos tienen test, así que
> cuando se haga, se hará con red debajo.

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
- **Status**: pending
- **Files**: `projects/ui/messages.constant.ts`, `tests/cli/messages.spec.ts`
- **Gate**: type
- acceptance:
  - "Todo texto que ve el usuario vive en un módulo, no repartido por `console.log`"
  - "El idioma elegido queda escrito con su motivo: el README, `--help` y los mensajes de error son la misma superficie y hoy no coinciden"
  - "Un test comprueba que no queda ningún literal suelto en los comandos"

### S2 — Los doce comandos usan esos mensajes
- **Status**: pending
- **DependsOn**: [S1]
- **Files**: `projects/cli/commands/generate.script.ts`, `projects/cli/commands/diff.script.ts`, `projects/cli/commands/enrich.script.ts`, `projects/cli/commands/init.script.ts`, `projects/cli/commands/stats.script.ts`, `projects/cli/commands/validate-json.script.ts`, `projects/cli/commands/watch.script.ts`, `projects/cli/commands/push.script.ts`, `projects/cli/commands/scan.script.ts`, `projects/cli/commands/list-endpoints.script.ts`, `projects/cli/commands/summary.script.ts`, `projects/cli/commands/open-postman.script.ts`
- **Gate**: e2e
- acceptance:
  - "Ningún comando mezcla idiomas, y menos dentro de la misma ejecución"
  - "Los tests que hoy buscan texto en español se actualizan a la vez, no después"
  - "Los 21 ejemplos siguen generando colección válida"

### S3 — Gate que no deje volver a mezclarlos
- **Status**: pending
- **DependsOn**: [S2]
- **Files**: `scripts/gates/lint-cli-language.script.ts`, `package.json`
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
