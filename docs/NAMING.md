# Nombres

Un sitio con todos los nombres del proyecto y qué manda sobre cuál.
Existe porque había tres a la vez —`postman-from-routes`,
`postman-exporter`, `export-to-postman`— y ninguno decía cuál era el
bueno.

## Lo decidido

| Qué | Nombre | Dónde vive |
| --- | --- | --- |
| Producto / repositorio | `export-to-postman` | nombre del repo, `package.json` |
| Bin canónico | **`expostman`** | `package.json` → `bin` |
| Bin alias | `export-to-postman` | `package.json` → `bin`, mismo destino |
| Plugin de mcp-vertex | `expostman` | `src/index.ts` → `plugin.name` |
| Paquete del plugin | `@expostman/mcp-vertex-plugin` | `packages/plugins/mcp-vertex_expostman/package.json` |
| Tools MCP | `mcp-vertex_expostman_<tool>` | los construye el host |
| Carpeta de salida | `export-to-postman/` | `OUTPUT_DIR_NAME` |
| Prefijo de env vars | `POSTMAN_` | `POSTMAN_PROJECT_ROOT`, `POSTMAN_OUTPUT_DIR`… |

## Por qué `expostman` para el bin

`export-to-postman` son 17 caracteres. Un bin así fricciona en scripts,
Makefiles, CI y sobre todo al decirlo en voz alta. `expostman` son 9,
se lee igual ("export postman") y no choca con nada del PATH habitual.

El largo se mantiene **como alias**, apuntando al mismo entrypoint. No
cuesta nada y evita romper cualquier script que ya lo use.

## Por qué el plugin se llama `expostman` y no `export-to-postman`

Los tools MCP se registran como `<host>_<plugin>_<tool>`. Con el nombre
largo salían así:

```
mcp-vertex_export-to-postman_generate
```

39 caracteres para invocar una herramienta desde un agente. Con el corto:

```
mcp-vertex_expostman_generate
```

El prefijo `mcp-vertex_` ya dice de qué host es; el nombre del plugin no
necesita repetir la frase entera.

## Por qué el plugin vive en `packages/plugins/mcp-vertex_expostman/`

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
`docs/mcp-vertex/proposals/done/audits/`, con `id`, `kind: audit`, `status:
done` y ruta indexada. `docs/mcp-vertex/audits/` queda reservado para
informes crudos todavía no convertidos en propuesta.

## Si hay que cambiar alguno

Empieza por aquí, cambia la tabla, y luego busca el nombre viejo en todo
el repo excluyendo las propuestas cerradas:

```sh
grep -rn "<nombre-viejo>" --include="*.ts" --include="*.json" --include="*.md" . \
  --exclude-dir=node_modules --exclude-dir=dist \
  | grep -v "proposals/\(done\|retired\|blocked\)/"
```
