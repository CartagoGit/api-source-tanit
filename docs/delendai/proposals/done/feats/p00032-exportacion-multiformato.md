---
id: p00032
title: "p00032 — exportación multiformato: OpenAPI 3.1, Insomnia v4, Bruno, HAR y cURL"
kind: feat
status: done
type: proposal
track: export-to-postman
date: 2026-08-06
related:
    - p00024
    - p00028
shippedIn:
  - cbb62ed  # cierre administrativo (x00032 S1 regla 2): SHA de creación del registro
---

# p00032 — exportación multiformato: OpenAPI 3.1, Insomnia v4, Bruno, HAR y cURL

## Goal

Transformar `export-to-postman` de un generador exclusivo Postman v2.1.0 a
un **motor de exportación multi-target** que produzca colecciones en cinco
formatos adicionales, sin perder el foco en Postman como formato principal.

## why

Muchos equipos no usan Postman como herramienta principal. Generar solo
`.postman_collection.json` limita la audiencia del proyecto a un único
ecosistema. Soportar formatos alternativos multiplica el valor sin reescribir
el motor de escaneo: el pipeline actual ya produce una representación
intermedia (`EndpointSpec[]`) que puede serializarse a cualquier formato.

Targets propuestos:

| Formato | Extensión | Caso de uso |
|---|---|---|
| **OpenAPI 3.1.0** | `.openapi.yaml` / `.json` | Documentación, generación de SDKs, gateway config |
| **Insomnia v4** | `.insomnia.json` | Alternativa open-source a Postman |
| **Bruno** | `.bru` (directorio) | Alternativa Git-friendly, sin cloud |
| **HAR 1.2** | `.har` | Importación en DevTools y herramientas de replay |
| **cURL** | `.sh` | Scripts de terminal portables |

## non-goals

- Reemplazar Postman como formato principal. El `.postman_collection.json`
  sigue siendo la salida por defecto.
- Importar desde esos formatos (solo exportar).

> **Cerrada el 2026-08-07.** Los cinco formatos, con dos decisiones
> anotadas: OpenAPI se emite en **JSON y no en YAML**, y el bloque de
> respuestas de OpenAPI va sin esquema. Las dos por el mismo motivo, y
> está explicado abajo.

## decisiones que se apartan de lo pedido

**~~OpenAPI en JSON, no en YAML.~~ Rectificado: se emite YAML.**

La primera versión salió en JSON por miedo a las reglas de escalares de
YAML — un `descripcion: sí` sin comillas es un booleano, y un fallo así
corrompe el documento en silencio. Al volver sobre ello, la forma segura
resultó ser trivial: **citar toda cadena**. Una cadena entre comillas
dobles es una cadena y ninguna regla de YAML se le aplica; los números y
booleanos van sin comillas porque eso es lo que son en el dato de origen.
El escapado se delega en `JSON.stringify`, que es idéntico al de las
comillas dobles de YAML y es la parte donde un fallo propio sería más
difícil de ver.

`yaml.helper.spec.ts` prueba justo la tabla del infierno: `sí`, `yes`,
`no`, `on`, `off`, `null`, `~`, `1.0`, `08`, `#comentario`,
`hola: mundo`. Y el documento generado se ha parseado con PyYAML para
comprobarlo contra un parser de verdad, no contra la propia idea de lo
que es YAML.

Con el riesgo controlado no había motivo para dar el formato que no se
pedía.

**El `responses` de OpenAPI va sin esquema.** Este proyecto escanea lo
que la API **recibe**; lo que devuelve no está en ninguna señal que se
lea. Se emite el `200` mínimo que la especificación exige. Es la misma
decisión que en p00031 con las respuestas simuladas, y por lo mismo:
inventarse una forma de respuesta que nadie ha comprobado convierte la
documentación en una trampa.

**HAR lleva `status: 0`.** HAR es un formato de **registro**: sus
entradas exigen un objeto `response`. Aquí no hay respuestas porque nunca
se ha ejecutado nada, así que se emite el que el propio formato define
para "no capturada", con los tamaños a -1. Poner un 200 con un cuerpo
inventado habría sido más bonito y más falso.

## dos bugs que salieron al mirar el OpenAPI generado

Un campo `age` salía como `{"type": "number", "minLength": 0, "maxLength": 120}`.

En zod, `.min()` es el **mismo método con dos significados** según el
tipo base: `z.string().min(2)` son dos caracteres, `z.number().min(2)` es
el valor dos. El parser lo mandaba todo a `minLength`, así que las cotas
de cualquier campo numérico se guardaban en una propiedad que no
significa nada sobre un número — y que las herramientas que leen JSON
Schema ignoran. La restricción se perdía sin más.

Afectaba a todo lo que consume esas reglas: el body de ejemplo, la tabla
de documentación de p00031 y ahora los cinco formatos nuevos. Solo se vio
porque OpenAPI pone el tipo y la cota juntos donde se leen de un vistazo.

**Y el segundo: un `GET` con `requestBody`.** El `GET /api/users` del
ejemplo de Express salía documentado con los campos del `POST /orders`.

Los providers que buscan "el esquema más cercano" cuando el handler no
referencia ninguno se lo cuelgan a cualquiera. Es la misma forma del
sangrado de ventana que ya mordió en Fastify y Hono. Mientras esas reglas
solo alimentaban el body de ejemplo no se veía —el body ya se saltaba los
métodos sin cuerpo—, pero en cuanto empezaron a documentarse (p00031) y a
salir en el OpenAPI, el documento describía un `GET` con cuerpo, que no
existe.

Arreglado en el adapter, que es donde se sabe el método: las reglas de
body solo se conservan para `POST`, `PUT` y `PATCH`. Así queda bien en
los seis formatos a la vez y no en cada exportador por su cuenta.

## slices

### S1 — Interfaz `IExportTarget` y registro de exportadores
- **Estado**: done (2026-08-07)
- **Files**: `contracts/export-target.interface.ts`, `services/export-registry.service.ts`.
- **Gate**: `bun test tests/core/export-registry.spec.ts`.
- Define la interfaz `IExportTarget { format: string; serialize(specs: EndpointSpec[], config): string | Record<string, string> }` y un registro extensible.

### S2 — Exportador OpenAPI 3.1.0
- **Estado**: done (2026-08-07)
- **Files**: `services/exporters/openapi.exporter.ts`.
- **Gate**: `bun test tests/unit/openapi-exporter.spec.ts`.
- Genera un documento YAML/JSON con paths, methods, requestBody y responses inferidos de `EndpointSpec`.

### S3 — Exportador Insomnia v4
- **Estado**: done (2026-08-07)
- **Files**: `services/exporters/insomnia.exporter.ts`.
- **Gate**: `bun test tests/unit/insomnia-exporter.spec.ts`.

### S4 — Exportador Bruno (directorio `.bru`)
- **Estado**: done (2026-08-07)
- **Files**: `services/exporters/bruno.exporter.ts`.
- **Gate**: `bun test tests/unit/bruno-exporter.spec.ts`.

### S5 — Exportador HAR 1.2 y cURL
- **Estado**: done (2026-08-07)
- **Files**: `services/exporters/har.exporter.ts`, `services/exporters/curl.exporter.ts`.
- **Gate**: `bun test tests/unit/har-curl-exporter.spec.ts`.

### S6 — Flag CLI `--format`
- **Estado**: done (2026-08-07)
- **Files**: `scripts/cli.script.ts`, `scripts/generate.script.ts`.
- **Gate**: `bun test tests/cli/cli-format-flag.test.ts`.
- `bun run expostman --project-root ./mi-api --format openapi,insomnia,postman`.

## acceptance

- `--format openapi` genera un `.openapi.yaml` 3.1.0 válido. ✔
  Comprobado además con PyYAML: parsea y conserva tipos y cotas.
- `--format insomnia` genera un JSON con `__export_format: 4` y la
  jerarquía por `parentId`, con **ids estables** entre generaciones —
  con ids aleatorios, reimportar duplicaría la colección cada vez. ✔
- `--format bruno` genera el árbol con su `bruno.json`, un `.bru` por
  request y las variables en un entorno. ✔
- Los formatos se combinan. ✔ `--format postman,openapi,insomnia,bruno,har,curl`
  produce 20 ficheros del ejemplo de Express.
- Un formato inventado falla **antes** de escanear y lista los válidos,
  igual que `--framework`. ✔
- `bun run validate` verde. ✔ 1742 tests, 19/19 ejemplos.
