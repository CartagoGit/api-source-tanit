---
id: a00006
title: "Auditoría exhaustiva de tipado, validación, lint y bugs"
kind: audit
track: export-to-postman
date: 2026-08-30
status: done
type: proposal
---

# Auditoría 2026-08-30

## Estado de los gates

- `bun run typecheck`: verde. Las 6 secciones (`contracts`, `core`, `frameworks`, `cli`, `e2e`, `plugin`) tipan correctamente.
- `bun run lint`: verde. La configuración MCP, la referencia API y la tabla de frameworks están sincronizadas.
- `bunx vitest run --coverage`: cobertura generada con 83.01% statements, 71.75% branches, 87.91% functions y 84.67% lines; supera los umbrales 73%, 70%, 82% y 75%. Las suites focalizadas de los cambios integradores pasan: loader 42/42 y OpenAPI + builder 31/31.
- `bun run validate:examples`: 21/21 ejemplos generan una colección válida.
- `bun run bench:check`: coste por fichero plano, con máximo 1.6x en la comprobación medida.

Los gates verdes no prueban que cada caso de entrada esté bien representado. Los siguientes defectos son silenciosos y requieren corrección y tests específicos.

## Hallazgos críticos

### F-001 [FATAL] Fastify: `app.route({ schema })` pierde las reglas de validación

- Evidencia: `packages/frameworks/scanners/fastify.scanner.ts`, en `FastifyRouteScanner.scan()`, el primer bucle procesa `schemaInCall()` para `parseShortRoutes()`, pero el segundo bucle añade las rutas de `parseRouteObjects()` sin registrar su schema en `this.schemas`.
- Impacto: la forma oficial `app.route({ method, url, schema })` aparece en la colección sin validación, aunque el schema está presente en el código fuente.
- Corrección: hacer que `parseRouteObjects()` devuelva los límites de la llamada y aplicar `schemaInCall()` igual que en las rutas cortas.
- Test: `app.route({ schema }) alimenta a FastifySchemaProvider`.

### F-002 [FATAL] Django REST Framework: `ReadOnlyModelViewSet` inventa métodos de escritura

- Evidencia: `packages/frameworks/scanners/django.scanner.ts`, `methodsFromBaseClass()` agrupa `ModelViewSet`, `ReadOnlyModelViewSet` y `ViewSet` y devuelve GET, POST, PUT, PATCH y DELETE.
- Impacto: un `ReadOnlyModelViewSet` genera cuatro endpoints que el servidor rechaza con 405.
- Corrección: tratar `ReadOnlyModelViewSet` antes de `ModelViewSet` y devolver solo GET.
- Test: corregir el caso existente y añadir fixture específico de `ReadOnlyModelViewSet`.

### F-003 [FATAL] OpenAPI 3: se ignora `servers[0].url`

- Evidencia: `packages/frameworks/scanners/openapi.scanner.ts`, el prefijo se obtiene únicamente de `opts.basePath` o de `spec.basePath`; no existe lectura de `servers`.
- Impacto: un spec con `servers: [{ url: "https://api.example.com/v1" }]` produce `/users` en vez de `/v1/users`.
- Corrección: usar `servers[0].url` como fallback compatible con OpenAPI 3 y conservar solo su path, incluyendo variables de servidor.
- Test: `servers[0].url aporta el prefix en OpenAPI 3`.

### F-004 [FATAL] Symfony YAML: las reglas `Assert` no se resuelven desde `controller::action`

- Evidencia: `packages/frameworks/scanners/symfony.scanner.ts`, el campo `controller` se lee pero no se usa; `description` se rellena con `methods` cuando es string. El provider interpreta `route.description` como nombre de función.
- Impacto: las rutas YAML normales no encuentran el método del controller y salen sin validación.
- Corrección: extraer la acción después de `::` y guardarla en `actionName` o en el campo que consuma el provider; no usar `methods` como descripción.
- Test: `routes.yaml con controller C::action resuelve #[Assert] del método`.

## Hallazgos altos

### F-005 [MAL] Express: prefijos `/api/` y `/v1/` se suprimen por heurística fija

- Evidencia: `packages/frameworks/scanners/express.scanner.ts` fuerza `prefix = ""` cuando el path empieza por `/api/` o `/v1/`.
- Impacto: `app.use("/api/v2", router)` con `router.get("/api/users")` pierde `/api/v2` y genera una URI incorrecta.
- Corrección: eliminar la supresión; concatenar los prefijos según la semántica real de Express.
- Test: `app.use('/api/v2') + path '/api/x' concatena`.

### F-006 [MAL] Next.js Pages Router: cada handler emite cinco métodos

- Evidencia: `packages/frameworks/scanners/nextjs.scanner.ts` genera GET, POST, PUT, DELETE y PATCH por defecto para un handler de `pages/api`.
- Impacto: aparecen métodos que el handler no implementa y las llamadas fallan con 405.
- Corrección: inferir las ramas `req.method`/`switch`; aplicar un fallback conservador documentado cuando no se pueda determinar.
- Test: `pages/api handler con switch de método solo emite los declarados`.

### F-007 [MAL] FastAPI: `async def` no permite resolver handler ni modelo

- Evidencia: `packages/frameworks/scanners/fastapi.scanner.ts` busca únicamente `^def` al localizar la función detrás del decorador.
- Impacto: el nombre del handler se pierde y el provider puede no localizar el modelo Pydantic del parámetro; el body cae a una inferencia genérica.
- Corrección: aceptar `async def` y `def` con una misma expresión.
- Test: `decorador async def resuelve el modelo Pydantic del parámetro`.

### F-008 [MAL] Symfony: `resource:` en `config/routes/*.yaml` se resuelve desde el directorio equivocado

- Evidencia: `packages/frameworks/scanners/symfony.scanner.ts` construye el controller con `join(absPath, "..", "..", resource)`, asumiendo siempre que el YAML está directamente en `config/`.
- Impacto: un import relativo desde `config/routes/api.yaml` puede buscar `config/src/Controller/...` y perder todas las rutas del controller sin error visible.
- Corrección: resolver primero con `dirname(absPath)` y conservar un fallback explícito al root si el proyecto usa una convención distinta.
- Test: `resource en config/routes/anidado.yaml resuelve relativo al YAML`.

### F-009 [MAL] Gin: `rawUri` deja de ser el valor declarado por el usuario

- Evidencia: `packages/frameworks/scanners/gin.scanner.ts` asigna `rawUri: fullPath`, aunque el contrato define `rawUri` como la URI sin prefijos.
- Impacto: consumers que cruzan `rawUri` con el fuente o con otro scanner no encuentran coincidencias.
- Corrección: conservar `rawUri: path`; revisar también el `return` muerto que abortaría el recorrido si llegara a activarse.
- Test: `rawUri conserva el path declarado en el fuente`.

### F-010 [MAL] Django: CBV en layout `src/` se degrada a GET

- Evidencia: la detección de URLs acepta `app`, `apps` y `src`, pero `findBaseClass()` solo busca clases bajo `app` y `apps`.
- Impacto: un `ModelViewSet` alojado en `src/<app>/views.py` se descubre con la URI correcta pero solo como GET.
- Corrección: compartir la lista de raíces de apps entre descubrimiento de URLs y resolución de clases.
- Test: `CBV en src/<app>/views.py expande métodos de su clase base`.

## Hallazgos de core y contratos

### C-001 [MAL] `outputEnvironmentPath()` produce nombres dobles cuando no recibe `projectName`

- Evidencia: `packages/core/discovery/paths.service.ts`, `outputEnvironmentPath()` usa `outputBasename()` como base cuando no recibe nombre; `outputBasename()` ya añade `.postman_collection`.
- Impacto: el nombre resultante puede ser `api.postman_collection.local.postman_environment.json` en lugar de `api.local.postman_environment.json`. Los tests actuales solo comprueban el sufijo o pasan explícitamente el nombre.
- Corrección: derivar la base sin el sufijo de colección, o hacer que el helper distinga entre nombre lógico y basename final.
- Test: `outputEnvironmentPath sin projectName no duplica postman_collection`.

### C-002 [MAL] `outputDir()` clasifica `packageRoot === parent(projectRoot)` como "inside"

- Evidencia: `packages/core/discovery/paths.service.ts`, `pkgInsideProj` considera `rel === ".."` como verdadero, aunque esa relación significa que `packageRoot` es el padre de `projectRoot`.
- Impacto: en instalaciones donde el paquete contiene el proyecto escaneado, la salida puede escribirse en `${packageRoot}/export-to-postman` en vez de en `${projectRoot}/export-to-postman`.
- Corrección: usar una comprobación de contención inequívoca: `rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))` según la regla deseada, con tests de ambos sentidos.
- Test: `outputDir distingue packageRoot dentro y fuera del projectRoot`.

### C-003 [MEJORABLE] Symfony conserva estado y variables muertas que ocultan defectos

- Evidencia: `packages/frameworks/scanners/symfony.scanner.ts`, `isSymfonyProject()` devuelve `composerJson` que ningún caller usa; `controller` se calcula y no se consume.
- Impacto: aumenta la superficie de confusión y permitió que el camino YAML de validación pareciera conectado aunque no lo estuviera.
- Corrección: devolver booleano simple o consumir explícitamente los datos; eliminar variables muertas después de corregir F-004.
- Test: no requiere test nuevo; debe quedar cubierto por lint y los tests de F-004.

## Priorización de ejecución

## Estado de correcciones

Los cinco slices funcionales de `x00008` están implementados, revisados y aprobados:

- S1: Fastify `app.route` conserva schemas; OpenAPI 3 usa `servers[0].url`. 75 tests focalizados.
- S2: Django limita `ReadOnlyModelViewSet` a GET, soporta CBV bajo `src/` y Gin conserva `rawUri`. 76 tests focalizados.
- S3: Symfony separa YAML de controller PHP, resuelve `controller::action` y resources relativos. 46 tests focalizados.
- S4: Express concatena prefijos, Next.js evita métodos fantasma y FastAPI reconoce `async def`. 89 tests focalizados.
- S5: paths de environments y contención de `outputDir` corregidos. 31 tests focalizados.

La propuesta de ejecución es `x00008`; queda pendiente únicamente la validación integradora S6 y el cierre formal de la propuesta.

1. F-001, F-002, F-003 y F-004: corregir con tests de regresión y revisión cruzada.
2. F-005 a F-010: corregir por scanner, agrupando solo cambios que no compartan archivos.
3. C-001 y C-002: corregir junto con tests de `paths.service` y ejecutar pruebas de CLI de output.
4. C-003: limpieza posterior a F-004, sin ampliar alcance.

## Delegación prevista

La propuesta debe dividirse en slices sin solapamiento:

- Slice A: Fastify + OpenAPI.
- Slice B: Django + Gin.
- Slice C: Symfony.
- Slice D: Express + Next.js + FastAPI.
- Slice E: paths.service + tests de CLI.
- Slice F: revisión integradora, typecheck, lint, tests y `validate`.

## Resoluciones integradoras

- La migración de `project-loader.service.ts` conserva un adaptador `ensureContext()` para las llamadas legacy de tests sin reintroducir el singleton de rutas. El loader pasa 42/42 tests y `typecheck:core`.
- El prefijo de servidor OpenAPI se conserva en la URL final, pero no crea una carpeta raíz por encima de los tags explícitos; `Auth` permanece como primera carpeta.
- El plugin consume las declaraciones compiladas de `@mcp-vertex/core` en lugar de arrastrar el checkout externo mediante `@mcp-vertex/source`.
- Se regeneraron `docs/API.md` y `docs/FRAMEWORKS.md`, y `.vscode/mcp.json` quedó sincronizado con `.mcp.json`.
