# Export to Postman

**Genera una colección de Postman desde el código de tu API.** Sin
anotaciones, sin decoradores extra, sin levantar el servidor. Apuntas al
directorio del proyecto y sale un `.json` listo para importar.

Detecta el framework solo. Funciona con **21**:

| Framework | Detecta por | De dónde saca los bodies |
|---|---|---|
| Laravel | `artisan` + `composer.json` | FormRequests (`rules()`) |
| Symfony | `composer.json` con `symfony/framework-bundle` | `#[Assert\…]` |
| Express / Koa / Hapi | `package.json` con `express`, `@koa/router`, `@hapi/hapi` | zod y Joi |
| Fastify | `package.json` con `fastify` | el JSON Schema que va **dentro** de la ruta |
| Hono | `package.json` con `hono` | `@hono/zod-validator` |
| NestJS | `package.json` con `@nestjs/core` | `class-validator` en los DTO |
| Next.js | `package.json` con `next` | zod en el route handler |
| tRPC | `package.json` con `@trpc/server` | la forma de la ruta: `query` → GET, `mutation` → POST |
| GraphQL | un `.graphql` con `type Query` | el esquema: una request por operación |
| FastAPI | `requirements.txt` / `pyproject.toml` con `fastapi` | modelos Pydantic |
| Flask | `requirements.txt` / `pyproject.toml` con `flask` | esquemas de Marshmallow |
| Django / DRF | `manage.py` | serializers de DRF |
| Gin | `go.mod` con `gin-gonic/gin` | tags `binding:"required"` |
| Fiber | `go.mod` con `gofiber/fiber` | tags `validate:"…"` de go-playground |
| Rust (Actix / Rocket) | `Cargo.toml` con `actix-web` o `rocket` | `#[validate(…)]`, `Option<T>` como opcional |
| Spring Boot | `pom.xml` / `build.gradle` con Spring Boot | `jakarta.validation` |
| Ktor | `build.gradle` con `io.ktor` | — |
| ASP.NET Core | `*.csproj` con `Microsoft.AspNetCore.App` | Data Annotations |
| Rails | `Gemfile` con `rails` | `resources` expandido a sus acciones de API |
| Phoenix | `mix.exs` con `phoenix` | `scope` y `resources` del router |
| OpenAPI / Swagger | `openapi.yaml`, `openapi.json`, `swagger.*` | el propio spec |

La lista de verdad la imprime `expostman --help`, que la lee del registro
de scanners. Esta tabla añade de dónde sale cada cosa.

Cuando la detección no puede acertar —un monorepo con el manifiesto en la
raíz, una dependencia con alias, un manifiesto que se genera en el
build— se lo puedes decir: `--framework <id>`.

Si tu proyecto ya publica un `openapi.yaml`, ese scanner cubre cualquier
framework aunque no esté en la lista.

---

## Empezar

```bash
# 1. Instalar (aún no publicado en npm — se instala desde el repo)
bun add -g github:CartagoGit/export-to-postman

# 2. Generar, desde la raíz de tu proyecto
expostman generate

# 3. Importar en Postman el .json de export-to-postman/
```

Guías completas: **[instalación](docs/INSTALL.md)** ·
**[por framework](docs/FRAMEWORKS.md)** ·
**[importar en Postman](docs/POSTMAN.md)**

---

## Qué genera

Contra `examples/example-express`:

```
export-to-postman/
├── example-express.postman_collection.json     ← la colección
├── example-express.local.postman_environment.json
├── example-express.dev.postman_environment.json
├── example-express.staging.postman_environment.json
└── example-express.produccion.postman_environment.json
```

La colección trae:

- **Los endpoints agrupados en carpetas** por recurso, con la de
  autenticación primera.
- **Bodies de ejemplo** derivados de tus reglas de validación reales, con
  el tipo y el formato de cada campo.
- **Path params como variables** (`{{id}}`), con valor de ejemplo.
- **Auth Bearer** a nivel de colección, ya cableado.
- **Login que guarda el token solo** — ver abajo.
- **Un id estable**: regenerar y volver a importar **actualiza** la
  colección en Postman, no crea una copia.

## Autenticación sin copiar tokens

Si tu API expone un endpoint de login, la colección sale con el flujo ya
montado:

1. Rellenas `authUsername` y `authPassword` en el environment. Una vez.
2. Lanzas **Login**.
3. El token se guarda solo en `token` y el resto de endpoints lo usan.

El token va al environment, así que **sobrevive a cerrar Postman**. Si
tienes endpoint de refresh, también captura; si tienes logout, limpia.

No hay que configurar nada: el script prueba en ejecución los caminos
habituales de respuesta (`access_token`, `token`, `data.access_token`,
`accessToken`, `jwt`…). Si tu API lo devuelve en un sitio raro, se
declara con `tokenResponsePath` en el config.

---

## Comandos

```bash
expostman generate    # genera la colección + environments
expostman ui          # abre una interfaz web para usarlo sin terminal
expostman list        # lista los endpoints detectados
expostman stats       # cuántos endpoints por método y zona
expostman check       # ¿la colección sigue sincronizada?
expostman validate    # valida el JSON contra el schema v2.1.0
expostman push        # sube la colección a tu workspace de Postman
expostman watch       # regenera al vuelo mientras editas rutas
```

Los ocho, y solo esos ocho, son los que despacha el binario.

Flags principales:

| Flag | Para qué |
|---|---|
| `--project-root <ruta>` | Raíz del proyecto a escanear |
| `--basename <nombre>` | Nombre base de los ficheros de salida |
| `--output <ruta>` | Ruta completa del `.json` |
| `--envs <a,b,c>` | Qué environments generar |
| `--inspect` | Solo informa; no escribe nada |

Todas en [docs/INSTALL.md](docs/INSTALL.md#flags-y-variables-de-entorno).

---

## Sin terminal: la interfaz

```bash
expostman ui
```

Levanta una interfaz web en `http://127.0.0.1:4771` —o el siguiente
puerto libre— y abre el navegador. Escucha **solo en este equipo**: no
es alcanzable desde la red.

Y solo contesta a su propia página. Escuchar en `127.0.0.1` no basta:
el servidor no es alcanzable desde fuera, pero sí desde el navegador de
quien lo ejecuta, así que cualquier web que visites mientras corre
podría hacerle peticiones. Cada arranque genera un testigo que va dentro
del HTML servido; una página de otro origen no puede leerlo.

Desde ahí se elige la carpeta del proyecto, se inspecciona antes de
escribir nada, y se genera en los formatos que se quieran. Llama al
mismo pipeline que el CLI: no es una segunda implementación que se
desincronice.

Para tocarla, `bun run ui:dev` la levanta y **la reinicia sola** al
editar `packages/ui/`, manteniendo el puerto: basta con recargar la
pestaña.

Y para usarla sin instalar nada de Node hay instaladores nativos que
abren esa misma interfaz en su propia ventana:

```bash
bun run desktop:build:linux    # .deb + .AppImage
bun run desktop:build:mac      # .dmg + .app
bun run desktop:build:windows  # .msi + .exe
```

Cada plataforma solo construye la suya —cada instalador exige el SDK de
su sistema—; los tres a la vez salen de CI.

- Cómo instalarlos: [docs/DESKTOP-INSTALL.md](docs/DESKTOP-INSTALL.md)
- Cómo publicarlos: [docs/DESKTOP-PUBLISH.md](docs/DESKTOP-PUBLISH.md)

---

## Configuración (opcional)

Funciona sin configurar nada. Cuando quieras afinar, un
`config.constant.ts` en la raíz permite fijar el nombre de la colección,
la `baseUrl` por entorno, el agrupado en carpetas o el
`collectionId`. Ver [`examples/example-app/config.constant.ts`](examples/example-app/config.constant.ts).

---

## Desarrollo

```bash
bun install
bun run validate     # el gate: typecheck + lint + tests + generación real
```

`bun run validate` es lo único que hay que pasar. Encadena:

| Paso | Qué comprueba |
|---|---|
| `typecheck` | `tsc --noEmit` |
| `lint:tools` | los tools del plugin MCP no leen `process.env` |
| `test` | la suite completa |
| `validate:examples` | genera de verdad los 21 proyectos de `examples/` y valida cada colección |

Y aparte, antes de publicar:

```bash
bun run validate:package   # empaqueta, instala en un proyecto limpio y ejecuta el binario
```

Contribuir: [CONTRIBUTING.md](CONTRIBUTING.md).
Estado y decisiones: [auditoría](docs/mcp-vertex/AUDIT-2026-08-06.md) y
[propuestas](docs/mcp-vertex/proposals/).

---

## Licencia

MIT.
