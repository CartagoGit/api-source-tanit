# Nombres

Un sitio con todos los nombres del proyecto y qué manda sobre cuál.
Existía porque había tres a la vez —`postman-from-routes`,
`postman-exporter`, `export-to-postman`— y ninguno decía cuál era el
bueno. La decisión de marca actual (Tanit / `api-source-tanit`) cierra
esa puerta: el nombre ya describe la categoría completa del producto
(API Source Discovery) y no una sola función.

## Lo decidido

| Qué | Nombre | Dónde vive |
| --- | --- | --- |
| Producto / repositorio | `api-source-tanit` | nombre del repo, `package.json` |
| Bin canónico | **`apisrc`** | `package.json` → `bin` |
| Plugin de delendai | `tanit` | `src/index.ts` → `plugin.name` |
| Paquete del plugin (interno) | `delendai-plugin-tanit` | `packages/plugins/delendai_tanit/package.json` — `"private": true`, NO se publica |
| Tools MCP | `delendai_tanit_<tool>` | los construye el host |
| Carpeta de salida | `tanit/` | `OUTPUT_DIR_NAME` |
| Prefijo de env vars | `TANIT_` | `TANIT_PROJECT_ROOT`, `TANIT_OUTPUT_DIR`… |

## Por qué `apisrc` para el bin

`export-to-postman` son 17 caracteres. Un bin así fricciona en scripts,
Makefiles, CI y sobre todo al decirlo en voz alta. La transición pasó
por `expostman` (9 ch) — ver [p00025](delendai/proposals/done/feats/p00025-nombre-corto-producto-y-bin.md) —
y llegó a `apisrc` (6 ch), que describe la categoría (API source) sin
anclar el producto a un solo exportador.

## Por qué el plugin se llama `tanit` y no `api-source-tanit`

Los tools MCP se registran como `<host>_<plugin>_<tool>`. Con el nombre
largo salían así:

```
delendai_api-source-tanit_generate
```

30 caracteres para invocar una herramienta desde un agente. Con el
corto:

```
delendai_tanit_generate
```

El prefijo `delendai_` ya dice de qué host es; el nombre del plugin no
necesita repetir la frase entera. El cambio desde `expostman` a `tanit`
se hizo porque **Tanit ya no describe un exportador a Postman**: la
categoría incluye Insomnia, OpenAPI, HAR y otros, así que el nombre del
plugin debe ser la marca del producto, no la del bin histórico.

## Por qué el plugin vive en `packages/plugins/delendai_tanit/`

La carpeta dice **para qué host** es el plugin, no qué hace — eso ya lo
dice el proyecto entero. Si algún día hay un plugin para otro host, su
sitio es evidente: `packages/plugins/<host>/`.

El plural sigue la regla del repo: una carpeta contenedora contiene
varias cosas de ese tipo, aunque hoy haya una.

## Sufijos por carpeta

La lista la impone `lint:naming`, y **esta tabla se deriva de ella**: si
las dos dejan de coincidir, manda el gate y esto está mal.

| Carpeta | Sufijos | Qué vive ahí |
| --- | --- | --- |
| `packages/contracts/interfaces/` | `.interface.ts`, `.d.ts` | Interfaces y tipos compartidos |
| `packages/contracts/constants/` | `.constant.ts` | Constantes compartidas |
| `packages/core/helpers/` | `.helper.ts` | Funciones puras, sin estado ni I/O |
| `packages/core/exporters/` | `.exporter.ts`, `.service.ts` | Un formato de salida por fichero |
| `packages/core/` (resto) | `.service.ts`, `.pipeline.ts`, `.orchestrator.ts`, `.adapter.ts` | El núcleo agnóstico |
| `packages/frameworks/` | `.scanner.ts`, `.service.ts`, `.helper.ts`, `.registry.ts` | Lo concreto de cada framework |
| `packages/cli/` | `.script.ts`, `.constant.ts` | El dispatcher y un fichero por comando |
| `packages/ui/` | `.script.ts`, `.helper.ts`, `.constant.ts` | El asistente y lo que dibuja en la terminal |
| `packages/plugins/*/src/lib/tools/` | `.tool.ts` | Un tool MCP por fichero |
| `scripts/` | `.script.ts`, `.constant.ts` | Tooling del repo: gates y build |
| `scripts/helpers/` | `.helper.ts` | Utilidades compartidas por el tooling |
| `tests/**` | `.spec.ts`, `.test.ts` | `.spec` para unidad, `.test` para lo que arranca procesos |

### Por qué `.pipeline`, `.orchestrator`, `.adapter` y `.exporter`

Podrían ser todos `.service.ts` y el gate pasaría igual. No lo son
porque **el sufijo es lo primero que se lee de un fichero**, y en
`packages/core/` hay quince servicios: llamar `.service` a la tubería de
generación la escondería entre ellos.

Cada uno nombra un tipo de módulo con significado propio:

- `.pipeline` — orquesta una secuencia de fases de principio a fin.
- `.orchestrator` — elige entre colaboradores y se queda con uno.
- `.adapter` — traduce entre dos contratos, sin lógica de negocio.
- `.exporter` — implementa `IExportTarget`: el catálogo a **un** formato.

Estos cuatro no estaban documentados en ninguna parte hasta la auditoría
de 2026-08-08: `lint:naming` los conocía y la documentación no, así que
quien añadiera un exportador nuevo no tenía dónde mirar.

## Lo que NO se renombra

La prosa de las propuestas cerradas (`done/`, `retired/`, `blocked/`) se
conserva como registro histórico. Las auditorías canónicas viven en
`docs/delendai/proposals/done/audits/`, con `id`, `kind: audit`, `status:
done` y ruta indexada. `docs/delendai/audits/` queda reservado para
informes crudos todavía no convertidos en propuesta.

## Si hay que cambiar alguno

Empieza por aquí, cambia la tabla, y luego busca el nombre viejo en todo
el repo excluyendo las propuestas cerradas:

```sh
grep -rn "<nombre-viejo>" --include="*.ts" --include="*.json" --include="*.md" . \
  --exclude-dir=node_modules --exclude-dir=dist \
  | grep -v "proposals/\(done\|retired\|blocked\)/"
```

## Tanit decision (2026-09-04)

The rebrand from `export-to-postman` → Tanit / `api-source-tanit` /
`apisrc` / `delendai_tanit` / `tanit/` was decided on 2026-09-04 and
implemented as [`b00001`](delendai/proposals/done/breakings/b00001-rebrand-tanit-el-proyecto-pasa-de-export-to-postman-a-tanit-api-source-discovery.md)
(slices S1–S7). The full rename table and the rationale are in that
proposal.

This decision supersedes [`p00025`](delendai/proposals/done/feats/p00025-nombre-corto-producto-y-bin.md),
which introduced `expostman` as a short bin alias but kept the project
name anchored to "Postman". `p00025` stays in the archive (`done/`) as
the archaeology of how the short bin was first chosen — the rename to
Tanit is the next step, not a contradiction.
