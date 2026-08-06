# Instalación y uso

> **Estado de publicación.** El paquete **todavía no está en npm**, así
> que `bun add -g @postman-exporter/cli` aún no funciona. Hasta que se
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

---

## Instalar hoy (desde el repositorio)

```bash
# Global
bun add -g github:CartagoGit/postman-exporter

# O como dependencia de desarrollo de tu proyecto
bun add -d github:CartagoGit/postman-exporter
```

También sirve clonar y empaquetar:

```bash
git clone https://github.com/CartagoGit/postman-exporter
cd postman-exporter && bun install
npm pack                       # produce postman-exporter-cli-0.1.0.tgz

cd ~/proyectos/mi-api
bun add -d /ruta/a/postman-exporter-cli-0.1.0.tgz
```

En ambos casos queda disponible el binario `postman-from-routes`.

```bash
curl -fsSL https://bun.sh/install | bash   # si no lo tienes
bun --version
```

---

## 1. Global

La opción cómoda si tocas varios proyectos.

```bash
bun add -g @postman-exporter/cli
```

Desde la raíz de tu API:

```bash
cd ~/proyectos/mi-api
postman-from-routes generate
```

Salida:

```
→ Orchestrator: framework=express
  · 9 rutas en código, 9 specs (con validación: 9, sin: 0).
→ Auth: login en "Crear Login" guarda el token automáticamente, refresh cableado.

✔ Colección escrita en ~/proyectos/mi-api/build/mi-api.postman_collection.json
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
bun add -d @postman-exporter/cli
```

```jsonc
// package.json
{
  "scripts": {
    "postman": "postman-from-routes generate"
  }
}
```

```bash
bun run postman
```

### Proyectos sin `package.json` (PHP, Python, Go, Java, .NET)

No hace falta meter un `package.json` en tu repo. Se invoca con `bunx` y
`--project-root`:

```bash
bunx @postman-exporter/cli generate --project-root .
```

Y se deja escrito donde ya tengas tus tareas:

```makefile
# Makefile
.PHONY: postman
postman:
	bunx @postman-exporter/cli generate --project-root .
```

```yaml
# composer.json (Laravel/Symfony) — sección scripts
"scripts": {
    "postman": "bunx @postman-exporter/cli generate --project-root ."
}
```

```toml
# pyproject.toml con taskipy
[tool.taskipy.tasks]
postman = "bunx @postman-exporter/cli generate --project-root ."
```

> **`--project-root` no es opcional aquí.** Sin él, el CLI escanea el
> directorio del propio paquete y genera una colección vacía. Si ves
> `0 requests finales`, es esto.

---

## 3. Sin instalar (`bunx`)

Para probarlo antes de decidir:

```bash
bunx @postman-exporter/cli generate --project-root .
```

---

## 4. Binario, sin instalar ningún runtime

Si en tu equipo hay gente sin Bun ni Node —lo normal en proyectos de PHP,
Python, Go, Java o .NET—, hay un ejecutable autocontenido por plataforma.
No necesita nada más.

```bash
# Linux x64
curl -L https://github.com/CartagoGit/postman-exporter/releases/latest/download/postman-from-routes-linux-x64 \
  -o /usr/local/bin/postman-from-routes
chmod +x /usr/local/bin/postman-from-routes

postman-from-routes generate --project-root .
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
4. Por defecto: **`<raíz del proyecto>/build/`**.

Los nombres salen del nombre del proyecto, o de `--basename`:

```
<basename>.postman_collection.json
<basename>.<entorno>.postman_environment.json
```

Conviene añadir `build/` al `.gitignore` de tu proyecto, salvo que
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
| `enrich` | Re-enriquece la colección desde el discovery. Con `--in-place` reemplaza la principal. |

Antes de generar nada, para ver qué detectaría:

```bash
postman-from-routes generate --project-root . --inspect
```

---

## Flags y variables de entorno

| Flag | Variable | Por defecto | Qué controla |
|---|---|---|---|
| `--project-root <ruta>` | `POSTMAN_PROJECT_ROOT` | se busca subiendo desde el cwd | Qué proyecto se escanea |
| `--output-dir <ruta>` | `POSTMAN_OUTPUT_DIR` | `<proyecto>/build/` | Carpeta de salida |
| `--output <fichero>` | — | — | Ruta exacta del `.json` |
| `--basename <nombre>` | `POSTMAN_OUTPUT_BASENAME` | nombre del proyecto | Nombre base de los ficheros |
| `--config <ruta>` | `POSTMAN_CONFIG` | autodetectado | `config.constant.ts` a usar |
| `--envs <a,b,c>` | — | Local, Dev, Staging, Producción | Qué environments generar |
| `--inspect` | — | — | Solo informa; no escribe |
| `--open` | — | — | Abre Postman al terminar |

Los flags ganan a las variables de entorno.

---

## Configuración opcional

Sin configuración funciona. Cuando quieras control fino, crea un
`config.constant.ts`:

```bash
postman-from-routes init
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
postman-from-routes generate --project-root /ruta/absoluta/a/tu/api
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

### `command not found: postman-from-routes`

La instalación global de Bun no está en el `PATH`:

```bash
export PATH="$HOME/.bun/bin:$PATH"   # añádelo a tu .bashrc o .zshrc
```
