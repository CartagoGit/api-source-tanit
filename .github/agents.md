# agents.md — `postman-exporter`

Una página para orientarse antes de tocar nada. Las reglas vinculantes
viven en [`docs/mcp-vertex/AGENT-BOOTSTRAP.md`](../docs/mcp-vertex/AGENT-BOOTSTRAP.md);
esto es el mapa.

---

## Qué hace el paquete

Genera colecciones de Postman v2.1.0 desde el **código** de una API, sin
anotaciones ni servidor levantado. Detecta el framework solo entre 12:
Laravel, Symfony, Express/Fastify/Koa/Hapi, NestJS, Next.js, FastAPI,
Flask, Django/DRF, Gin, Spring Boot, ASP.NET Core y OpenAPI.

Se distribuye de tres formas: paquete npm (`postman-from-routes`),
binario autocontenido por plataforma, y plugin de mcp-vertex.

---

## El gate

**Un solo comando.** Si pasa, se puede cerrar la slice.

```bash
bun run validate
```

Encadena `typecheck` → `lint:tools` → `bun test` → `validate:examples`
(genera de verdad los 11 proyectos de `examples/` y valida cada
colección). Corre igual en CI.

Aparte, antes de publicar:

```bash
bun run validate:package   # empaqueta, instala en un proyecto limpio y ejecuta el binario
bun run build:binary --all # los 4 ejecutables
```

`bun run check` **no** es el gate: verifica una colección ya generada y
necesita un `build` previo.

---

## Arquitectura en 30 segundos

```
projectRoot
  │
  ├─ DiscoveryOrchestrator  ── elige el framework por score (scanner-registry.ts)
  │
  ├─ IProjectScanner        ── ¿qué framework es? qué artefactos hay
  ├─ IRouteScanner          ── rutas en formato neutro (ParsedRoute)
  ├─ IValidationSpecProvider── reglas de campos (IValidationSpec)
  │
  ├─ parsed-route-to-spec   ── ParsedRoute → EndpointSpec
  ├─ param-inferrer         ── rellena lo que no tenga reglas
  ├─ collection-builder     ── EndpointSpec[] → PostmanCollection
  └─ auth-flow              ── login/refresh/logout + captura del token
```

Todo eso lo orquesta **`service/generation.pipeline.ts`**, que es el
único sitio donde se decide el orden de los pasos. El CLI, los tests y el
gate lo llaman a él: si añades un paso, va ahí, no en el script.

---

## Dónde tocar según qué

| Quiero… | Toco |
|---|---|
| Añadir un framework | `service/scanners/<fw>.scanner.ts` + registrarlo en `service/scanner-registry.ts` |
| Cambiar la forma de la colección | `service/collection-builder.service.ts` |
| Cambiar el flujo de login | `service/auth-flow.service.ts` |
| Parsear una librería de validación nueva | `helper/<lib>-schema.helper.ts` |
| Añadir un comando al CLI | `scripts/<nombre>.script.ts` + entrada en `scripts/cli.script.ts` |
| Añadir un tool MCP | `plugins/postman-exporter/src/lib/tools/<nombre>.tool.ts` |

---

## Reglas que rompen el build si las incumples

1. **Nada de `process.cwd()` ni `process.env` en los tools del plugin.**
   El contexto es `IMcpPluginContext`. Lo comprueba `bun run lint:tools`.
2. **Los scanners reciben `match.projectRoot`; úsalo.** No leas la raíz
   del singleton de `paths.service`: rompe la reentrancia y ya causó un
   bug en el provider de FormRequests de Laravel.
3. **Un scanner nuevo hereda el contrato de test.** Invoca
   `describeScannerContract` en su spec y `describeCollectionContract` en
   su e2e. Lo que tu framework no cumpla se **declara** en
   `capabilities`, no se omite.
4. **`sourceFile` siempre relativo al proyecto.** El contrato lo verifica.
5. **Sin listas paralelas de frameworks.** Se derivan del registry con
   `SUPPORTED_FRAMEWORKS` y `scannerBundleFor()`.
6. **Los `import()` del CLI son literales estáticos**, o el binario
   compilado se queda sin esos módulos.

---

## Tools del plugin MCP

Namespace `postman-exporter`, declarados en
[`plugins/postman-exporter/src/index.ts`](../plugins/postman-exporter/src/index.ts):

| Tool | Qué hace |
|---|---|
| `generate` | Genera la colección de un proyecto host |
| `validate` | Valida una colección contra el schema v2.1.0 |
| `summary` | Inspecciona un proyecto sin escribir artefactos |
| `test` | Typecheck + smoke por framework + suite e2e |

---

## Estado

- **Auditoría vigente**: [`docs/mcp-vertex/AUDIT-2026-08-06.md`](../docs/mcp-vertex/AUDIT-2026-08-06.md)
  — bugs encontrados, causas raíz y lo que queda abierto.
- **Propuestas**: [`docs/mcp-vertex/proposals/`](../docs/mcp-vertex/proposals/),
  con la misma disposición que mcp-vertex: la carpeta **es** el estado
  (`ready/`, `in-progress/`, `review/`, `done/`, `paused/`, `blocked/`,
  `retired/`, `legacy/`), y `done/` archiva por kind. Moverla de carpeta
  y cambiar su `status` es la misma operación; `bun run lint:proposals`
  falla si solo se hace una de las dos. Referencia por `id`, nunca por
  nombre de fichero.

---

## Documentación de usuario

[README](../README.md) · [instalación](../docs/INSTALL.md) ·
[por framework](../docs/FRAMEWORKS.md) · [importar en Postman](../docs/POSTMAN.md)
