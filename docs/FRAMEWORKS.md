# Guía por framework

Qué busca el scanner de cada framework, qué sintaxis entiende, de dónde
saca los bodies y qué **no** cubre.

Las cifras de la tabla salen de ejecutar cada scanner contra su fixture
de `tests/fixtures/<framework>-comprehensive/`, que es un proyecto de
juguete pero realista. "Con validación" son los endpoints para los que se
resolvieron reglas de campos reales; el resto recibe un body inferido
heurísticamente.

<!-- generado:tabla-frameworks -->

| Framework | Rutas del fixture | Con validación |
|---|---:|---:|
| [OpenAPI](#openapi--swagger) | 23 | 22 |
| [FastAPI](#fastapi) | 19 | 14 |
| [Django](#django--drf) | 18 | 16 |
| [ASP.NET Core](#aspnet-core) | 17 | 7 |
| [Laravel](#laravel) | 17 | 6 |
| [Express](#express--koa--hapi) | 14 | 13 |
| [Flask](#flask) | 14 | 7 |
| [Gin](#gin) | 14 | 8 |
| [Next.js](#nextjs) | 14 | 11 |
| [Symfony](#symfony) | 14 | 7 |
| [NestJS](#nestjs) | 13 | 10 |
| [Rails](#rails) | 13 | 0 |
| [Phoenix](#phoenix) | 12 | 0 |
| [Spring Boot](#spring-boot) | 11 | 11 |
| [Fastify](#fastify) | 9 | 3 |
| [Hono](#hono) | 9 | 3 |
| [Fiber](#fiber) | 7 | 2 |
| [Ktor](#ktor) | 7 | 0 |
| [Rust](#rust-actix-web--rocket) | 7 | 2 |
| [tRPC](#trpc) | 6 | 0 |
| [GraphQL](#graphql) | 5 | 0 |

_Generado por `bun run docs:frameworks` ejecutando cada scanner contra_
_su fixture. 21 frameworks._

<!-- /generado:tabla-frameworks -->

Cuando dos scanners reconocen el proyecto gana el de mayor confianza. Un
proyecto con `openapi.yaml` **y** código Express usará el spec, que es
más fiable.

> **Regla general para todos**: el análisis es **estático**. No se
> ejecuta tu código ni se levanta el servidor. Las rutas construidas
> dinámicamente —en un bucle, con el path en una variable, o registradas
> por un plugin en tiempo de arranque— no se detectan. Para esas, se
> declaran a mano en un `endpoints.constant.ts` que se fusiona con lo
> autodetectado.

---

## OpenAPI / Swagger

**El de mayor cobertura.** Si tu proyecto publica un spec, úsalo aunque
tu framework esté soportado: la información viene del propio contrato en
lugar de deducirse.

**Detecta por**: `openapi.yaml`, `openapi.yml`, `openapi.json`,
`swagger.*`, también bajo `public/`, `resources/`, `api/`, `docs/` o
`src/`.

**Entiende**: OpenAPI 3.x y Swagger 2.0. Paths, operaciones, `parameters`
(path, query, header), `requestBody`, `$ref` a `components/schemas`,
`tags` (que se convierten en carpetas), `summary` y `description`.

**Bodies**: del `schema` del `requestBody`, con `type`, `format`, `enum`,
`minLength`/`maxLength`, `minimum`/`maximum`, `pattern` y `example`.

**Limitaciones**: no resuelve `$ref` a ficheros externos. `allOf`/`oneOf`
se aplanan de forma parcial.

Ejemplo: [`examples/example-openapi-headers/`](../examples/example-openapi-headers/)

---

## Laravel

**Detecta por**: `artisan` + `composer.json`. Si además hay
`app/Providers/RouteServiceProvider.php`, lee de ahí los prefijos por
fichero de rutas.

**Entiende**:
- `Route::get|post|put|patch|delete('/path', …)`
- `Route::apiResource('users', UserController::class)` → 5 rutas
- `Route::resource(...)` → 7 rutas
- `Route::prefix('admin')->group(...)` anidados
- `->where('id', '[0-9]+')` como restricción del parámetro
- Resolución del controlador vía los `use` del fichero

**Prefijo `/api`**: `routes/api.php` lo recibe del RouteServiceProvider,
igual que en tu aplicación real. Las URIs de la colección salen con él
aunque tu código no lo escriba. `routes/web.php`, `console.php` y
`channels.php` se ignoran.

**Bodies**: de los FormRequest. Se localiza el FormRequest del par
controlador+acción por convención de nombre
(`StoreUserRequest`, `CreateUserRequest`, `UpdateUserRequest`…) y se
parsea su `rules()`. Se traducen `required`, `string`, `integer`,
`email`, `in:a,b,c`, `max:`, `min:`, `regex:`, `date`, `boolean`, `file`.

**Limitaciones**: reglas dinámicas (`Rule::when(...)`, condicionales
sobre `$this->user()`) se ignoran y se reportan aparte. Las reglas
anidadas (`items.*.id`) no se expanden.

Ejemplo: [`tests/fixtures/laravel-comprehensive/`](../tests/fixtures/laravel-comprehensive/)

---

## Symfony

**Detecta por**: `composer.json` con `symfony/framework-bundle` o
`symfony/routing`; también `bin/console`.

**Entiende**:
- YAML: `config/routes.yaml` y `config/routes/*.yaml`, con `path`,
  `controller`, `methods`, `prefix` y `resource:`
- Atributos PHP: `#[Route('/users', methods: ['GET'])]` en
  `src/Controller/`, incluido el `#[Route]` de clase como prefijo

**Deduplicación**: un endpoint declarado a la vez en YAML y con
`#[Route]` es **el mismo** endpoint, y Symfony lo registra una vez. Sale
una sola request, quedándose con la versión que trae más información (la
del atributo, que permite leer los `#[Assert]`).

**Bodies**: de los `#[Assert\…]` sobre los parámetros del método —
`NotBlank`, `Email`, `Length`, `Choice`, `Range`, `Type`, `Regex`.

**Limitaciones**: no lee anotaciones en docblock (Symfony 4.x). Los YAML
anidados a más de un nivel bajo `config/routes/` no se recorren.

Ejemplo: [`examples/example-symfony/`](../examples/example-symfony/)

---

## Express / Koa / Hapi

**Detecta por**: `package.json` con `express`, `@koa/router`,
`@hapi/hapi` o `koa`.

**Fastify ya no está aquí**: tiene su propio scanner, que lee el JSON
Schema que Fastify declara dentro de cada ruta. Mientras compartían
scanner, un proyecto Fastify casaba con los dos y se mezclaban dos
lecturas — una buena y otra a medias.

**Entiende**:
- `app.get('/users', handler)` y `router.post(...)`
- `express.Router()` y `Router({ prefix: '/api' })`
- `app.use('/api', usersRouter)` como prefijo de montaje
- Hapi: `server.route({ method, path, handler })`

**Busca en**: `src/`, `lib/`, `app/`, `routes/` y la raíz. Se saltan
`node_modules/`, `dist/`, `build/`, los `.d.ts` y los ficheros `.test.` /
`.spec.`.

**Bodies**: de **zod** (`z.object({...})`) y **Joi**
(`Joi.object({...})`). Se elige el schema del handler en tres pasos: el
referenciado por nombre (`createUserSchema.parse(req.body)`), si no el
declarado justo antes que no parezca de headers, si no el más cercano.
Un `headers: z.object({...})` produce campos con `location: header`.

**Limitaciones**: los endpoints comentados se descartan correctamente,
pero las rutas registradas dentro de una función que se llama en
runtime no se ven.

Ejemplo: [`examples/example-express/`](../examples/example-express/)

---

## NestJS

**Detecta por**: `package.json` con `@nestjs/core`; también
`nest-cli.json`.

**Entiende**: `@Controller('users')` como prefijo, y `@Get()`,
`@Post(':id')`, `@Put`, `@Patch`, `@Delete` en los métodos.

**Bodies**: de los DTO con `class-validator` — `@IsString`, `@IsEmail`,
`@IsInt`, `@IsBoolean`, `@IsOptional`, `@IsEnum`, `@MinLength`,
`@MaxLength`. El DTO se localiza siguiendo los `import` relativos del
controlador.

**Limitaciones**: no resuelve DTO importados por alias de path
(`@app/dto`). Los módulos con `RouterModule.register()` no aportan sus
prefijos.

Ejemplo: [`examples/example-nestjs/`](../examples/example-nestjs/)

---

## Next.js

**Detecta por**: `package.json` con `next`.

**Entiende**:
- **App Router**: `app/**/route.ts` con `export async function GET/POST/…`
- **Pages Router**: `pages/api/**/*.ts` con
  `export default function handler(req, res)`
- Segmentos dinámicos: el directorio `[id]` se convierte en `{{id}}`
- También bajo `src/app/` y `src/pages/api/`

**Bodies**: de zod inline en el route handler. En un `route.ts` con
varios métodos se elige el `z.object()` más cercano al handler de ese
método concreto.

**Limitaciones**: en Pages Router no se puede saber qué verbos acepta un
handler (todo pasa por el mismo `handler(req, res)`), así que se emiten
GET, POST, PUT, PATCH y DELETE. Sobran los que tu API no soporte. Route
groups `(grupo)` y rutas catch-all `[...slug]` no se tratan de forma
especial.

Ejemplo: [`examples/example-nextjs/`](../examples/example-nextjs/)

---

## FastAPI

**Detecta por**: `requirements.txt` o `pyproject.toml` con `fastapi`.

**Entiende**: `@app.get('/users')`, `@router.post(...)` con todos los
verbos, y el `prefix` de `APIRouter(prefix='/api/v1')`.

**Bodies**: de los modelos Pydantic usados como parámetro, con tipos,
`Optional`, valores por defecto y `Field(...)`.

**Nota**: si tu proyecto también publica un `openapi.json` estático, ese
scanner gana y da mejor resultado.

**Limitaciones**: no se resuelven modelos importados desde otro paquete
instalado. `Depends()` no se interpreta.

Ejemplo: [`examples/example-fastapi/`](../examples/example-fastapi/)

---

## Flask

**Detecta por**: `requirements.txt` o `pyproject.toml` con `flask`.

**Entiende**:
- `@app.route('/users', methods=['GET', 'POST'])`
- Blueprints: `@bp.route(...)` con su `url_prefix`
- `app.add_url_rule(...)`

**Bodies**: de **Marshmallow** (`fields.Str(required=True)`,
`validate.OneOf([...])`, `validate.Length(min, max)`, `fields.Email`) y de
**Pydantic** vía `flask-pydantic`. Un proyecto puede tener las dos
librerías conviviendo.

El schema se asocia al endpoint en dos pasos: primero el que el handler
nombra explícitamente (`UserSchema().load(request.json)`), y si no, el
que casa por convención con el recurso de la ruta (`/api/users` →
`UserSchema`).

**Limitaciones**: no se resuelven schemas importados desde otro paquete
instalado. `fields.Nested(OtraSchema)` se mapea a `object` sin expandir
sus campos.

Ejemplo: [`examples/example-flask/`](../examples/example-flask/)

---

## Django / DRF

**Detecta por**: `manage.py`; también `requirements.txt` o
`pyproject.toml` con `django` o `djangorestframework`.

**Entiende**:
- `urls.py` con `path(...)`, `re_path(...)` e `include(...)` recursivo
- Conversores de path: `<int:id>`, `<str:slug>`, `<uuid:token>` → `{{id}}`
- DRF: `ListAPIView`, `RetrieveAPIView`, `ModelViewSet`…
- Vistas funcionales con `@api_view(['GET', 'POST'])`

**Bodies**: de los serializers — `serializers.Serializer` y
`ModelSerializer` con `class Meta: model / fields`.

**Limitaciones**: los `ModelSerializer` con `fields = '__all__'` no se
pueden expandir (haría falta leer el modelo). Los routers de DRF
(`DefaultRouter().register(...)`) se expanden de forma parcial.

Ejemplo: [`examples/example-django/`](../examples/example-django/)

---

## Gin

**Detecta por**: `go.mod` con `github.com/gin-gonic/gin`.

**Entiende**: `r.GET("/users", handler)` con cualquier nombre de
variable, `r.Group("/api/v1")` anidado, y handlers con middleware
(`r.GET("/x", auth, handler)`).

**Bodies**: de los tags `binding:"required"` de los structs Go que
aparecen en el handler.

**Limitaciones**: los structs definidos en otro paquete no se resuelven.
El parseo de structs es parcial.

Ejemplo: [`examples/example-gin/`](../examples/example-gin/)

---

## Spring Boot

**Detecta por**: `pom.xml` con `spring-boot-starter-web`, o
`build.gradle` con `org.springframework.boot`.

**Entiende**: `@RequestMapping("/api/v1")` y `@RestController` en la
clase como prefijo; `@GetMapping`, `@PostMapping`, `@PutMapping`,
`@PatchMapping`, `@DeleteMapping` en los métodos; `@PathVariable`,
`@RequestParam` y `@RequestBody`.

**Bodies**: de las anotaciones `jakarta.validation.constraints` de los
DTO — `@NotNull`, `@NotBlank`, `@Email`, `@Size`, `@Min`, `@Max`,
`@Pattern`.

**Limitaciones**: solo DTO del paquete local. Kotlin funciona en lo
básico pero está menos probado.

Ejemplo: [`examples/example-springboot/`](../examples/example-springboot/)

---

## ASP.NET Core

**Detecta por**: `*.csproj` con `Microsoft.AspNetCore.App`.

**Entiende** las dos formas de declarar rutas en .NET, y pueden convivir
en el mismo proyecto:

- **Controladores**: `[Route("api/v1")]` en la clase, `[HttpGet("users")]`,
  `[HttpPost]`, `[HttpPut]`, `[HttpPatch]`, `[HttpDelete]` en los
  métodos, y `[ApiController]` como heurística.
- **Minimal APIs** (.NET 6+, lo que genera `dotnet new webapi`):
  `app.MapGet("/users", …)`, `MapPost`, `MapPut`, `MapPatch`,
  `MapDelete`, incluido el prefijo de `app.MapGroup("/api/products")`.

**Bodies**: de las Data Annotations — `[Required]`, `[EmailAddress]`,
`[StringLength]`, `[Range]`, `[RegularExpression]`. El DTO se resuelve
**por endpoint**, no por fichero: `[FromBody] X body` en controladores, y
el parámetro tipado del lambda en minimal APIs.

**Limitaciones**: solo DTO del proyecto local; los importados de un
paquete NuGet no se resuelven.

Ejemplo: [`examples/example-aspnet/`](../examples/example-aspnet/)

---

## Fastify

**Detecta por**: `package.json` con `fastify`.

**Entiende**: las tres formas de declarar una ruta —`fastify.get(…)`,
`fastify.route({ method, url })` y `method: ["GET", "HEAD"]`— y los
prefijos de `fastify.register(plugin, { prefix: "/api" })`.

**Bodies**: del **JSON Schema que Fastify lleva dentro de la propia
ruta** (`schema: { body: { … } }`). Es información de tipos exacta, no
inferida: tipos, `required`, `enum`, `minimum`/`maximum` y formatos salen
tal cual del contrato.

**Cuidado que costó un bug**: el schema se busca **dentro de los
paréntesis de su propia llamada**. Sin acotarlo, una ruta sin schema
heredaba el de la siguiente y salía con campos que no son suyos.

Ejemplo: [`examples/example-fastify/`](../examples/example-fastify/)

---

## Fiber

**Detecta por**: `go.mod` con `github.com/gofiber/fiber`.

**Entiende**: `app.Get("/users", handler)`, los `app.Group("/api")`
encadenables, y los grupos anidados.

**Bodies**: de los structs que pasan por `BodyParser`, leyendo los tags
`validate:"…"` de go-playground/validator y los `json:"…"` para la clave.

**Cuidado que costó un bug**: el helper que buscaba el struct reutilizaba
el regex del bucle exterior y le movía el `lastIndex` hacia atrás. El
bucle volvía a encontrar la misma ruta, para siempre — bucle infinito y
el sistema operativo matando el proceso. De ahí salió `lint:regex-state`.

Ejemplo: [`examples/example-fiber/`](../examples/example-fiber/)

---

## Hono

**Detecta por**: `package.json` con `hono`.

**Entiende**: rutas encadenadas (`app.get(…).post(…)`), montaje de
sub-aplicaciones con `app.route("/prefijo", sub)`, y `app.on(["GET",
"POST"], …)`.

**Bodies**: de `@hono/zod-validator`, respetando su *target* — `json` va
al body, `query` a los parámetros y `param` a la ruta.

**Limitaciones**: un schema declarado en otro fichero no se resuelve.

Ejemplo: [`examples/example-hono/`](../examples/example-hono/)

---

## Rust (Actix-web / Rocket)

**Detecta por**: `Cargo.toml` con `actix-web` o `rocket`.

**Entiende**: los macros de atributo de los dos —`#[get("/users")]`,
`#[post("/users")]`— y `web::scope("/api")` de Actix. Los dos comparten
scanner porque declaran las rutas igual; separarlos sería duplicar el
mismo parser para cambiar dos líneas de detección.

**Bodies**: de los structs con `#[derive(Deserialize)]`. Un `Option<T>`
es un campo opcional, `#[serde(rename = "…")]` cambia la clave, y
`#[validate(…)]` del crate `validator` aporta las restricciones.

**Limitaciones**: los parámetros de Rocket usan `<id>` y se traducen;
los tipos genéricos anidados no se resuelven.

Ejemplo: [`examples/example-rust/`](../examples/example-rust/)

---

## Rails

**Detecta por**: `Gemfile` con `rails`, o `config/routes.rb`.

**Entiende**: `resources :users` expandido a sus **cinco acciones de
API** —`index`, `create`, `show`, `update`, `destroy`—, `only:` y
`except:`, `resource` singular (sin `index`), y `namespace` anidados.

Los `new` y `edit` que genera `resources` **no** se emiten: devuelven
formularios HTML y en una API JSON contestarían un 404 o un HTML que
nadie espera.

**Bodies**: no se infieren. Rails valida en el modelo, no en la ruta.

Ejemplo: [`examples/example-rails/`](../examples/example-rails/)

---

## Phoenix

**Detecta por**: `mix.exs` con `:phoenix`.

**Entiende**: `scope "/api" do … end` anidados, `resources`, y los verbos
sueltos (`get "/users", UserController, :index`).

**Ojo**: `pipe_through :api` **no** es una ruta, aunque esté en el mismo
bloque y se parezca. Confundirlo metía una request por cada pipeline.

**Bodies**: no se infieren. Phoenix valida en los changesets del
contexto, no en el router.

Ejemplo: [`examples/example-phoenix/`](../examples/example-phoenix/)

---

## Ktor

**Detecta por**: `build.gradle` / `build.gradle.kts` con `io.ktor`.

**Entiende**: el DSL anidado por llaves — `routing { route("/api") {
get("/users") { … } } }` — llevando la cuenta de las llaves para saber
en qué prefijo está cada verbo. Un `get { … }` **sin ruta** hereda la
del `route()` que lo envuelve.

Las llaves dentro de una cadena no cuentan: si contaran, un
`"{ }"` en un literal descuadraría el árbol entero.

**Bodies**: no se infieren.

Ejemplo: [`examples/example-ktor/`](../examples/example-ktor/)

---

## GraphQL

**Detecta por**: un `.graphql` o `.gql` con `type Query` o
`type Mutation`. También por `package.json` con `graphql`,
`@apollo/server`, `graphql-yoga`, `@nestjs/graphql` o `mercurius` — pero
el esquema pesa más, porque reconoce igual un servidor de Go o de Python.

**Entiende**: cada campo de `type Query` y `type Mutation` sale como una
request. GraphQL no tiene rutas: tiene **un** endpoint —`POST /graphql`—
y lo que cambia es el cuerpo, así que un "endpoint" aquí es una
operación.

**Bodies**: la consulta ya escrita, con los argumentos como **variables**
de GraphQL y no incrustados en el texto. Así se cambian desde el panel de
Postman sin editar la consulta.

**Limitaciones**: las `subscription` **no** se emiten — van por WebSocket
y una petición HTTP con una dentro contesta un error. El endpoint se
asume en `/graphql`; si el tuyo está en otro sitio, edítalo en la
colección o declara la ruta en `endpoints.constant.ts`.

Ejemplo: [`examples/example-graphql/`](../examples/example-graphql/)

---

## tRPC

**Detecta por**: `package.json` con `@trpc/server`.

**Entiende**: el árbol de routers, incluidos los que se declaran aparte
y se referencian (`const usersRouter = t.router({…})` y luego
`t.router({ users: usersRouter })`). El nombre del procedimiento sale de
anidarlos: `users.list`.

**La traducción a HTTP**, que es lo que casi nadie sabe de memoria porque
desde el cliente se llama como si fueran funciones:

| En el router | En HTTP |
| --- | --- |
| `t.procedure.query()` | `GET /trpc/users.list` con `?input=<json>` |
| `t.procedure.mutation()` | `POST /trpc/users.create` con el body |

**Limitaciones**: las `subscription` no se emiten, por lo mismo que en
GraphQL. El prefijo se asume `/trpc`.

Ejemplo: [`examples/example-trpc/`](../examples/example-trpc/)

---

## Si está soportado pero no lo detecta

La detección va por manifiestos: `composer.json` con `laravel`, `go.mod`
con `gofiber`, `Cargo.toml` con `actix-web`. Hay formas de proyecto donde
eso **no puede** funcionar por bien escrito que esté el scanner:

- Un **monorepo** con el manifiesto en la raíz y la API en
  `services/api/`: apuntando a la API no hay manifiesto que leer.
- Una **dependencia con alias**, o un fork publicado con otro nombre.
- Un manifiesto que se **genera en el build** y no está en el repo.

Para todos ellos, dilo tú:

```sh
expostman generate --project-root ./services/api --framework fastify
```

Un id que no existe falla al instante y lista los válidos, en vez de
escanear en vano y devolver cero endpoints. El asistente interactivo
ofrece la lista cuando no reconoce nada, y el tool `generate` del plugin
acepta el mismo `framework`.

Forzar el framework **no inventa rutas**: si el scanner tampoco encuentra
nada, salen cero endpoints y un aviso, no ruido.

## Si tu framework no está

Dos salidas:

1. **Publica un `openapi.yaml`.** Casi todos los frameworks tienen un
   generador. El scanner de OpenAPI lo coge y da mejor resultado que
   cualquier scanner específico.
2. **Declara los endpoints a mano** en un `endpoints.constant.ts`. Se
   fusionan con lo autodetectado y ganan en los conflictos.

Añadir un scanner nuevo son tres clases (`IProjectScanner`,
`IRouteScanner`, `IValidationSpecProvider`) registradas en
[`packages/frameworks/framework.registry.ts`](../packages/frameworks/framework.registry.ts).
Ver [CONTRIBUTING.md](../CONTRIBUTING.md).
