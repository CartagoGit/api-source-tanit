/**
 * Resolución de rutas de salida a partir de un `IProjectContext` explícito.
 *
 * Sustituye a las funciones de `paths.service` que la fachada con estado
 * exponía — `outputDir`, `outputCollectionPath`, `outputEnvironmentPath`,
 * `describeDiscoveredPaths`—. Aquí todas reciben el contexto como
 * argumento: no leen globales, no cachean nada, y dos llamadas en el
 * mismo proceso con contextos distintos no se pisan.
 *
 * El singleton de `paths.service` sigue existiendo para los pocos
 * consumidores que aún no reciben contexto (S2 los migra). Este helper
 * no importa de ahí ni comparte estado con él.
 *
 * Precedencia del directorio de salida (mismas reglas que
 * `outputDir(context?)` antes, sin el caché):
 *
 *   1. CLI `--output-dir <path>` en argv.
 *   2. CLI `--output <file>` en argv → dirname del fichero.
 *   3. Env `POSTMAN_OUTPUT_DIR`.
 *   4. `context.outputDir` — lo que `resolveProjectContext` ya resolvió.
 *
 * El helper es **puro en sus argumentos**. `process.argv` y `process.env`
 * solo se leen como valores por defecto de los parámetros; el que llama
 * puede inyectar otros para testear sin tocar globales. Hay dos globales
 * que se siguen leyendo de `process.env` directamente (y no como
 * parámetro) porque cambiarlo está fuera de este slice:
 *
 *   - `POSTMAN_OUTPUT_BASENAME` → `outputBasename`.
 *   - `POSTMAN_CONTAIN_ROOT` → la guarda de contención en `ensureDir`.
 *
 * Mover ambos a argumento es trivial; ver `// TODO r00011+` abajo.
 */
import { existsSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import type { IProjectContext } from "../../contracts/interfaces/core/project-context.interface.js";
import { CONTAINMENT_ROOT_VAR } from "../../contracts/constants/core/runtime-limits.constant.js";
import { projectDirs } from "./project-context.service.js";

/**
 * Directorio donde se escriben los artefactos, con la misma precedencia
 * que tenía `outputDir(context?)` antes.
 *
 * Aceptar `argv` y `env` como parámetros —en lugar de leer
 * `process.argv` y `process.env`— es lo que permite testear la
 * precedencia sin tocar el proceso. Los valores por defecto siguen
 * siendo los globales para que los call sites existentes no cambien.
 *
 * `context` es opcional a propósito: cuando un comando se lanza sin
 * contexto de proyecto (la rama `catch` de `validate-json`, que corre
 * solo con el JSON ya generado), el helper cae a la resolución por
 * `argv` / `env`. Mantener esa puerta abierta es el comportamiento
 * histórico y no introduce un singleton: el helper sigue siendo puro
 * respecto a sus argumentos, y solo lee los globales cuando no le
 * pasan contexto.
 */
export function resolveOutputDir(
  context: IProjectContext | undefined,
  argv: ReadonlyArray<string> = process.argv,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  // 1. CLI `--output-dir <path>`.
  //    Se distingue "no está" de "está con valor vacío": `argv[i + 1]`
  //    existe pero no es un valor (empieza por `--`) se ignora, igual
  //    que hace `readFlag` para no comerse el flag siguiente.
  const outputDirIdx = argv.indexOf("--output-dir");
  if (outputDirIdx !== -1) {
    const value = argv[outputDirIdx + 1];
    if (value !== undefined && !value.startsWith("--")) return resolve(value);
  }

  // 2. CLI `--output <file>` → su directorio padre.
  //    "Escribe este fichero exacto": la ruta es lo que el usuario
  //    escribió, así que la carpeta de salida es su `dirname`.
  const outputIdx = argv.indexOf("--output");
  if (outputIdx !== -1) {
    const value = argv[outputIdx + 1];
    if (value !== undefined && !value.startsWith("--")) {
      return resolve(dirname(value));
    }
  }

  // 3. Env `POSTMAN_OUTPUT_DIR`.
  const envDir = env["POSTMAN_OUTPUT_DIR"];
  if (envDir) return resolve(envDir);

  // 4. Si hay contexto, lo que ya resolvió `resolveProjectContext`
  //    cuando se construyó: ese resuelve `--output-dir` y
  //    `POSTMAN_OUTPUT_DIR` también, así que aquí solo llegamos si no
  //    estaba ninguno y el contexto se quedó con su valor por defecto.
  if (context) return context.outputDir;

  // 5. Sin contexto y sin flags no podemos deducir la carpeta de salida
  //    —el helper ya probó CLI, `--output` y env— así que fallamos con
  //    un mensaje accionable. Antes esto caía a `process.cwd()`, que la
  //    regla universal §6 prohíbe en engines.
  throw new Error(
    "No se pudo determinar la carpeta de salida. " +
      "Pasa `--output-dir <ruta>` y/o `--project-root <ruta>`, o define " +
      "las variables de entorno equivalentes.",
  );
}

/**
 * Nombre base del JSON de salida (sin la extensión).
 *
 * Prioridad: `POSTMAN_OUTPUT_BASENAME` en `process.env` → `projectName`
 * → `context.projectBasename`.
 *
 * `POSTMAN_OUTPUT_BASENAME` se lee del entorno **del proceso** a
 * propósito: es un override global del proyecto, no un argumento del
 * comando. Parametrizarlo no aporta nada porque nadie lo inyecta desde
 * fuera del CLI, y `generate.script.ts` lo reescribe justo antes de
 * llamar (cuando se pasa `--basename`). Moverlo a argumento entra en
 * r00011+ si alguien lo necesita para testeo fino.
 *
 * TODO r00011+: aceptar `env` opcional si hace falta para tests sin
 * mutar `process.env`.
 */
function outputBasename(
  context: IProjectContext | undefined,
  projectName?: string,
): string {
  const env = process.env["POSTMAN_OUTPUT_BASENAME"];
  if (env) {
    return env.endsWith(".postman_collection")
      ? env
      : `${env}.postman_collection`;
  }
  const base = projectName?.trim() || context?.projectBasename || "postman";
  return `${base}.postman_collection`;
}

/**
 * Garantiza que el directorio existe, con la guarda de contención del
 * plugin MCP.
 *
 * La contención la sigue poniendo el plugin al lanzar (`POSTMAN_CONTAIN_ROOT`).
 * Moverla a argumento del helper es trivial — un parámetro más que
 * defaulta a `process.env[CONTAINMENT_ROOT_VAR]`— pero el comportamiento
 * externo no cambia, así que también queda para r00011+.
 */
async function ensureOutputDir(
  context: IProjectContext | undefined,
  argv: ReadonlyArray<string>,
  env: Readonly<Record<string, string | undefined>>,
): Promise<string> {
  const fs = await import("node:fs/promises");
  const dir = resolveOutputDir(context, argv, env);

  const contain = process.env[CONTAINMENT_ROOT_VAR];
  if (contain) {
    const { ensureInsideAny } = await import("../helpers/path-containment.helper.js");
    const roots = contain.split(delimiter).filter((r) => r.length > 0);
    const check = await ensureInsideAny(roots, dir);
    if (!check.ok) {
      // Se comprueba justo antes de crear, no al leer el flag: entre una
      // cosa y la otra `resolveOutputDir()` aplica cuatro reglas de
      // precedencia, y validar la de entrada dejaría fuera las otras.
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
  return dir;
}

/**
 * Ruta absoluta al JSON principal. Crea el directorio si no existe.
 *
 * Acepta `argv` y `env` igual que `resolveOutputDir` para que tests y
 * procesos de vida larga puedan inyectar el contexto sin mutar el
 * proceso. Por defecto son los globales.
 */
export async function outputCollectionPath(
  context: IProjectContext | undefined,
  projectName?: string,
  argv: ReadonlyArray<string> = process.argv,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<string> {
  const dir = await ensureOutputDir(context, argv, env);
  return join(dir, `${outputBasename(context, projectName)}.json`);
}

/**
 * Ruta absoluta al environment Postman para un entorno dado.
 *
 * El nombre del environment se slugifica igual que antes: NFD →
 * quitar diacríticos → kebab-case → trim de guiones. Quien necesita el
 * comportamiento original lo hace pasando el `projectName` ya
 * normalizado.
 */
export async function outputEnvironmentPath(
  context: IProjectContext | undefined,
  envName: string,
  projectName?: string,
  argv: ReadonlyArray<string> = process.argv,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<string> {
  const dir = await ensureOutputDir(context, argv, env);
  const base = (projectName?.trim() || context?.projectBasename || "postman");
  const slug = envName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return join(dir, `${base}.${slug}.postman_environment.json`);
}

/**
 * La traza que el CLI imprime antes de escanear, en texto.
 *
 * Sin nombre de proyecto dice `<nombre-del-proyecto>` en lugar de
 * inventarse uno: la traza existe para descartar que se esté mirando
 * la carpeta equivocada, y mentir ahí la hace peor que no decir nada.
 *
 * Las carpetas `routes` y `requests` que aparecen son **del proyecto
 * que se escanea**, derivadas con `projectDirs(context)`. Esa parte es
 * la heurística heredada del camino Laravel; un scanner moderno
 * resuelve sus propias rutas, pero la traza del CLI las sigue
 * mostrando porque a una persona le sirve ver si existen.
 */
export function describeDiscoveredPaths(
  context: IProjectContext,
  projectName?: string,
  argv: ReadonlyArray<string> = process.argv,
): string {
  const dirs = projectDirs(context);
  const outputDir = resolveOutputDir(context, argv);
  const coleccion = projectName
    ? join(outputDir, `${outputBasename(context, projectName)}.json`)
    : `${outputDir}/<nombre-del-proyecto>.postman_collection.json`;
  return [
    `  · Package root:   ${context.packageRoot}`,
    `  · Project root:   ${context.projectRoot}`,
    `  · Routes dir:     ${dirs.routes}`,
    `  · Requests dir:   ${dirs.requests}`,
    `  · Output dir:     ${outputDir}`,
    `  · Collection:     ${coleccion}`,
  ].join("\n");
}

// Sin la rama `(not found)`: con contexto explícito `projectRoot` siempre
// existe, y mostrar `(not found)` cuando no había raíz era un síntoma
// del singleton que ya no puede aparecer.
