# `@postman-exporter/cli`

Generador **agnóstico** de colecciones Postman v2.1.0 a partir de las
rutas y FormRequests de un proyecto Laravel. **Cero configuración** en
el 90% de los casos: detecta nombre, baseUrl y prefijos automáticamente.

Diseñado para funcionar como **paquete reusable** desde cualquier
proyecto Laravel sin tocar nada del código fuente del paquete.

---

## Quickstart

```bash
# 1. Desde la raíz de tu proyecto Laravel
bun add @postman-exporter/cli

# 2. Genera la colección (zero-config)
bunx postman-from-routes generate

# 3. Importar en Postman: build/<proyecto>.postman_collection.json
```

Output por defecto: `${projectRoot}/build/`. Contiene:

- `<proyecto>.postman_collection.json` — colección Postman v2.1.0
- `<proyecto>.<env>.postman_environment.json` — environments auto

---

## Uso

| Comando | Función |
| --- | --- |
| `bunx postman-from-routes generate` | Genera la colección. |
| `bunx postman-from-routes generate --envs dev,staging,prod` | Genera environments por entorno. |
| `bunx postman-from-routes generate --inspect` | Solo imprime discovery (sin escribir artefactos). |
| `bunx postman-from-routes check` | Cobertura rutas ↔ colección + schema v2.1.0. |
| `bunx postman-from-routes enrich -- --in-place` | Re-enriquece desde FormRequests. |
| `bunx postman-from-routes list` | Lista endpoints por zona. |
| `bunx postman-from-routes stats` | Estadísticas por método y carpeta. |
| `bunx postman-from-routes scan` | Smoke test del discovery sin generar artefactos. |
| `bunx postman-from-routes open` | Abre la colección en Postman (mac/win/linux/web). |
| `bunx postman-from-routes init` | Bootstrap: genera `examples/<proyecto>/config.constant.ts`. |

## Frameworks soportados (auto-detección)

El scanner detecta automáticamente el framework y adapta el parsing:

| Framework | Detección | Formato de rutas | Validation source |
|---|---|---|---|
| **Laravel** | `artisan` + `routes/` + `app/` | `Route::get('/path', [Controller::class, 'method'])` | `FormRequest` (class `X extends FormRequest`) |
| **OpenAPI 3.x** | `openapi.json/yaml/yml` o `swagger.*` | `paths: /pets: get:` | `parameters` + `requestBody` schema |
| **FastAPI** | `fastapi` en `pyproject.toml` o `requirements.txt` | `@app.get('/path')` + `@router.<METHOD>` | Pydantic `BaseModel` |
| **Symfony** | `composer.json` con `symfony/framework-bundle` o `symfony/routing` | `config/routes.yaml` + `config/routes/*.yaml` + `#[Route(...)]` en `src/Controller/` | `#[Assert\NotBlank]`, `#[Assert\Email]`, `#[Assert\Length]`, `#[Assert\Choice]`, `#[Assert\Range]`, `#[Assert\Positive]`, etc. |
| **NestJS** | `package.json` con `@nestjs/core` | `@Controller('users')` + `@Get()`, `@Post()`, …, `@Get(':id')` | `class-validator` (`@IsString`, `@IsEmail`, `@IsInt`, `@MinLength`, `@MaxLength`, `@IsEnum`, …) |
| **Django** | `manage.py` + `django`/`djangorestframework` en `requirements.txt` o `pyproject.toml` | `path('users/', view_func)` + `include(...)` | DRF Serializers (`serializers.CharField`, `EmailField`, `IntegerField`, `ChoiceField`, …) |
| **Flask** | `flask` en `requirements.txt` | `@app.route('/path', methods=['GET', 'POST'])` + Blueprints | (no integrado; bodies por `applyAgnosticInference`) |
| **Next.js** | `package.json` con `next` | App Router: `app/<segment>/route.ts` con `export async function GET(request)`; Pages Router: `pages/api/<file>.ts` | (no integrado; bodies por inferencia) |
| **Gin** | `go.mod` con `github.com/gin-gonic/gin` | `router.GET('/path', handler)` + `router.Group('/api/v1')` | (no integrado; bodies por inferencia) |
| **Spring Boot** | `pom.xml`/`build.gradle` con `spring-boot-starter-web` | `@RequestMapping('/api/v1')` + `@GetMapping`, `@PostMapping`, … | (no integrado; bodies por inferencia) |
| **ASP.NET** | `*.csproj` con `Microsoft.AspNetCore.App` | `[Route('api/v1')]` + `[HttpGet]`, `[HttpPost]`, … | (no integrado; bodies por inferencia) |
| **Express** | `express`/`fastify`/`@koa/router` en `package.json` | `app.METHOD('/path')` + `router.METHOD('/path')` | zod (`z.object({...})`) y Joi (`Joi.object({...})`) inline |

Prioridad de detección: **Laravel > OpenAPI > FastAPI > Symfony > NestJS > Django > Spring Boot > ASP.NET > Flask > Next.js > Gin > Express** (cuando hay varios, gana el primero).

### Validation specs por framework

| Framework | Detecta | Mapeo |
|---|---|---|
| **Laravel** | `FormRequest` class (extends FormRequest) | `rules(): array` → `IValidationSpec` con `required`, `string`/`email`/`uuid`, `integer`/`numeric`, `boolean`, `enum (in:opt1,opt2)`, `min:N`, `max:N`, `regex:` |
| **OpenAPI** | `requestBody.schema`, `parameters` | `required`, `type`, `format`, `enum`, `minLength`, `maxLength`, `minimum`, `maximum`, `pattern` — **incluye headers** (`in: header` → `ep.headers[]`) |
| **FastAPI** | Pydantic `BaseModel` | Convención de nombre: `POST /users` → `CreateUserRequest`, `PUT /users/{id}` → `UpdateUserRequest`, `GET /users` → `ListUsersRequest`. Type hints: `str`, `int`, `float`, `bool`, `list`, `dict`, `Optional`. |
| **Symfony** | `#[Assert\Xxx]` en parámetros del controller method | `NotBlank`/`NotNull` → `string`, `Email` → `email`, `Uuid` → `uuid`, `Url`/`Uri` → `url`, `Choice` → `enum`, `Range`/`GreaterThan`/`Positive` → `integer`, `Date`/`DateTime` → `date`/`datetime` |
| **Express** | zod/Joi inline | `z.object({...})` y `Joi.object({...})` parseados en el archivo del handler. Tipos: `string`/`number`/`boolean`/`date`/`array`/`object`/`enum`. Chaining: `email`, `url`, `uuid`, `min`, `max`, `optional`, `enum([...])`. **Headers**: `headers: z.object({...})` o `headers: Joi.object({...})` en el archivo del handler. |

### Custom headers

El exporter reconoce **custom headers** declarados en el código fuente y los emite como `request.header[]` en la colección Postman. Los headers `Accept` y `Authorization` se añaden automáticamente; los custom se suman sin colisionar.

| Framework | Cómo declarar headers |
|---|---|
| **OpenAPI** | `parameters: [{name: "X-API-Key", in: "header", required: true, schema: {type: "string"}}]` |
| **Express (zod)** | `headers: z.object({ "X-API-Key": z.string().min(32) })` en el mismo archivo del handler |
| **Express (Joi)** | `headers: Joi.object({ "X-API-Key": Joi.string().min(32) })` |
| **Symfony** | Próximamente: `#[Assert\NotBlank] string $XApiKey` en un `Request` object (no implementado todavía) |

Placeholders útiles para headers comunes:
- `Authorization`, `X-Session-Token` → `{{token}}`
- `X-API-Key`, `X-Client-Key` → `your-api-key-here`
- `User-Agent`, `X-Request-Id` → `demo-123`

### Flags CLI

| Flag | Descripción |
| --- | --- |
| `--project-root <path>` | Raíz del proyecto Laravel. |
| `--config <path>` | Ruta a tu `ProjectConfig`. |
| `--basename <name>` | Nombre base del JSON. |
| `--output <path>` | Ruta absoluta del JSON. |
| `--output-dir <path>` | Directorio de salida (sobrescribe el inferido). |
| `--envs dev,staging,prod` | Genera environments auto con baseUrl distinta. |
| `--open` | Abre la colección en Postman al terminar. |
| `--in-place` | (enrich) reemplaza el JSON principal. |

### Variables de entorno

| Variable | Equivale a |
| --- | --- |
| `POSTMAN_PROJECT_ROOT` | `--project-root <path>` |
| `POSTMAN_CONFIG` | `--config <path>` |
| `POSTMAN_OUTPUT_BASENAME` | `--basename <name>` |
| `POSTMAN_OUTPUT_DIR` | `--output-dir <path>` |
| `POSTMAN_OUTPUT` | `--output <path>` (ruta completa) |

---

## Qué detecta automáticamente (zero-config)

Si no hay `examples/<proyecto>/config.constant.ts` en tu proyecto, el
paquete genera un `ProjectConfig` mínimo viable en memoria:

| Campo | Fuente |
| --- | --- |
| `name` | `composer.json` → `vendor/<name>` (último segmento) |
| `baseUrl` | `.env` → `APP_URL` + `/api` |
| `filePrefixes` | `RouteServiceProvider::mapXxxRoutes()` |
| `environments` | Local / Dev / Staging / Producción por defecto |
| `loginEndpointName` | "Login" (heurística) |
| `tokenResponsePath` | Regex sobre `app/Http/Controllers/*Auth*Controller.php` |

---

## Personalizar el config (opcional)

```bash
bunx postman-from-routes init --output ./examples/mi-api
```

Edita `examples/mi-api/config.constant.ts`. Ver `examples/example-app/`
para una plantilla comentada con todos los campos disponibles.

Campos más útiles:

- `tokenResponsePath`: dot-path del token en la respuesta (`"access_token"` para JWT, `"data.access_token"` para Sanctum).
- `loginEndpointHints`: lista de strings a buscar en el nombre del item Login.
- `environments`: array de environments a generar.
- `zones`: pares `[prefijo_uri, nombre_zona]` para agrupación lógica.

---

## Cómo funciona internamente

```
contract/   → tipos + ProjectConfig + constantes universales
service/    → discovery, parser rutas, FormRequests, builder, enricher, paths
helper/     → uri / zone / walk-count
examples/   → SOLO el proyecto host (NO se publica en npm; aquí va el ejemplo)
scripts/    → CLI y entrypoints
```

### Flujo de generación

1. **`DiscoveryOrchestrator`** ejecuta todos los `IProjectScanner` y elige el de mayor score.
2. **`IRouteScanner`** específico del framework (12 implementaciones: Laravel, OpenAPI, FastAPI, Symfony, NestJS, Django, Flask, Next.js, Gin, Spring Boot, ASP.NET, Express) parsea las rutas en `ParsedRoute[]`.
3. **`IValidationSpecProvider`** específico del framework extrae constraints (FormRequest, OpenAPI schema, Pydantic, `#[Assert]`, class-validator, zod/Joi, DRF Serializers) en `IValidationSpec[]` con `location: body|query|path|header|cookie`.
4. **`parsed-route-to-spec.adapter`** unifica `ParsedRoute + IValidationSpec → EndpointSpec` agnóstico.
5. **`applyAgnosticInference`** añade body/query/path params para endpoints sin validation provider.
6. **`collection-builder`** agrupa carpetas con `topGroupFor(uri)` y emite headers custom + body.
7. **`catalog-enricher`** añade variantes Mínimo/Completo/Enum/Query desde FormRequests (Laravel).
8. **`environment-builder`** genera environments Postman.
9. **`attachLoginAutoToken`** inyecta script de auto-token en el Login.
10. Se escribe el JSON Postman v2.1.0 + environments.

---

## Convención de nombres

| Tipo | Sufijo | Carpeta |
| --- | --- | --- |
| Interfaces | `.interface.ts` | `contract/` |
| Constantes | `.constant.ts` | `contract/`, `examples/` |
| Servicios | `.service.ts` | `service/` |
| Helpers | `.helper.ts` | `helper/` |
| Scripts | `.script.ts` | `scripts/` |

---

## ¿Funciona con otros lenguajes (no Laravel)?

**Sí**, desde la v3 de este exporter. El core es completamente framework-agnostic
y los scanners/validators son plugins por tecnología. **12 frameworks** soportados
hoy: **Laravel**, **OpenAPI 3.x**, **FastAPI**, **Symfony**, **NestJS**, **Django**,
**Flask**, **Next.js**, **Gin**, **Spring Boot**, **ASP.NET**, **Express** (zod/Joi).

Cada scanner vive en `service/scanners/<framework>.scanner.ts` con tres clases:
`IProjectScanner`, `IRouteScanner`, `IValidationSpecProvider`. Para añadir un nuevo
lenguaje, cópialos y regístralos en `scripts/generate.script.ts`. Ver
`nestjs.scanner.ts` o `symfony.scanner.ts` para plantillas completas.

### Frameworks con validation provider limitado

Los siguientes frameworks parsean rutas pero **no tienen validation provider
funcional** todavía (los bodies se generan por inferencia agnóstica en
`applyAgnosticInference`):

- **Flask**: blueprints y `@app.route()` parseados; bodies inferidos.
- **Next.js**: App Router y Pages Router parseados; bodies inferidos.
- **Gin**: routes y Groups parseados; bodies inferidos.
- **Spring Boot**: `@RequestMapping` + `@GetMapping` parseados; bodies inferidos.
- **ASP.NET**: `[Route]` + `[HttpGet]` parseados; bodies inferidos.

---

## Importar en Postman

1. Postman → **Import** → selecciona `build/<proyecto>.postman_collection.json`.
2. Selecciona también los environments: `build/<proyecto>.dev.postman_environment.json`, etc.
3. En el dropdown de environments de Postman, elige el activo (Dev/Staging/...).
4. Ejecuta **Login** dentro de `Auth` (el script de test guarda `{{token}}`).
5. Las demás requests usarán el token automáticamente.

---

## Instalación local para desarrollo

```bash
# clonar este repo
git clone <repo>
cd postman-exporter

# ejecutar contra un proyecto Laravel local
bun run scripts/cli.script.ts generate --project-root /path/to/laravel

# o contra el proyecto donde vive este repo (modo in-repo)
bun run build
```

---

## Publicar como npm

```bash
bun pm pack --dry-run  # ver qué se incluiría (sin examples/, sin build/)
bun pm pack             # genera postman-from-routes.tgz
bun publish             # publica en npm
```

---

## Licencia

MIT