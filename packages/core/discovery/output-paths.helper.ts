/**
 * Output path resolution from an explicit `IProjectContext`.
 *
 * Replaces the functions from the retired `paths.service` singleton
 * (r00010 S2, 2026-09-03) — `outputDir`, `outputCollectionPath`,
 * `outputEnvironmentPath`, and `describeDiscoveredPaths`. All of them now
 * receive the context as an argument: they do not read globals, cache
 * anything, or overwrite each other when the same process handles different
 * contexts.
 *
 * This helper shares no state with the retired singleton and is the only
 * output route for the seven migrated CLI commands.
 *
 * Output directory precedence (the same rules as the former
 * `outputDir(context?)`, without the cache):
 *
 *   1. CLI `--output-dir <path>` in argv.
 *   2. CLI `--output <file>` in argv → the file's directory.
 *   3. Env `POSTMAN_OUTPUT_DIR`.
 *   4. `context.outputDir` — the value already resolved by
 *      `resolveProjectContext`.
 *
 * The helper is **pure with respect to its arguments**. `process.argv` and
 * `process.env` are read only as parameter defaults; the caller can inject
 * different values for tests without mutating globals. Two globals are still
 * read directly from `process.env` rather than as parameters because moving
 * them is outside this slice:
 *
 *   - `POSTMAN_OUTPUT_BASENAME` → `outputBasename`.
 *   - `POSTMAN_CONTAIN_ROOT` → the containment guard in `ensureDir`.
 *
 * Moving either one to an argument is trivial; see `// TODO r00011+` below.
 */
import { existsSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import type { IProjectContext } from "../../contracts/interfaces/core/project-context.interface.js";
import { CONTAINMENT_ROOT_VAR } from "../../contracts/constants/core/runtime-limits.constant.js";
import { projectDirs } from "./project-context.service.js";

/**
 * Directory where artifacts are written, using the same precedence as the
 * former `outputDir(context?)`.
 *
 * Accepting `argv` and `env` as parameters instead of reading `process.argv`
 * and `process.env` makes it possible to test precedence without mutating
 * the process. Default values remain global so existing call sites do not
 * change.
 *
 * `context` is intentionally optional: when a command runs without a project
 * context (the `validate-json` `catch` branch, which runs with only the
 * generated JSON), the helper falls back to `argv` / `env` resolution.
 * Keeping this entry point preserves historical behavior without introducing
 * a singleton: the helper remains pure with respect to its arguments and only
 * reads globals when no context is supplied.
 */
export function resolveOutputDir(
  context: IProjectContext | undefined,
  argv: ReadonlyArray<string> = process.argv,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  // 1. CLI `--output-dir <path>`.
  //    Distinguish "missing" from "present with an empty value": if
  //    `argv[i + 1]` exists but is not a value (it starts with `--`), ignore
  //    it, as `readFlag` does so it does not consume the next flag.
  const outputDirIdx = argv.indexOf("--output-dir");
  if (outputDirIdx !== -1) {
    const value = argv[outputDirIdx + 1];
    if (value !== undefined && !value.startsWith("--")) return resolve(value);
  }

  // 2. CLI `--output <file>` → its parent directory.
  //    "Write this exact file": the path is what the user wrote, so the
  //    output directory is its `dirname`.
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

  // 4. If there is a context, use what `resolveProjectContext` already
  //    resolved when creating it: it also resolves `--output-dir` and
  //    `POSTMAN_OUTPUT_DIR`, so this branch is reached only when neither was
  //    present and the context kept its default value.
  if (context) return context.outputDir;

  // 5. Without a context or flags, we cannot infer the output directory
  //    —the helper has already checked the CLI, `--output`, and env— so fail
  //    with an actionable message. This previously fell back to
  //    `process.cwd()`, which universal rule §6 prohibits in engines.
  throw new Error(
    "No se pudo determinar la carpeta de salida. " +
      "Pasa `--output-dir <ruta>` y/o `--project-root <ruta>`, o define " +
      "las variables de entorno equivalentes.",
  );
}

/**
 * Base name of the output JSON (without the extension).
 *
 * Priority: `POSTMAN_OUTPUT_BASENAME` in `process.env` → `projectName` →
 * `context.projectBasename`.
 *
 * `POSTMAN_OUTPUT_BASENAME` is intentionally read from the **process**
 * environment: it is a project-wide override, not a command argument.
 * Parameterizing it adds nothing because no caller injects it outside the CLI,
 * and `generate.script.ts` rewrites it immediately before calling this helper
 * (when `--basename` is passed). Moving it to an argument belongs in r00011+
 * if anyone needs finer-grained test control.
 *
 * TODO r00011+: accept optional `env` for tests that cannot mutate
 * `process.env`.
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
 * Ensures the directory exists with the MCP plugin's containment guard.
 *
 * The plugin still sets the containment root at launch
 * (`POSTMAN_CONTAIN_ROOT`). Moving it to a helper argument is trivial — one
 * extra parameter that defaults to `process.env[CONTAINMENT_ROOT_VAR]`— but
 * external behavior does not change, so this also remains for r00011+.
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
      // Check immediately before creating the directory, not when reading
      // the flag: `resolveOutputDir()` applies four precedence rules in
      // between, and validating only the input would exclude the others.
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
 * Absolute path to the Postman environment for a given environment.
 *
 * The environment name is slugified as before: NFD → remove diacritics →
 * kebab-case → trim hyphens. Callers that need the original behavior should
 * pass an already-normalized `projectName`.
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
 * The trace the CLI prints before scanning, as text.
 *
 * Without a project name it displays `<nombre-del-proyecto>` instead of
 * inventing one: the trace is meant to rule out scanning the wrong folder,
 * and lying there is worse than saying nothing.
 *
 * The `routes` and `requests` directories shown belong to the scanned
 * project and are derived with `projectDirs(context)`. This is a heuristic
 * inherited from the Laravel path; modern scanners resolve their own paths,
 * but the CLI trace still displays them because seeing whether they exist is
 * useful.
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

// Without the `(not found)` branch: with an explicit context, `projectRoot`
// always exists, and showing `(not found)` when there was no root was a
// symptom of the retired singleton that can no longer occur.
