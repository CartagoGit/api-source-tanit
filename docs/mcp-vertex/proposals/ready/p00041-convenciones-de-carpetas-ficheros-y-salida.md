---
id: p00041
title: "p00041 — convenciones de carpetas, sufijos de fichero y carpeta de salida"
kind: refactor
status: ready
type: proposal
track: export-to-postman
date: 2026-08-06
related:
    - p00020 # reorganización de la arquitectura de carpetas
    - p00022 # bin multi-lenguaje: los wrappers dependen del nombre de salida
    - p00023 # paridad entre frameworks
    - p00027 # el plugin como proyecto independiente
---

# p00041 — convenciones de carpetas, ficheros y salida

## por qué

Tres cosas que no siguen ninguna regla, y una que además es invasiva
para quien usa la herramienta.

### 1. Las carpetas contenedoras están en singular

`contract/`, `helper/`, `service/`, `plugins/`, `frameworks/`,
`scripts/`, `tests/`, `examples/`. Ocho carpetas y dos convenciones: las
cuatro primeras en singular, las cuatro últimas en plural. No hay
criterio, es histórico.

Una carpeta contiene **varias** cosas de ese tipo: `helper/` tiene 8
helpers, `contract/` tiene 6 contratos, `service/` tiene 11 servicios.
El plural es lo que dice la verdad.

### 2. Dos ficheros de `scripts/` no llevan sufijo

Medido:

```
scripts/lint-tool-no-process.ts   ← debería ser .script.ts
scripts/gates/sections.ts         ← no es un script, es un registro
```

`lint-tool-no-process.ts` es un script ejecutable como los otros 20 y no
lo dice. `sections.ts` es lo contrario: **no** es un script, es el
registro de secciones que consumen los gates, así que su sitio no es
`scripts/` — el sufijo correcto es `.constant.ts` o vive en `contracts/`.

Los sufijos que sí están asentados y hay que respetar:
`.interface.ts`, `.constant.ts`, `.helper.ts`, `.service.ts`,
`.scanner.ts`, `.adapter.ts`, `.script.ts`, `.spec.ts`, `.test.ts`.
Hay tres sueltos que hay que decidir: `.pipeline.ts` y `.orchestrator.ts`
en `service/`, y `registry.ts` / `index.ts` en `frameworks/`.

### 3. La salida se escribe en `build/` DEL PROYECTO AJENO

Este es el que hace daño de verdad. `outputDir()` resuelve a
`${projectRoot}/build/`. O sea que ejecutar la herramienta sobre el
proyecto de alguien le mete ficheros en su `build/`.

Y `build/` no es una carpeta cualquiera: es la carpeta de salida por
defecto de Gradle, de Maven con algunas configuraciones, de muchos
proyectos de Go y de la mitad de los `Makefile` del mundo. Mezclamos
nuestras colecciones con sus artefactos de compilación, en una carpeta
que su `clean` borra entera.

Y hay un segundo efecto medido en este mismo repo: correr el gate sobre
los 12 ejemplos creó 12 carpetas `build/` que no estaban, y la persona
que abrió el repo después no sabía qué eran.

Nuestro proyecto se llama `export-to-postman`. Nadie tiene una carpeta
con ese nombre, y si la tiene, es la nuestra.

### 4. Multiplataforma

La resolución de rutas usa `join`/`resolve` de `node:path`, que ya es
correcto, pero hay sitios que comparan y construyen rutas con `/` a
mano. En Windows eso no casa. Hay que barrerlo y dejarlo cubierto por
tests.

## no-objetivos

- Reorganizar en `projects/{core,cli,ui}` — eso es p00020, y es más
  grande. Esto es la capa de convenciones, que se puede hacer antes y
  deja p00020 más fácil.
- Cambiar el nombre del paquete o del binario — eso es p00025.

## slices

### S1 — carpeta de salida propia, y multiplataforma
- **Estado**: ready
- **Ficheros**: `service/paths.service.ts`, `contract/*.constant.ts`,
  `.gitignore`, `docs/INSTALL.md`, `docs/POSTMAN.md`, `README.md`,
  `examples/README.md`, tests nuevos.
- **Gate**: `bun run validate` + un test por plataforma simulada.

- La salida por defecto pasa a ser `${projectRoot}/export-to-postman/`.
- `--output-dir` y `POSTMAN_OUTPUT_DIR` siguen mandando por encima.
- Se añade a `.gitignore` **del proyecto escaneado** solo si se pide
  explícitamente (`--gitignore`): no se toca el repo de nadie sin
  permiso.
- Barrido de construcción de rutas: nada de concatenar con `/`.
- **Aceptación**:
  - Generar sobre un proyecto que ya tiene `build/` no lo toca.
  - Un test comprueba que la ruta se construye con el separador del
    sistema y que `toProjectRelative` normaliza los dos sentidos.
  - Los 12 ejemplos generan en `examples/<x>/export-to-postman/`.

### S2 — carpetas contenedoras en plural
- **Estado**: ready
- **Ficheros**: `contract/` → `contracts/`, `helper/` → `helpers/`,
  `service/` → `services/`, y todos los imports.
- **Gate**: `bun run typecheck && bun run lint:boundaries`.

- `git mv` de las tres carpetas y reescritura de imports.
- `scripts/gates/sections.ts` y los tsconfig por sección van detrás.
- El `exports` del `package.json` también (`./service/*` →
  `./services/*`).
- **Aceptación**: `grep -rn '"\.\./\(contract\|helper\|service\)/'` sin
  resultados.

### S3 — sufijos de fichero coherentes
- **Estado**: ready
- **Ficheros**: `scripts/lint-tool-no-process.ts`,
  `scripts/gates/sections.ts`, `service/generation.pipeline.ts`,
  `service/discovery.orchestrator.ts`, `frameworks/registry.ts`.
- **Gate**: un lint nuevo, `lint:naming`.

- `lint-tool-no-process.ts` → `lint-tool-no-process.script.ts`.
- `scripts/gates/sections.ts` → `contracts/sections.constant.ts`: no es
  un script, es el registro que consumen los cuatro gates.
- Decidir y aplicar: `.pipeline.ts` y `.orchestrator.ts` se quedan (son
  tipos de módulo con significado propio, como `.adapter.ts`), y
  `frameworks/registry.ts` → `frameworks/framework.registry.ts`.
- `lint:naming` comprueba que todo `.ts` bajo las carpetas de código
  lleva uno de los sufijos permitidos, con la lista en un solo sitio.
- **Aceptación**: `bun run lint:naming` en verde y en el gate.

### S4 — documentar la convención
- **Estado**: ready
- **Ficheros**: `CONTRIBUTING.md`, `.github/agents.md`,
  `docs/mcp-vertex/AGENT-BOOTSTRAP.md`.

- Tabla de sufijos con qué significa cada uno y dónde vive.
- La regla del plural, con el porqué.
- La carpeta de salida y por qué no es `build/`.
- **Aceptación**: alguien que abre el repo por primera vez sabe dónde
  poner un fichero nuevo sin preguntar.

## aceptación global

- Ninguna carpeta contenedora en singular.
- Todo `.ts` de código lleva sufijo, y `lint:naming` lo exige.
- Generar sobre un proyecto ajeno no escribe fuera de
  `<proyecto>/export-to-postman/`.
- El gate entero en verde en Linux, y las rutas construidas de forma que
  funcionen igual en macOS y Windows.
