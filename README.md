# `@postman-exporter/cli`

Generador **agnóstico** de colecciones Postman v2.1.0 a partir de las rutas de
cualquier proyecto backend. **Cero configuración** en el 90% de los casos: detecta
automáticamente el framework, las rutas y los schemas de validación.

## Flujo universal

1. Sitúate en la raíz del proyecto backend o pasa `--project-root /ruta/absoluta`.
2. Genera la colección con `bun x --yes @postman-exporter/cli generate`.
3. Si quieres comprobar qué va a salir sin escribir archivos, añade `--inspect`.
4. Si quieres cambiar el nombre o la ruta del JSON, usa `--basename <nombre>` o `--output <ruta>`.
5. Si el proyecto expone variables de entorno o varios entornos, añade `--envs local,dev,staging,prod`.

Ejemplo universal desde cualquier carpeta:

```bash
bun x --yes @postman-exporter/cli generate \
    --project-root /ruta/a/tu-proyecto \
    --basename mi-api \
    --envs local,dev,staging,prod
```

Salida esperada:

- `build/mi-api.postman_collection.json`
- `build/mi-api.local.postman_environment.json`
- `build/mi-api.dev.postman_environment.json`
- `build/mi-api.staging.postman_environment.json`
- `build/mi-api.prod.postman_environment.json`

Para validar sin escribir nada en disco:

```bash
bun x --yes @postman-exporter/cli generate --project-root /ruta/a/tu-proyecto --inspect
```

---

## Inicio rápido por framework

> **Pre-requisito**: [Bun](https://bun.sh) >= 1.0 instalado globalmente.
> `curl -fsSL https://bun.sh/install | bash`

### Laravel

```bash
# Desde la raíz del proyecto Laravel (donde está artisan)
cd mi-proyecto-laravel

bun x --yes @postman-exporter/cli generate

# Salida: build/mi-proyecto.postman_collection.json
# Importar en Postman → Import → Upload Files → selecciona el .json
```

Con environments (Local / Dev / Staging / Prod):

```bash
bun x --yes @postman-exporter/cli generate --envs local,dev,staging,prod
# Salida extra: build/mi-proyecto.local.postman_environment.json, etc.
```

### Symfony

```bash
cd mi-proyecto-symfony   # donde está composer.json con symfony/framework-bundle

bun x --yes @postman-exporter/cli generate --project-root .

# Salida: build/mi-proyecto-symfony.postman_collection.json
```

### FastAPI (Python)

```bash
cd mi-proyecto-fastapi   # donde está main.py con @app.get("/...")

bun x --yes @postman-exporter/cli generate --project-root .

# Salida: build/mi-proyecto-fastapi.postman_collection.json
```

### Django / Django REST Framework

```bash
cd mi-proyecto-django    # donde está manage.py

bun x --yes @postman-exporter/cli generate --project-root .

# Salida: build/mi-proyecto-django.postman_collection.json
```

### NestJS

```bash
cd mi-proyecto-nestjs    # donde está package.json con @nestjs/core

bun x --yes @postman-exporter/cli generate --project-root .

# Salida: build/mi-proyecto-nestjs.postman_collection.json
```

### Express (con zod o Joi)

```bash
cd mi-proyecto-express   # donde está package.json con express

bun x --yes @postman-exporter/cli generate --project-root .

# Salida: build/mi-proyecto-express.postman_collection.json
```

### Next.js (App Router)

```bash
cd mi-proyecto-nextjs    # donde está package.json con next

bun x --yes @postman-exporter/cli generate --project-root .

# Salida: build/mi-proyecto-nextjs.postman_collection.json
```

### Flask (Python)

```bash
cd mi-proyecto-flask     # donde está requirements.txt con flask

bun x --yes @postman-exporter/cli generate --project-root .
```

### Gin (Go)

```bash
cd mi-proyecto-gin       # donde está go.mod con github.com/gin-gonic/gin

bun x --yes @postman-exporter/cli generate --project-root .
```

### Spring Boot (Java/Kotlin)

```bash
cd mi-proyecto-spring    # donde está pom.xml o build.gradle con spring-boot-starter-web

bun x --yes @postman-exporter/cli generate --project-root .
```

### ASP.NET Core (C#)

```bash
cd mi-proyecto-aspnet    # donde está el .csproj con Microsoft.AspNetCore.App

bun x --yes @postman-exporter/cli generate --project-root .
```

### OpenAPI / Swagger

```bash
# Si tienes un openapi.json, openapi.yaml o swagger.json en la raíz:
bun x --yes @postman-exporter/cli generate --project-root .

# O indicando el archivo explícitamente:
bun x --yes @postman-exporter/cli generate --project-root . \
    --basename mi-api
```

---

## Cómo importar en Postman

1. Abre Postman.
2. Haz clic en **Import** en la esquina superior izquierda.
3. Elige **Upload Files**.
4. Selecciona primero `build/<nombre>.postman_collection.json`.
5. Si generaste environments, vuelve a pulsar **Import** y sube también cada archivo `build/<nombre>.<env>.postman_environment.json`.
6. En el selector de **Environment** de la esquina superior derecha, elige el entorno que quieras usar.
7. Ejecuta el request de login o auth correspondiente para que `{{token}}` quede relleno si el proyecto lo devuelve.
8. Si prefieres no usar la interfaz web, ejecuta `bun x --yes @postman-exporter/cli open` y el sistema abrirá el JSON generado en la app instalada o en `https://app.postman.com/import`.

---

## Alternativa: abrir directamente en Postman desde el terminal

```bash
bun x --yes @postman-exporter/cli open
# Equivale a hacer doble-click en el .json desde el explorador de archivos
```

---

## Usar la ruta del proyecto en vez del directorio de trabajo

Si no estás en la raíz del proyecto:

```bash
bun x --yes @postman-exporter/cli generate \
    --project-root /ruta/absoluta/a/mi-proyecto \
    --output /tmp/mi-api.postman_collection.json
```

Con variable de entorno:

```bash
POSTMAN_PROJECT_ROOT=/ruta/a/mi-proyecto \
    bun x --yes @postman-exporter/cli generate
```

---

## Verificar qué detecta el scanner (sin generar archivos)

```bash
# Imprime framework, nº de rutas y schemas detectados; no escribe nada en disco.
bun x --yes @postman-exporter/cli generate --project-root . --inspect

# O usa el script de diagnóstico rápido:
bun x --yes @postman-exporter/cli scan --project-root .
```

---

## Uso como dependencia (no global)

```bash
# Instalar una vez en el proyecto
bun add --dev @postman-exporter/cli

# Añadir script en package.json
# "scripts": { "postman": "postman-from-routes generate" }

bun run postman
```

---



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