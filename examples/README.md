# Ejemplos

Un proyecto mínimo por framework soportado. No son demos: son el **gate
empírico** del repo. `bun run validate:examples` genera la colección de
cada uno y comprueba que cumple los invariantes de Postman v2.1.0, así
que si un scanner se rompe, aquí se ve.

Cada ejemplo es un proyecto de verdad de su ecosistema —con su
manifiesto, su disposición de carpetas y su forma de declarar rutas—,
recortado a lo justo para ejercitar el scanner.

## Qué detecta cada uno

Medido con `bun run scripts/generate.script.ts --project-root examples/<x> --json`:

| Carpeta | Framework | Requests | Carpetas | Login |
| --- | --- | --: | --: | :-: |
| `example-laravel` | laravel | 18 | 6 | sí |
| `example-fastify` | fastify | 11 | 3 | sí |
| `example-hono` | hono | 9 | 3 | sí |
| `example-flask` | flask | 10 | 4 | sí |
| `example-gin` | gin | 10 | 2 | sí |
| `example-fiber` | fiber | 7 | 2 | sí |
| `example-rust` | rust | 7 | 2 | sí |
| `example-rails` | rails | 13 | — | sí |
| `example-phoenix` | phoenix | 12 | — | sí |
| `example-ktor` | ktor | 7 | — | — |
| `example-express` | express | 9 | 3 | sí |
| `example-fastapi` | fastapi | 9 | 3 | sí |
| `example-aspnet` | aspnet | 8 | 1 | — |
| `example-nextjs` | nextjs | 8 | 3 | sí |
| `example-springboot` | springboot | 8 | 1 | — |
| `example-nestjs` | nestjs | 7 | 2 | — |
| `example-symfony` | symfony | 6 | 4 | sí |
| `example-django` | django | 4 | 2 | sí |
| `example-openapi-headers` | openapi | 2 | 2 | — |

`example-laravel` sale con 18/6 por el CLI y con 17/4 en
`validate:examples`: el CLI añade además las variantes de body que se
derivan de las reglas de los FormRequests, y el gate mide el pipeline
sin ese paso. Es el único framework donde hoy hay enriquecido, así que
es el único donde los dos números no coinciden.

**Login** es si el proyecto expone un endpoint de sesión que el flujo de
auth reconoce. Cuando lo hay, la colección sale con un script que guarda
el token en el environment al ejecutarlo, y el resto de requests lo usan
sin que haya que copiarlo a mano.

`example-app` no aparece en la tabla ni en el gate: no es un proyecto de
API, es el ejemplo de **configuración manual** (`config.constant.ts` +
`endpoints.constant.ts`), que enseña cómo sobrescribir a mano lo que el
escaneo detecta solo.

## Qué ejercita cada uno

Los ejemplos no son intercambiables: cada uno cubre lo que su ecosistema
hace de forma distinta.

| Carpeta | Lo específico que cubre |
| --- | --- |
| `example-laravel` | `apiResource` (expande a 5 rutas), `Route::prefix()->group()`, FormRequests tipados en la firma del controlador, y el prefijo `/api` que aplica el RouteServiceProvider sin escribirse en el fichero |
| `example-symfony` | Rutas en YAML y atributos `#[Route]` a la vez, restricciones `#[Assert\...]` |
| `example-hono` | Rutas encadenadas (`app.get(…).get(…)`), montaje con `route()`, y `@hono/zod-validator` con sus targets (`json`, `query`, `param`) |
| `example-fastify` | Las tres formas de declarar ruta (`get`, `route({method,url})`, `method: ["GET","HEAD"]`), prefijos de `register`, y el JSON Schema que Fastify lleva dentro de la propia ruta |
| `example-express` | zod y Joi en el mismo proyecto, headers declarados en el schema, varios `app.use()` en una línea |
| `example-nestjs` | Decoradores, `setGlobalPrefix`, `class-validator` |
| `example-nextjs` | App Router, segmentos dinámicos `[id]`, `route.ts` por carpeta |
| `example-fastapi` | Modelos Pydantic, `APIRouter` con prefijo, parámetros de query tipados |
| `example-flask` | Blueprints, Marshmallow |
| `example-django` | DRF, `urlpatterns` anidados y la barra final obligatoria (`APPEND_SLASH`) |
| `example-gin` | Grupos de rutas y `binding:"required"` en los structs |
| `example-rails` | `resources` expandido a sus cinco acciones de API (sin los formularios `new`/`edit`), `only:`/`except:`, recurso singular, y `namespace` anidados |
| `example-phoenix` | `scope` anidados, `resources`, y `pipe_through` que NO es una ruta |
| `example-ktor` | DSL anidado por llaves, y los `get { }` sin path que heredan el del `route()` que los envuelve |
| `example-rust` | Macros `#[get("/x")]` de Actix y Rocket, `web::scope()`, `Option<T>` como opcional, `#[serde(rename)]` y `#[validate(...)]` |
| `example-fiber` | `app.Group()` encadenable, `BodyParser` sobre un struct, y tags `validate:"…"` de go-playground/validator |
| `example-springboot` | `@RestController`, `@RequestMapping` de clase, `jakarta.validation` |
| `example-aspnet` | Controllers y minimal APIs (.NET 6+), Data Annotations |
| `example-openapi-headers` | Un spec OpenAPI como única fuente, con headers y parámetros |

## Probar uno

```sh
./bin/expostman generate --project-root examples/example-laravel
```

Escribe la colección y sus environments en `examples/example-laravel/export-to-postman/`.
Para la salida legible por máquina —la que consume el plugin— añade
`--json`.

## Añadir un ejemplo nuevo

1. Crea `examples/example-<framework>/` con la disposición **real** de
   ese framework, incluido su manifiesto (`package.json`, `go.mod`,
   `pom.xml`…). El nombre del proyecto sale de ahí.
2. Cubre al menos: un `GET` de listado, un `POST` con body validado, una
   ruta con parámetro, y un endpoint de login si el framework tiene una
   forma idiomática de hacerlo.
3. `bun run validate:examples` lo recoge solo: basta con que la carpeta
   empiece por `example-`.
4. Añádelo a las dos tablas de arriba con los números medidos, no
   estimados.
