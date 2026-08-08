---
id: t00002
title: "Cobertura cuantitativa por scopes y presupuesto basico de rendimiento"
kind: test
status: done
type: proposal
track: export-to-postman
date: 2026-08-08
related:
  - t00001
  - a00002
---

> **Cerrada 2026-08-08.** Cobertura medida por primera vez: statements
> 73,88 · branches 62,38 · functions 82,89 · lines 75,65. Los umbrales
> van justo debajo de cada cifra — un suelo medido, no una aspiración.
>
> El banco **no vigila el tiempo absoluto** a propósito: depende de la
> máquina y un gate que falla porque el CI iba cargado se acaba
> desactivando. Vigila la forma, que el coste por fichero no crezca con
> el tamaño.
>
> `branches` queda como la deuda de test pendiente, con su motivo escrito
> en el config.

# t00002 — Cobertura cuantitativa por scopes y presupuesto basico de rendimiento

## Goal

Que la calidad de test deje de medirse solo por cantidad de specs o por que `bun run test` salga verde, y pase a incluir dos numeros gobernables: cobertura de lineas y ramas por scope y una baseline minima para el tiempo de scan sintetico.

## why

Hoy el repo tiene una suite grande y valiosa, pero ninguna metrica cuantitativa que diga que zonas toca esa suite. `vitest.config.ts` no define coverage, `package.json` no tiene script de coverage y CI no publica artefactos ni umbrales. Eso deja un hueco peligroso: el proyecto puede tener 1.800 tests y aun asi mover una capa entera a rojo semantico sin que se vea en un porcentaje. `t00001` cubre la mitad funcional del problema — comandos sin test y parser YAML sin red —, pero no la mitad cuantitativa.

Hay un caso parecido en rendimiento. El repo ya tiene `bench:scan` y su propia propuesta historica demuestra que medir antes de prometer ahorra trabajo inutil. Pero esa medicion hoy es una herramienta suelta, no una baseline vigilada. No hace falta volverla una puerta dura y flaky en cada PR; si hace falta, como minimo, poder ver si el scan se ha degradado mucho sin enterarse semanas despues.

## non-goals

- Perseguir 100% global de coverage a martillazos.
- Meter un benchmark duro y fragil en cada PR si la maquina de CI no lo soporta.
- Duplicar `t00001`: esta propuesta mide, la otra amplia superficie funcional probada.

## Slices

- global_gate: test

### S1 — Coverage por scope en Vitest
- **Status**: pending
- **Files**: `vitest.config.ts`, `projects/plugins/mcp-vertex_expostman/vitest.config.ts`, `package.json`
- **Gate**: test
- acceptance:
  - "Se añade un script dedicado de coverage por scope"
  - "La salida distingue al menos `core`, `frameworks`, `cli`, `e2e` y `plugin`"
  - "La herramienta de coverage se integra sin romper la ejecucion habitual de `bun run test`"

### S2 — Umbrales y baseline realistas
- **Status**: pending
- **DependsOn**: [S1]
- **Files**: `scripts/gates/coverage-baseline.constant.ts`, `scripts/gates/check-coverage.script.ts`, `tests/cli/coverage-gate.spec.ts`, `package.json`
- **Gate**: lint
- acceptance:
  - "Cada scope tiene un suelo explicito, no un 100% ficticio"
  - "El gate falla si una regresion baja de ese suelo"
  - "La baseline se puede subir deliberadamente cuando mejore la suite, no por accidente"

### S3 — Presupuesto minimo de rendimiento para `bench:scan`
- **Status**: pending
- **DependsOn**: [S2]
- **Files**: `scripts/gates/bench-scan.script.ts`, `scripts/gates/check-scan-budget.script.ts`, `.github/workflows/validate.yml`
- **Gate**: none
- acceptance:
  - "Existe una comprobacion reproducible que alerta de degradaciones groseras del scan sintetico"
  - "La politica deja claro si ese presupuesto es bloqueante o solo informativo en CI"
  - "El repo deja escrita la razon del umbral, para que no se convierta en numero magico"

## acceptance

- Se añade un script dedicado de coverage por scope
- La salida distingue al menos `core`, `frameworks`, `cli`, `e2e` y `plugin`
- La herramienta de coverage se integra sin romper la ejecucion habitual de `bun run test`
- Cada scope tiene un suelo explicito, no un 100% ficticio
- El gate falla si una regresion baja de ese suelo
- La baseline se puede subir deliberadamente cuando mejore la suite, no por accidente
- Existe una comprobacion reproducible que alerta de degradaciones groseras del scan sintetico
- La politica deja claro si ese presupuesto es bloqueante o solo informativo en CI
- El repo deja escrita la razon del umbral, para que no se convierta en numero magico