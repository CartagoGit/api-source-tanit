---
id: p00035
title: "p00035 — CLI interactivo TUI con vista previa, selección de frameworks y dashboard de calidad"
kind: feat
status: ready
type: proposal
track: postman-exporter
date: 2026-08-06
related:
    - p00025
---

# p00035 — CLI interactivo TUI con vista previa, selección de frameworks y dashboard de calidad

## Goal

Implementar un modo interactivo `bun run expostman ui` (o `expostman --interactive`)
que presente al usuario una interfaz de terminal (TUI) con navegación,
vista previa de rutas descubiertas, selección de frameworks detectados y
un dashboard de métricas de calidad de la colección generada.

## why

El CLI actual es funcional pero puramente textual: imprime líneas de log
y termina. Para llegar a 11/10 en experiencia de desarrollador, el CLI
debe ofrecer una experiencia **rica, visual y accionable** directamente
en la terminal, sin requerir navegador ni GUI:

1. **Selección de Proyecto**: Navegación interactiva para elegir el directorio
   del proyecto cuando no se pasa `--project-root`.
2. **Vista Previa de Rutas**: Tabla interactiva con método, URI, zona/carpeta,
   estado de validación (con/sin reglas) y body inferido.
3. **Selección Multi-framework**: Cuando se detectan múltiples frameworks,
   el usuario puede elegir cuáles escanear (checkbox).
4. **Dashboard de Calidad**: Barra de progreso, contadores de endpoints,
   cobertura de reglas, cobertura de bodies y warnings/errores.
5. **Flujo de Exportación**: Selección del formato de salida
   (Postman, OpenAPI, Insomnia, Bruno, cURL) y confirmación de escritura.

## non-goals

- Implementar una GUI web o aplicación de escritorio.
- Requerir dependencias pesadas de renderizado (solo ANSI escape codes /
  biblioteca ligera tipo `@inquirer/prompts` o `ink`).

## slices

### S1 — Prompt interactivo de selección de proyecto
- **Files**: `scripts/interactive.script.ts`.
- **Gate**: revisión manual.
- Presenta un listado de directorios con `package.json` / `composer.json` /
  `requirements.txt` / `go.mod` encontrados y permite seleccionar uno.

### S2 — Vista previa de rutas descubiertas con tabla ANSI
- **Files**: `scripts/interactive.script.ts`, `helpers/tui-table.helper.ts`.
- **Gate**: revisión manual.
- Tras la detección, muestra una tabla ordenada por zona/método con colores
  semánticos (verde = con validación, amarillo = sin validación, rojo = error).

### S3 — Dashboard de métricas post-generación
- **Files**: `helpers/tui-dashboard.helper.ts`.
- **Gate**: revisión manual.
- Muestra barras de progreso: `Rutas: 42/42 ✅`, `Bodies: 38/42 (90%)`,
  `Auth: configurado ✅`, `Validaciones: 35/42 (83%)`.

### S4 — Integración con `--interactive` flag en CLI
- **Files**: `scripts/cli.script.ts`.
- **Gate**: `bun test tests/cli/cli-interactive.test.ts`.
- El flag `--interactive` (o `-i`) activa el modo TUI; sin flag, el
  comportamiento actual permanece intacto.

## acceptance

- `expostman -i` presenta un flujo visual completo en la terminal.
- Todas las funciones del CLI estándar siguen funcionando sin el flag.
- `bun run validate` verde.
