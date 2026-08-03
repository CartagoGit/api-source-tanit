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
| **Express** | `express`/`fastify`/`@koa/router` en `package.json` | `app.METHOD('/path')` + `router.METHOD('/path')` | (none — usa heurística agnóstica) |

Prioridad de detección: **Laravel > OpenAPI > FastAPI > Express** (cuando hay varios, gana el primero).

### Validation specs por framework

| Framework | Detecta | Mapeo |
|---|---|---|
| **Laravel** | `FormRequest` class (extends FormRequest) | `rules(): array` → `IValidationSpec` con `required`, `string`/`email`/`uuid`, `integer`/`numeric`, `boolean`, `enum (in:opt1,opt2)`, `min:N`, `max:N`, `regex:` |
| **OpenAPI** | `requestBody.schema`, `parameters` | `required`, `type`, `format`, `enum`, `minLength`, `maxLength`, `minimum`, `maximum`, `pattern` |
| **FastAPI** | Pydantic `BaseModel` | Convención de nombre: `POST /users` → `CreateUserRequest`, `PUT /users/{id}` → `UpdateUserRequest`, `GET /users` → `ListUsersRequest`. Type hints: `str`, `int`, `float`, `bool`, `list`, `dict`, `Optional`. |
| **Express** | zod/Joi inline | `z.object({...})` y `Joi.object({...})` parseados en el archivo del handler. Tipos: `string`/`number`/`boolean`/`date`/`array`/`object`/`enum`. Chaining: `email`, `url`, `uuid`, `min`, `max`, `optional`, `enum([...])`. |

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

1. **`paths.service`** descubre raíz Laravel (`artisan` + `routes/` + `app/`).
2. **`route-parser`** parsea `routes/*.php` (prefijos, controlador, acción).
3. **`endpoint-discovery`** construye `EndpointSpec[]` automáticamente y
   resuelve FormRequest tipado en la firma del controlador.
4. **`param-inferrer`** añade body/query/path params para endpoints sin FormRequest.
5. **`collection-builder`** agrupa carpetas con `topGroupFor(uri)`.
6. **`catalog-enricher`** añade variantes Mínimo/Completo/Enum/Query desde FormRequests.
7. **`environment-builder`** genera environments Postman.
8. **`attachLoginAutoToken`** inyecta script de auto-token en el Login.
9. Se escribe el JSON Postman v2.1.0 + environments.

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

**Hoy no, pero la mayoría del código es agnóstico de Laravel**:

- El parser de rutas PHP (`route-parser.service.ts`) es específico de Laravel.
- El parser de FormRequest (`form-request-parser.service.ts`) es específico de Laravel.
- El resto (descubrimiento, builder, environment, inferencia, CLI) es **agnóstico del lenguaje del backend**.

**Para hacerlo multi-lenguaje**:

1. Reescribir `route-parser` como interfaz con implementaciones por lenguaje (`LaravelRouteParser`, `SymfonyRouteParser`, `ExpressRouteParser`, `FastAPIParser`, `DjangoParser`).
2. Reescribir `form-request-parser` como `SchemaParser` agnóstico con adapters (Laravel FormRequest, Symfony Validator, Zod, JSON Schema, OpenAPI, etc.).
3. El discovery seleccionaría el adapter según el proyecto detectado.

**Es viable** (es ~300-500 líneas extra por adapter), pero **no es trivial**. Si necesitas esto en serio, abrir un issue / RFC y lo planificamos.

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