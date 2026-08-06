---
id: p00032
title: "p00032 — exportación multiformato: OpenAPI 3.1, Insomnia v4, Bruno, HAR y cURL"
kind: feat
status: ready
type: proposal
track: export-to-postman
date: 2026-08-06
related:
    - p00024
    - p00028
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

## slices

### S1 — Interfaz `IExportTarget` y registro de exportadores
- **Files**: `contracts/export-target.interface.ts`, `services/export-registry.service.ts`.
- **Gate**: `bun test tests/core/export-registry.spec.ts`.
- Define la interfaz `IExportTarget { format: string; serialize(specs: EndpointSpec[], config): string | Record<string, string> }` y un registro extensible.

### S2 — Exportador OpenAPI 3.1.0
- **Files**: `services/exporters/openapi.exporter.ts`.
- **Gate**: `bun test tests/unit/openapi-exporter.spec.ts`.
- Genera un documento YAML/JSON con paths, methods, requestBody y responses inferidos de `EndpointSpec`.

### S3 — Exportador Insomnia v4
- **Files**: `services/exporters/insomnia.exporter.ts`.
- **Gate**: `bun test tests/unit/insomnia-exporter.spec.ts`.

### S4 — Exportador Bruno (directorio `.bru`)
- **Files**: `services/exporters/bruno.exporter.ts`.
- **Gate**: `bun test tests/unit/bruno-exporter.spec.ts`.

### S5 — Exportador HAR 1.2 y cURL
- **Files**: `services/exporters/har.exporter.ts`, `services/exporters/curl.exporter.ts`.
- **Gate**: `bun test tests/unit/har-curl-exporter.spec.ts`.

### S6 — Flag CLI `--format`
- **Files**: `scripts/cli.script.ts`, `scripts/generate.script.ts`.
- **Gate**: `bun test tests/cli/cli-format-flag.test.ts`.
- `bun run expostman --project-root ./mi-api --format openapi,insomnia,postman`.

## acceptance

- `--format openapi` genera un `.openapi.yaml` importable sin errores en Swagger Editor.
- `--format insomnia` genera un JSON importable en Insomnia 2024+.
- `--format bruno` genera un directorio `.bru` abriendo correctamente en Bruno.
- Los formatos se pueden combinar (`--format postman,openapi`).
- `bun run validate` verde sin regresiones.
