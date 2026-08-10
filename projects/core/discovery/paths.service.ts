/**
 * Fachada con estado sobre `project-context.service.ts`.
 *
 * **Preferir `resolveProjectContext()` en código nuevo.** Este módulo
 * cachea la raíz una vez por proceso, lo que sirve para el CLI —un
 * proceso por proyecto— pero no para consumidores de vida larga. Existe
 * porque ocho servicios y varios scripts aún lo usan; `withProjectRoot()`
 * cubre el hueco mientras tanto (p00017).
 *
 * Descubrimiento automático de rutas (agnóstico del proyecto).
 *
 * Resuelve siempre ABSOLUTAS, sin usar `__dirname` relativo. Dos raíces:
 *   - `packageRoot()`  → carpeta donde vive este paquete.
 *   - `projectRoot()`  → raíz del proyecto que se está escaneando.
 *
 * Resolución del `packageRoot`:
 *   1. Búsqueda subiendo desde la carpeta de **este módulo** hasta dar
 *      con `package.json` + `projects/contracts/constants/core/postman.constant.ts`.
 *   2. Si no aparece, el padre de esa carpeta. Es un último recurso que
 *      ya mintió una vez (ver `findPackageRoot`).
 *
 * Resolución del `projectRoot`:
 *   1. CLI `--project-root <path>`.
 *   2. Env `POSTMAN_PROJECT_ROOT`.
 *   3. Último recurso: subir desde `packageRoot()` buscando la
 *      disposición de un Laravel (`artisan` + `routes/` + `app/`).
 *      Es una heurística heredada de cuando esto solo servía para
 *      Laravel; para el resto de frameworks nunca acierta, y por eso
 *      el CLI exige `--project-root` explícito.
 *
 * Directorio de output (`outputDir()`):
 *   1. CLI `--output-dir <path>` o `--output <file>` (parent).
 *   2. Env `POSTMAN_OUTPUT_DIR`.
 *   3. Si `packageRoot` está **dentro** de `projectRoot` (modo repo):
 *        → `${packageRoot}/export-to-postman/`
 *      Si NO (modo paquete externo en otro proyecto):
 *        → `${projectRoot}/export-to-postman/`
 *   4. `process.cwd()/export-to-postman/` como último fallback.
 */
import { existsSync } from "node:fs";
import { delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { OUTPUT_DIR_NAME } from "../../contracts/constants/core/postman.constant.js";
import type { IPathScope } from "../../contracts/interfaces/core/discovery.interface.js";
import { CONTAINMENT_ROOT_VAR } from "../../contracts/constants/core/runtime-limits.constant.js";

// ---------------------------------------------------------------------------
// Caché interna
// ---------------------------------------------------------------------------

interface Discovered {
  packageRoot: string;
  projectRoot: string | null;
  packageBasename: string;
  projectBasename: string;
}

let cache: Discovered | null = null;

// ---------------------------------------------------------------------------
// Helpers de búsqueda
// ---------------------------------------------------------------------------

function dirnameUp(start: string, steps: number): string {
  let cur = start;
  for (let i = 0; i < steps; i++) {
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return cur;
}

function walkUp(
  start: string,
  predicate: (dir: string) => boolean,
): string | null {
  let cur = resolve(start);
  for (let i = 0; i < 16; i++) {
    if (predicate(cur)) return cur;
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
  return null;
}

/**
 * La raíz de **este** paquete, subiendo desde donde vive este módulo.
 *
 * El marcador es un fichero que solo existe aquí. Un `package.json` a
 * secas no basta: instalado dentro de otro proyecto, el primero que se
 * encuentra subiendo podría ser el del host.
 *
 * ## Por qué estaba roto
 *
 * El predicado buscaba `contract`, en singular, y la carpeta se llamaba
 * `contracts`. Nunca casaba, así que `findPackageRoot` devolvía siempre
 * `null` y `discover()` se caía a `dirnameUp(start, 1)` — el padre de
 * `projects/core/discovery/`, o sea **`projects/core`**. El fallback fue
 * correcto en su día, cuando este fichero vivía un nivel bajo la raíz;
 * al mover el código a `projects/` dejó de serlo y nadie se enteró,
 * porque el predicado tampoco funcionaba y los dos fallos se tapaban.
 *
 * Se pagó en dos sitios, los dos medidos:
 *
 *   · En modo repo —escanear este propio repositorio— la salida iba a
 *     `projects/core/export-to-postman/`. Hay una colección de
 *     `example-app` ahí dentro que lo demuestra.
 *   · `POSTMAN_EXAMPLE` buscaba en `projects/core/examples/`, que no
 *     existe, así que la variable no hacía nada en silencio.
 *
 * El marcador volvió a quedarse viejo al mudar los contratos a su propio
 * proyecto (r00007 S2), y esta vez lo cazaron los tests en el acto. Esa
 * es la diferencia entre una ruta escrita a mano y una ruta escrita a
 * mano **con algo que la comprueba**.
 */
function findPackageRoot(start: string): string | null {
  return walkUp(start, (dir) => {
    return (
      existsSync(join(dir, "package.json")) &&
      existsSync(
        join(dir, "projects", "contracts", "constants", "core", "postman.constant.ts"),
      )
    );
  });
}

/**
 * Heurística heredada: busca la disposición de un proyecto Laravel.
 *
 * Solo se usa como último recurso, cuando no hay `--project-root` ni
 * `POSTMAN_PROJECT_ROOT`. Para cualquier otro framework no encuentra
 * nada y se cae a `process.cwd()`, que es el comportamiento correcto:
 * adivinar la raíz de un proyecto ajeno es peor que preguntar.
 */
function findLaravelLayoutRoot(start: string): string | null {
  return walkUp(start, (dir) => {
    return (
      existsSync(join(dir, "artisan")) &&
      existsSync(join(dir, "routes")) &&
      existsSync(join(dir, "app"))
    );
  });
}

function readProjectRootFromArgv(argv: string[]): string | null {
  const idx = argv.indexOf("--project-root");
  if (idx === -1) return null;
  return argv[idx + 1] ?? null;
}

function resolveProjectRoot(packageRoot: string): string | null {
  const cliArg = readProjectRootFromArgv(process.argv);
  if (cliArg) return resolve(cliArg);
  const env = process.env.POSTMAN_PROJECT_ROOT;
  if (env) return resolve(env);
  return findLaravelLayoutRoot(packageRoot) ?? process.cwd();
}

function basenameOrFallback(p: string, fallback: string): string {
  const last = p.split(sep).filter(Boolean).pop();
  return last ?? fallback;
}

function discover(): Discovered {
  if (cache) return cache;
  const start = (import.meta as { dir?: string }).dir ?? __dirname;
  const packageRoot =
    findPackageRoot(start) ?? dirnameUp(start, 1);

  const projectRoot = resolveProjectRoot(packageRoot);
  const packageBasename = basenameOrFallback(packageRoot, "postman");
  const projectBasename = projectRoot
    ? basenameOrFallback(projectRoot, packageBasename)
    : packageBasename;

  cache = {
    packageRoot,
    projectRoot,
    packageBasename,
    projectBasename,
  };
  return cache;
}

/**
 * ¿La raíz del proyecto la eligió alguien, o se cayó al directorio
 * actual?
 *
 * `projectRoot()` **nunca** devuelve `null`: si no hay `--project-root`
 * ni `POSTMAN_PROJECT_ROOT`, acaba en `process.cwd()`. Eso deja muerta
 * la rama «no se pudo determinar la raíz» que varios comandos tienen
 * escrita, y —peor— hace que lanzar la herramienta desde el sitio
 * equivocado escanee ese árbol entero sin decir nada.
 *
 * Se midió: `watch --once` lanzado desde `/tmp` recorrió el directorio,
 * encontró un proyecto suelto y generó su colección. Desde `$HOME`
 * recorrería la casa.
 *
 * No se cambia el fallback —es cómodo y hay quien lo usa—, pero quien
 * llama puede preguntar y avisar. Un comportamiento implícito deja de
 * ser una trampa en cuanto se dice en voz alta.
 */
export function projectRootWasExplicit(): boolean {
  return (
    readProjectRootFromArgv(process.argv) !== null ||
    (process.env.POSTMAN_PROJECT_ROOT ?? "") !== ""
  );
}

/** Limpia la caché (útil para tests). */
export function resetPathCache(): void {
  cache = null;
}

/**
 * Ejecuta `fn` con la raíz del proyecto fijada a `root`, y restaura el
 * estado anterior al terminar (también si `fn` lanza).
 *
 * El descubrimiento de rutas se resuelve **una vez por proceso** y se
 * cachea. Eso vale para el CLI —un proceso por proyecto— pero rompe a
 * cualquier consumidor de vida larga: un servidor MCP que analice el
 * proyecto A y luego el B obtenía las rutas de A. Y obligaba a los tests
 * a manosear `process.env` a mano antes y después de cada llamada.
 *
 * Este envoltorio hace reentrante todo lo que dependa del singleton sin
 * tener que enhebrar un contexto por las ocho capas de servicio. El paso
 * siguiente —`IProjectContext` explícito en cada firma— sigue pendiente
 * (p00017 S3).
 */
/**
 * Cola de acceso al singleton.
 *
 * `withProjectRoot` guarda el estado global, lo pisa, ejecuta y lo
 * restaura. Dos llamadas **concurrentes** se destrozan: la segunda pisa
 * el valor mientras la primera sigue viva, y al terminar la primera
 * restaura el estado de antes dejando a la segunda mirando la raíz
 * equivocada.
 *
 * Se detectó comparando `summary` con `generate` sobre el mismo
 * proyecto lanzados con `Promise.all`: daban 16 y 17 endpoints donde
 * secuencialmente dan 18 los dos. No es teórico — un servidor MCP puede
 * atender dos peticiones a la vez.
 *
 * Serializar es la cura correcta mientras el singleton exista: dos
 * análisis concurrentes tardan lo que la suma, pero ninguno miente. La
 * cura de fondo es que nadie lea estado global (p00017), y entonces
 * esta cola sobra.
 */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Cuántas secciones anidadas hay abiertas.
 *
 * Sin esto, anidar dos scopes se cuelga para siempre: el de dentro se
 * encola detrás del de fuera, que no puede terminar hasta que el de
 * dentro lo haga. Ya estando dentro de una sección el acceso al
 * singleton está serializado, así que la de dentro se ejecuta directa.
 */
let depth = 0;

/** Las variables de entorno que fijan las rutas del proyecto. */
const SCOPE_VARS = {
  projectRoot: "POSTMAN_PROJECT_ROOT",
  outputDir: "POSTMAN_OUTPUT_DIR",
} as const;

/**
 * Ejecuta `fn` con las rutas del scope fijadas, y restaura el estado
 * anterior al terminar (también si `fn` lanza).
 *
 * Existe porque `outputDir()` y `projectRoot()` leen `process.argv` y
 * `process.env`, no argumentos. Quien invoca un comando **en el mismo
 * proceso** —el asistente interactivo llamando a `generate`— le pasa un
 * array de flags que esas funciones no miran: leen el argv del proceso,
 * que es el del asistente. El resultado era que la opción "escribir en
 * otra carpeta" del asistente aceptaba la carpeta, la mostraba, y
 * escribía en la de por defecto.
 */
export async function withScopedPaths<T>(
  scope: IPathScope,
  fn: () => Promise<T>,
): Promise<T> {
  const apply = async (): Promise<T> => {
    const previousEnv: Partial<Record<string, string | undefined>> = {};
    const previousCache = cache;
    depth++;

    for (const [key, variable] of Object.entries(SCOPE_VARS)) {
      const value = scope[key as keyof IPathScope];
      if (value === undefined) continue;
      previousEnv[variable] = process.env[variable];
      process.env[variable] = resolve(value);
    }
    cache = null;

    try {
      return await fn();
    } finally {
      for (const [variable, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[variable];
        else process.env[variable] = value;
      }
      cache = previousCache;
      depth--;
    }
  };

  if (depth > 0) return apply();

  const run = queue.then(apply);
  // La cola no debe romperse porque una llamada falle: se encadena el
  // resultado ya neutralizado, y el error se propaga solo a quien llamó.
  queue = run.catch(() => undefined);
  return run as Promise<T>;
}

/**
 * Ejecuta `fn` con la raíz del proyecto fijada a `root`.
 *
 * Atajo de `withScopedPaths` para el caso más común. Restaura el estado
 * anterior al terminar, también si `fn` lanza.
 */
export async function withProjectRoot<T>(
  root: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withScopedPaths({ projectRoot: root }, fn);
}

/** Raíz de este paquete. */
export function packageRoot(): string {
  return discover().packageRoot;
}

/** Raíz del proyecto que se escanea. `null` si no se pudo resolver. */
export function projectRoot(): string | null {
  return discover().projectRoot;
}

/** `${projectRoot}/routes` o `null`. */
export function routesDir(): string | null {
  const r = projectRoot();
  return r ? join(r, "routes") : null;
}

/** `${projectRoot}/app` o `null`. */
export function appDir(): string | null {
  const r = projectRoot();
  return r ? join(r, "app") : null;
}

/** `${projectRoot}/app/Http/Requests` o `null`. */
export function requestsDir(): string | null {
  const a = appDir();
  return a ? join(a, "Http", "Requests") : null;
}

/** Nombre del proyecto que se escanea. */
export function projectBasename(): string {
  return discover().projectBasename;
}

/**
 * Nombre de **este** paquete, no del proyecto que se escanea.
 *
 * La distinción importa: cuando la herramienta está instalada dentro del
 * proyecto, los dos nombres conviven y confundirlos hace que la colección
 * salga llamándose `export-to-postman` en vez de como la API.
 */
export function packageBasename(): string {
  return discover().packageBasename;
}

// ---------------------------------------------------------------------------
// Directorio de OUTPUT
// ---------------------------------------------------------------------------

/**
 * Devuelve el directorio donde se escriben los artefactos.
 * Regla:
 *   1. CLI `--output-dir <path>` o `--output <file>` (parent).
 *   2. Env `POSTMAN_OUTPUT_DIR`.
 *   3. Si el paquete está **dentro** del proyecto → `${packageRoot}/export-to-postman/`.
 *      Si NO → `${projectRoot}/export-to-postman/`.
 *   4. `process.cwd()/export-to-postman/` fallback.
 */
export function outputDir(): string {
  const d = discover();
  const argv = process.argv;

  // 1. CLI
  const fromDirFlag = argv[argv.indexOf("--output-dir") + 1];
  if (argv.includes("--output-dir") && fromDirFlag) return resolve(fromDirFlag);
  const fromFileFlag = argv[argv.indexOf("--output") + 1];
  if (argv.includes("--output") && fromFileFlag) return resolve(dirname(fromFileFlag));

  // 2. Env
  const envDir = process.env.POSTMAN_OUTPUT_DIR;
  if (envDir) return resolve(envDir);

  // 3. Inferencia por relación packageRoot ↔ projectRoot.
  if (d.projectRoot) {
    const rel = relative(d.projectRoot, d.packageRoot);
    // Si `rel` no empieza por ".." ni es absoluto, packageRoot está DENTRO
    // del proyecto. En ese caso el output va en la carpeta del paquete.
    // `inside=true` solo si projectRoot ⊂ packageRoot o packageRoot ⊂ projectRoot.
    // Caso típico: packageRoot = ${projectRoot}/resources/postman, projectRoot = ${projectRoot}.
    // rel = ".." + "resources/postman" → startsWith(".."), así que outside.
    // Si está dentro: rel = "resources/postman" → inside.
    const pkgInsideProj = rel === ".." || (!rel.startsWith("..") && rel !== "");
    return pkgInsideProj
      ? join(d.packageRoot, OUTPUT_DIR_NAME)
      : join(d.projectRoot, OUTPUT_DIR_NAME);
  }

  // 4. Fallback
  return join(process.cwd(), OUTPUT_DIR_NAME);
}

/**
 * Nombre base del JSON de salida.
 * Prioridad: env `POSTMAN_OUTPUT_BASENAME` → nombre del proyecto.
 */
export function outputBasename(projectName?: string): string {
  const env = process.env.POSTMAN_OUTPUT_BASENAME;
  if (env) {
    return env.endsWith(".postman_collection")
      ? env
      : `${env}.postman_collection`;
  }
  const base = projectName?.trim() || projectBasename();
  return `${base}.postman_collection`;
}

/** Ruta absoluta al JSON principal. Crea `outputDir` si no existe. */
export async function outputCollectionPath(
  projectName?: string,
): Promise<string> {
  await ensureOutputDir();
  return join(outputDir(), `${outputBasename(projectName)}.json`);
}

/** Ruta absoluta al JSON enriquecido. */

/** Ruta absoluta al environment Postman para un entorno dado. */
export async function outputEnvironmentPath(
  envName: string,
  projectName?: string,
): Promise<string> {
  await ensureOutputDir();
  const base = projectName?.trim() || projectBasename();
  const slug = envName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return join(outputDir(), `${base}.${slug}.postman_environment.json`);
}

async function ensureOutputDir(): Promise<void> {
  const fs = await import("node:fs/promises");
  const dir = outputDir();

  const contain = process.env[CONTAINMENT_ROOT_VAR];
  if (contain) {
    const { ensureInsideAny } = await import("../helpers/path-containment.helper.js");
    const roots = contain.split(delimiter).filter((r) => r.length > 0);
    const check = await ensureInsideAny(roots, dir);
    if (!check.ok) {
      // Se comprueba justo antes de crear, no al leer el flag: entre una
      // cosa y la otra `outputDir()` aplica tres reglas de precedencia, y
      // validar la de entrada dejaría fuera las otras dos.
      throw new Error(
        `La carpeta de salida se sale de las raíces permitidas.\n` +
          `  · ${check.reason}\n` +
          `  · Lo impone ${CONTAINMENT_ROOT_VAR}, que pone el plugin MCP al\n` +
          `    lanzar el CLI: ahí la ruta la elige un agente, no una persona.\n` +
          `  · Lanzado a mano, sin esa variable, cualquier ruta vale.`,
      );
    }
  }

  if (!existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
  }
}

/**
 * Convierte una ruta absoluta del proyecto a una relativa al proyecto
 * (formato POSIX). Lanza si no hay raíz de proyecto conocida.
 */
export function toProjectRelative(absPath: string): string {
  const r = projectRoot();
  if (!r) {
    throw new Error(
      "No se pudo determinar la raíz del proyecto. " +
        "Define POSTMAN_PROJECT_ROOT o ejecuta con --project-root <path>.",
    );
  }
  return relative(r, absPath).split(sep).join("/");
}

/**
 * Convierte una ruta relativa al proyecto escaneado en absoluta.
 *
 * Ojo: relativa al **proyecto que se escanea**, no a este paquete. Es la
 * distinción que hace que un scanner pueda emitir `src/routes/x.ts` sin
 * saber dónde está instalado.
 */
export function fromProjectRelative(relPath: string): string {
  const r = projectRoot();
  if (!r) {
    throw new Error(
      "No se pudo determinar la raíz del proyecto. " +
        "Define POSTMAN_PROJECT_ROOT o ejecuta con --project-root <path>.",
    );
  }
  return join(r, relPath);
}

/**
 * Las rutas resueltas, en texto, para la traza del CLI.
 *
 * Se imprime antes de escanear a propósito: cuando la salida no es la
 * esperada, lo primero que hay que descartar es que se esté mirando otra
 * carpeta.
 *
 * ## Por qué recibe el nombre del proyecto
 *
 * Porque sin él **mentía**, y justo en la línea que existe para no
 * mentir. `outputBasename()` sin argumento se cae a `projectBasename()`,
 * que es el nombre del **directorio**; el fichero real se llama como el
 * proyecto dice llamarse en su manifiesto. Sobre una copia de
 * `example-express` en una carpeta `api/`, la traza anunciaba
 * `api.postman_collection.json` y el CLI escribía
 * `sample-express.postman_collection.json` tres líneas más abajo.
 *
 * Quien la imprime todavía no ha cargado la configuración —esa es la
 * gracia de imprimirla antes—, así que el nombre es opcional: sin él se
 * dice que aún no se sabe, en vez de inventarse uno.
 */
export function describeDiscoveredPaths(projectName?: string): string {
  const d = discover();
  const coleccion = projectName
    ? join(outputDir(), `${outputBasename(projectName)}.json`)
    : `${outputDir()}/<nombre-del-proyecto>.postman_collection.json`;
  return [
    `  · Package root:   ${d.packageRoot}`,
    `  · Project root:   ${d.projectRoot ?? "(not found)"}`,
    `  · Routes dir:     ${routesDir() ?? "(not found)"}`,
    `  · Requests dir:   ${requestsDir() ?? "(not found)"}`,
    `  · Output dir:     ${outputDir()}`,
    `  · Collection:     ${coleccion}`,
  ].join("\n");
}