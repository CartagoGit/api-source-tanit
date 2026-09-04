---
id: p00035
title: "p00035 — CLI interactivo TUI con vista previa, selección de frameworks y dashboard de calidad"
kind: feat
status: done
type: proposal
track: export-to-postman
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

> **Cerrada el 2026-08-07.** Sin `ink` ni `@inquirer/prompts`: el
> binario compilado no carga paquetes en tiempo de ejecución, así que
> una TUI con dependencias no funcionaría justo donde más se usa. Se
> dibuja con ANSI a pelo, y el cuidado está en que **degrade bien**.

## lo que se rompe de verdad en una TUI

Tres cosas, y las tres solo se ven en la terminal de otra persona:

**El color cuando nadie mira.** `expostman list > salida.txt` deja el
fichero lleno de `[32m` si no se comprueba. Se apaga con
`NO_COLOR` (el convenio de facto), con `TERM=dumb`, y —lo que más
importa— cuando **la salida no es un TTY**. `FORCE_COLOR` lo enciende
para los runners que sí saben leer ANSI.

**El color descuadra las tablas.** `[32mGET[0m` son tres
caracteres visibles y doce reales; alinear con un `padEnd` normal
descoloca cada celda coloreada. Todo el alineado va por ancho visible.

**La terminal no siempre mide 80.** Una tabla más ancha que la ventana la
parte el emulador por donde le apetece. Las columnas se reparten el ancho
real, y al recortar se encoge **la más ancha** en vez de todas por igual
— si no, el método acaba en `GE`, que no dice nada, mientras la URI sigue
sobrando.

## el bug que salió al probarlo

`printf "ruta\nn\n" | expostman -i` metía las dos respuestas en la
primera pregunta. `ask()` trataba un **chunk** de stdin como una línea:
escribiendo a mano coinciden —cada Enter manda lo suyo— pero por una
tubería llegan todas juntas.

O sea que el asistente **no se podía scriptear ni probar**, que es
exactamente por lo que no tenía tests. Ahora hay un lector de líneas de
verdad, que guarda lo que sobra de cada chunk para la siguiente pregunta.

## slices

### S1 — Prompt interactivo de selección de proyecto
- **Estado**: done (2026-08-07)
- **Files**: `scripts/interactive.script.ts`.
- **Gate**: revisión manual.
- Presenta un listado de directorios con `package.json` / `composer.json` /
  `requirements.txt` / `go.mod` encontrados y permite seleccionar uno.

### S2 — Vista previa de rutas descubiertas con tabla ANSI
- **Estado**: done (2026-08-07)
- **Files**: `scripts/interactive.script.ts`, `helpers/tui-table.helper.ts`.
- **Gate**: revisión manual.
- Tras la detección, muestra una tabla ordenada por zona/método con colores
  semánticos (verde = con validación, amarillo = sin validación, rojo = error).

### S3 — Dashboard de métricas post-generación
- **Estado**: done (2026-08-07)
- **Files**: `helpers/tui-dashboard.helper.ts`.
- **Gate**: revisión manual.
- Muestra barras de progreso: `Rutas: 42/42 ✅`, `Bodies: 38/42 (90%)`,
  `Auth: configurado ✅`, `Validaciones: 35/42 (83%)`.

### S4 — Integración con `--interactive` flag en CLI
- **Estado**: done (2026-08-07)
- **Files**: `scripts/cli.script.ts`.
- **Gate**: `bun test tests/cli/cli-interactive.test.ts`.
- El flag `--interactive` (o `-i`) activa el modo TUI; sin flag, el
  comportamiento actual permanece intacto.

## aceptación

- `expostman -i` presenta el flujo completo: tabla de endpoints, resumen
  de calidad con barras, elección de formatos y confirmación. ✔
- Sin el flag, nada cambia. ✔ 1801 tests, 19/19 ejemplos.
- 29 tests cubren las piezas puras — que el color se apague cuando nadie
  mira, que una celda coloreada no descuadre la tabla, y que ninguna fila
  se pase del ancho dado.

## la columna que justifica la tabla

`Reglas`. Dice si los campos de cada endpoint salen **del código** o de
una heurística, y es lo único que no se puede deducir mirando la
colección después. En `example-express` son 5 de 9: esos 4 son los que
hay que revisar, y el resumen lo dice con esas palabras en vez de dejar
un porcentaje suelto. Un número de cobertura sin la acción que sugiere es
un dato, no una ayuda.
- `bun run validate` verde.
