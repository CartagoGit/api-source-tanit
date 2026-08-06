# Export to Postman

**Genera una colección de Postman desde el código de tu API.** Sin
anotaciones, sin decoradores extra, sin levantar el servidor. Apuntas al
directorio del proyecto y sale un `.json` listo para importar.

Detecta el framework solo. Funciona con **12**:

| Framework | Detecta por | De dónde saca los bodies |
|---|---|---|
| Laravel | `artisan` + `composer.json` | FormRequests (`rules()`) |
| Symfony | `composer.json` con `symfony/framework-bundle` | `#[Assert\…]` |
| Express / Fastify / Koa / Hapi | `package.json` con `express`, `fastify`, `@koa/router`, `@hapi/hapi` | zod y Joi |
| NestJS | `package.json` con `@nestjs/core` | `class-validator` en los DTO |
| Next.js | `package.json` con `next` | zod en el route handler |
| FastAPI | `requirements.txt` / `pyproject.toml` con `fastapi` | modelos Pydantic |
| Flask | `requirements.txt` / `pyproject.toml` con `flask` | `flask_pydantic` |
| Django / DRF | `manage.py` | serializers de DRF |
| Gin | `go.mod` con `gin-gonic/gin` | tags `binding:"required"` |
| Spring Boot | `pom.xml` / `build.gradle` con Spring Boot | `jakarta.validation` |
| ASP.NET Core | `*.csproj` con `Microsoft.AspNetCore.App` | Data Annotations |
| OpenAPI / Swagger | `openapi.yaml`, `openapi.json`, `swagger.*` | el propio spec |

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
expostman list        # lista los endpoints detectados
expostman stats       # cuántos endpoints por método y zona
expostman check       # ¿la colección sigue sincronizada?
expostman validate    # valida el JSON contra el schema v2.1.0
expostman enrich      # re-enriquece desde el discovery
```

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
| `validate:examples` | genera de verdad los 11 proyectos de `examples/` y valida cada colección |

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
