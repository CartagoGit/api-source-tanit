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
| Paquete del plugin | `@expostman/mcp-vertex-plugin` | `projects/plugins/mcp-vertex/package.json` |
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

## Por qué el plugin vive en `projects/plugins/mcp-vertex/`

La carpeta dice **para qué host** es el plugin, no qué hace — eso ya lo
dice el proyecto entero. Si algún día hay un plugin para otro host, su
sitio es evidente: `projects/plugins/<host>/`.

El plural sigue la regla del repo: una carpeta contenedora contiene
varias cosas de ese tipo, aunque hoy haya una.

## Lo que NO se renombra

La prosa de las propuestas cerradas (`done/`, `retired/`, `blocked/`) y
`AUDIT-2026-08-06.md`. Son registro de lo que pasó y describen el
proyecto como se llamaba entonces; reescribirlas convertiría un archivo
histórico en una ficción. Solo se les corrigió el `track:`, que es
metadato de a qué proyecto pertenecen.

## Si hay que cambiar alguno

Empieza por aquí, cambia la tabla, y luego busca el nombre viejo en todo
el repo excluyendo las propuestas cerradas:

```sh
grep -rn "<nombre-viejo>" --include="*.ts" --include="*.json" --include="*.md" . \
  --exclude-dir=node_modules --exclude-dir=dist \
  | grep -v "proposals/\(done\|retired\|blocked\)/"
```
