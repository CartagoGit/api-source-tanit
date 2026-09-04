# Instalación y uso

> **Estado de publicación.** El paquete **todavía no está en npm**, así
> que `bun add -g export-to-postman` aún no funciona. Hasta que se
> publique, se instala **desde el repositorio** — ver
> [Instalar hoy](#instalar-hoy-desde-el-repositorio). El resto del
> documento describe los comandos definitivos; el único cambio tras
> publicar será poder usar el nombre del paquete en lugar de la URL de
> git.
>
> Que el paquete funciona instalado está verificado de forma automática:
> `bun run validate:package` lo empaqueta con `npm pack`, lo instala en
> un proyecto limpio y ejecuta el binario contra una API real.

Tres formas de usarlo, según cómo trabajes.

- [Instalar hoy](#instalar-hoy-desde-el-repositorio) — mientras no esté publicado.
- [Global](#1-global) — lo instalas una vez y lo usas en cualquier proyecto.
- [Por proyecto](#2-por-proyecto) — queda fijado en el repo y lo usa todo el equipo.
- [Sin instalar](#3-sin-instalar-bunx) — una ejecución suelta.

Requisito común: **[Bun](https://bun.sh) 1.0 o superior**.

## Host MCP local durante el desarrollo

El paquete `@delendai/cli` todavía no está publicado. En este
repositorio, el host MCP de desarrollo se ejecuta desde el checkout local
hermano mediante la configuración ya existente en `.mcp.json`; VS Code usa
su copia sincronizada en `.vscode/mcp.json`.

Ese arranque local es intencionado mientras el paquete no esté disponible
en npm. Cuando se publique, podrá sustituirse por la forma `bunx
--package @delendai/cli mcpv __serve` descrita en el bootstrap.

---

## Instalar hoy (desde el repositorio)

```bash
# Global
bun add -g github:CartagoGit/export-to-postman

# O como dependencia de desarrollo de tu proyecto
bun add -d github:CartagoGit/export-to-postman
```

También sirve clonar y empaquetar:

```bash
git clone https://github.com/CartagoGit/export-to-postman
cd export-to-postman && bun install
npm pack                       # produce export-to-postman-0.1.0.tgz

cd ~/proyectos/mi-api
bun add -d /ruta/a/export-to-postman-0.1.0.tgz
```

En ambos casos queda disponible el binario `expostman` (y `export-to-postman` como alias).

```bash
curl -fsSL https://bun.sh/install | bash   # si no lo tienes
bun --version
```

---

## 1. Global

La opción cómoda si tocas varios proyectos.

```bash
bun add -g export-to-postman
```

Desde la raíz de tu API:

```bash
cd ~/proyectos/mi-api
expostman generate
```

Salida:

```
→ Orchestrator: framework=express
  · 9 rutas en código, 9 specs (con validación: 9, sin: 0).
→ Auth: login en "Crear Login" guarda el token automáticamente, refresh cableado.

✔ Collection written to ~/proyectos/mi-api/export-to-postman/mi-api.postman_collection.json
  · 9 requests en 3 carpetas (14.3 KB).
  · Environment "Local" → …/mi-api.local.postman_environment.json (5 vars)
```

Siguiente paso: **[importar en Postman](POSTMAN.md)**.

---

## 2. Por proyecto

Así el equipo entero usa la misma versión y no hay que instalar nada a
mano.

### Proyectos con `package.json` (Node, NestJS, Next.js, Express…)

```bash
bun add -d export-to-postman
```

```jsonc
// package.json
{
  "scripts": {
    "postman": "expostman generate"
  }
}
```

<!-- lint:docs ignore — `postman` es un script del proyecto de quien
     usa la herramienta, no de este repo. -->

```bash
bun run postman
```

### Proyectos sin `package.json` (PHP, Python, Go, Java, .NET)

No hace falta meter un `package.json` en tu repo. Se invoca con `bunx` y
`--project-root`:

```bash
bunx export-to-postman generate --project-root .
```

Y se deja escrito donde ya tengas tus tareas:

```makefile
# Makefile
.PHONY: postman
postman:
	bunx export-to-postman generate --project-root .
```

```yaml
# composer.json (Laravel/Symfony) — sección scripts
"scripts": {
    "postman": "bunx export-to-postman generate --project-root ."
}
```

```toml
# pyproject.toml con taskipy
[tool.taskipy.tasks]
postman = "bunx export-to-postman generate --project-root ."
```

> **`--project-root` no es opcional aquí.** Sin él, el CLI escanea el
> directorio del propio paquete y genera una colección vacía. Si ves
> `0 requests finales`, es esto.

---

## 3. Sin instalar (`bunx`)

Para probarlo antes de decidir:

```bash
bunx export-to-postman generate --project-root .
```

---

## 4. Binario, sin instalar ningún runtime

Si en tu equipo hay gente sin Bun ni Node —lo normal en proyectos de PHP,
Python, Go, Java o .NET—, hay un ejecutable autocontenido por plataforma.
No necesita nada más.

```bash
# Linux x64
curl -L https://github.com/CartagoGit/export-to-postman/releases/latest/download/export-to-postman-linux-x64 \
  -o /usr/local/bin/export-to-postman
chmod +x /usr/local/bin/export-to-postman

# El binario se llama `export-to-postman` al guardarlo; `expostman`
# solo existe como alias cuando se instala vía `bun add` (el campo
# `bin` de package.json crea ambos). Con la instalación manual,
# llama al archivo por su nombre o crea un symlink:
ln -s /usr/local/bin/export-to-postman /usr/local/bin/expostman   # opcional

export-to-postman generate --project-root .
```

Disponibles: `linux-x64`, `linux-arm64`, `darwin-arm64` y
`windows-x64.exe`.

Para compilarlo tú mismo desde el repo:

```bash
bun run build:binary          # solo tu plataforma
bun run build:binary --all    # las cuatro, en dist/
```

Pesa entre 60 y 95 MB porque incluye el runtime. A cambio, quien lo use
no instala nada.

---

## Dónde se escribe la salida

Por orden de prioridad:

1. `--output <ruta.json>` — ruta exacta del fichero.
2. `--output-dir <carpeta>` — carpeta de destino.
3. `POSTMAN_OUTPUT_DIR` — misma idea, por variable de entorno.
4. Por defecto: **`<raíz del proyecto>/export-to-postman/`**.

Los nombres salen del nombre del proyecto, o de `--basename`:

```
<basename>.postman_collection.json
<basename>.<entorno>.postman_environment.json
```

Conviene añadir `export-to-postman/` al `.gitignore` de tu proyecto, salvo que
quieras versionar la colección para revisarla en los PRs.

---

## Comandos

| Comando | Qué hace |
|---|---|
| `generate` | Genera la colección y los environments. Es el que usarás. |
| `list` | Lista los endpoints detectados, agrupados por zona. |
| `stats` | Cuenta endpoints por método y por zona. |
| `check` | Compara la colección ya generada con las rutas del código y avisa de desincronizaciones. Requiere haber ejecutado `generate` antes. |
| `validate` | Valida el JSON generado contra el schema Postman v2.1.0. |
| `watch` | Regenera al guardar. Se queda vigilando el proyecto hasta que lo pares con Ctrl+C. |
| `push` | Sube la colección **directamente** a tu workspace de Postman, sin pasar por el fichero. |
| `ui` | Abre la interfaz gráfica en el navegador. Para quien no quiere aprenderse los flags. |
| `history` | Lista las generaciones previas guardadas en `~/.expostman/history.jsonl` con `--limit N`, filtro por `--project`, salida `--json` y `--clear`. |

### `history` — ver qué se ha generado antes

```sh
expostman history --limit 20
expostman history --project <ruta> --json
expostman history --clear
```

```sh
expostman ui
```

Levanta la interfaz en `localhost`, abre el navegador y ya está. Pides
la carpeta de tu API, **ves lo detectado antes de que se escriba nada**
y eliges qué formatos quieres.

```
✔ Interfaz en http://127.0.0.1:4771
  · Escucha solo en este equipo: no es alcanzable desde la red.
  · Ctrl-C para cerrar.
```

Dos cosas que conviene saber:

- **Solo escucha en tu equipo.** Esto lee el código fuente de tu disco;
  que fuera alcanzable desde la red de la oficina no sería una comodidad.
- **Si el puerto está ocupado, busca otro.** No hace falta que sepas qué
  es un puerto para usarla. Con `--port <n>` lo eliges tú, y con
  `--no-open` no abre el navegador y solo imprime la URL.

No añade ninguna dependencia: el servidor es el que Bun ya lleva dentro,
y la interfaz viaja embebida en el propio ejecutable.


### `watch` — mientras desarrollas

```sh
expostman watch --project-root .
```

Genera una vez y se queda mirando. Cada vez que guardas un fichero de
rutas, vuelve a generar y dice qué ha cambiado:

```
[19:50:58] ✔ 9 requests en 3 carpetas · express · 54 ms
[19:51:12] · cambió src/routes/orders.ts
[19:51:12] ✔ 11 (+2) requests en 3 carpetas · 61 ms
```

El `+2` es lo que convierte la traza en información: sin él hay que
acordarse de cuántos había antes.

Acepta `--format` y `--framework` igual que `generate`. Y `--once`
genera una vez y sale, que es lo que hace falta en un pipeline —
comprobar que la colección sigue saliendo, sin un proceso que no termina.

### `push` — sin pasar por el fichero

```sh
export POSTMAN_API_KEY=pmak-...      # se crea en postman.co/settings/me/api-keys
expostman push --project-root .
```

Escanea, construye la colección y la sube. Si ya existe una con el mismo
`_postman_id`, la **actualiza** en vez de crear otra al lado.

| Flag | Qué controla |
|---|---|
| `--api-key <clave>` | La clave. Mejor por `POSTMAN_API_KEY`: un flag queda en el historial del shell. |
| `--workspace <id>` | A qué workspace. Por defecto, el personal. |
| `--no-environments` | Sube solo la colección. |
| `--framework <id>` | Igual que en `generate`. |

Antes de generar nada, para ver qué detectaría:

```bash
expostman generate --project-root . --inspect
```

---

## Flags y variables de entorno

| Flag | Variable | Por defecto | Qué controla |
|---|---|---|---|
| `--project-root <ruta>` | `POSTMAN_PROJECT_ROOT` | se busca subiendo desde el cwd | Qué proyecto se escanea |
| `--output-dir <ruta>` | `POSTMAN_OUTPUT_DIR` | `<proyecto>/export-to-postman/` | Carpeta de salida |
| `--framework <id>` | — | (autodetección) | Fuerza el framework cuando la detección no puede acertar |
| `--allow-empty` | — | — | No falla si no se encuentra ningún endpoint |
| `--output <fichero>` | — | — | Ruta exacta del `.json` |
| `--basename <nombre>` | `POSTMAN_OUTPUT_BASENAME` | nombre del proyecto | Nombre base de los ficheros |
| `--config <ruta>` | `POSTMAN_CONFIG` | autodetectado | `config.constant.ts` a usar |
| `--envs <a,b,c>` | — | Local, Dev, Staging, Producción | Qué environments generar |
| `--format <a,b,c>` | — | `postman` | Formatos de salida (ver abajo) |
| `--inspect` | — | — | Solo informa; no escribe |
| `--open` | — | — | Abre Postman al terminar |

Los flags ganan a las variables de entorno.

---

## Otros formatos

Postman es el formato por defecto, pero no el único. `--format` acepta
varios separados por coma:

```sh
expostman generate --format postman,openapi
```

| Formato | Sale | Para qué |
|---|---|---|
| `postman` | `.postman_collection.json` | Lo de siempre. Va solo si no pides otra cosa. |
| `openapi` | `.openapi.yaml` | OpenAPI 3.1.0. De aquí salen SDKs, configuración de gateway y documentación. |
| `insomnia` | `.insomnia.json` | Insomnia v4. Los ids son estables, así que reimportar **actualiza** en vez de duplicar. |
| `bruno` | una **carpeta** `.bruno/` | Un `.bru` por request. Es texto plano pensado para que un diff de Git se lea. |
| `har` | `.har` | HAR 1.2, para las DevTools del navegador y las herramientas de replay. |
| `curl` | `.curl.sh` | Un `curl` por endpoint, con las variables sacadas del entorno. |

Un formato que no exista falla **antes** de escanear y te lista los
válidos. Y si el formato no puede representar algo, lo dice: un proyecto
GraphQL exportado a OpenAPI avisa de qué operaciones se pierden, porque
OpenAPI identifica una operación por ruta y método y GraphQL tiene un
solo endpoint.

`expostman --help` lista los formatos leyéndolos del registro, así que
esa lista nunca se queda vieja.

---

## Configuración opcional

Sin configuración funciona. Cuando quieras control fino, crea un
`config.constant.ts`:

```bash
export-to-postman init
```

Lo más útil que puedes poner:

```ts
export const config: ProjectConfig = {
  name: "mi-api",
  collectionName: "Mi API",
  collectionDescription: "Endpoints de la API de producción",
  baseUrl: "http://localhost:8000/api",

  // Fíjalo si mueves o renombras el proyecto y quieres conservar la
  // colección que ya tienes importada en Postman.
  collectionId: "…",

  // Solo si tu API devuelve el token en un sitio poco habitual. Por
  // defecto se prueban access_token, token, accessToken,
  // data.access_token, data.token, data.accessToken, jwt e id_token.
  tokenResponsePath: "resultado.credenciales.jwt",

  environments: [
    { name: "Local", overrides: { baseUrl: "http://localhost:8000/api" } },
    { name: "Producción", overrides: { baseUrl: "https://api.miempresa.com" } },
  ],
};
```

El fichero completo y comentado está en
[`examples/example-app/config.constant.ts`](../examples/example-app/config.constant.ts).

---

## Problemas frecuentes

### `0 requests finales`

El escaneo no encontró el proyecto. Comprueba en el bloque de rutas que
imprime el comando que `projectRoot` apunta donde crees:

```bash
expostman generate --project-root /ruta/absoluta/a/tu/api
```

Si `projectRoot` está bien, mira en [FRAMEWORKS.md](FRAMEWORKS.md) qué
ficheros espera encontrar el scanner de tu framework.

### `No se pudo determinar la raíz del proyecto`

Pasa `--project-root <ruta>` o define `POSTMAN_PROJECT_ROOT`.

### Faltan endpoints

Cada scanner documenta sus limitaciones en
[FRAMEWORKS.md](FRAMEWORKS.md). Las rutas construidas dinámicamente (en
un bucle, o con el path en una variable) no se detectan: el análisis es
estático. Para esos casos se declaran a mano en un
`endpoints.constant.ts`, que se fusiona con lo autodetectado.

### `command not found: export-to-postman`

La instalación global de Bun no está en el `PATH`:

```bash
export PATH="$HOME/.bun/bin:$PATH"   # añádelo a tu .bashrc o .zshrc
```

## Desde otro ecosistema (sin instalar bun ni node)

`bin/` tiene lanzadores finos. No reimplementan nada: resuelven dónde
está el motor —un binario cacheado, una instalación global, `bunx`,
`npx`, o descargándolo de la release— y le pasan los argumentos.

| Ecosistema | Comando |
| --- | --- |
| Shell (Linux, macOS) | `./bin/expostman generate --project-root .` |
| Windows (PowerShell) | `.\bin\expostman.ps1 generate --project-root .` |
| Python | `python bin/wrappers/expostman.py generate --project-root .` |
| PHP / Composer | `php bin/wrappers/Expostman.php generate --project-root .` |

El binario descargado se cachea en `~/.expostman/`. Se cambia con
`EXPOSTMAN_HOME`.

### En tu fichero de build

```jsonc
// package.json
"scripts": { "postman": "expostman generate --project-root ." }
```

```jsonc
// composer.json
"scripts": { "postman": "php bin/wrappers/Expostman.php generate --project-root ." }
```

```makefile
# Makefile
postman:
	./bin/expostman generate --project-root .
```

```go
// Go
//go:generate ../bin/expostman generate --project-root .
```

```groovy
// build.gradle
task postman(type: Exec) { commandLine './bin/expostman', 'generate', '--project-root', '.' }
```

**Por qué son tan finos.** La versión anterior de esto reimplementaba el
generador en Node, Python y PHP. Las tres copias divergieron del
original, ninguna tenía tests, y cuando el proyecto se hizo agnóstico
las tres seguían siendo solo-Laravel sin que nadie se enterara. Se
retiraron en p00021. Hay **un** motor, y un test comprueba que ningún
lanzador mencione nada de dominio.

## Cuando la detección no acierta

La autodetección va por manifiestos (`composer.json`, `go.mod`,
`Cargo.toml`, `package.json`…). Hay formas de proyecto donde **no
puede** funcionar:

- Un monorepo cuyo manifiesto está en la raíz y la API en un subdirectorio.
- Una dependencia con alias, o un fork con otro nombre de paquete.
- Un manifiesto que se genera en el build y no está en el repositorio.

En esos casos, díselo:

```sh
expostman generate --project-root ./services/api --framework fastify
```

Un id que no exista falla al instante y lista los válidos. Los ids son
los de la tabla de `docs/FRAMEWORKS.md`.

