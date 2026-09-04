/**
 * Resolución explícita del contexto de un proyecto.
 *
 * Es la alternativa sin estado al singleton retirado de `paths.service`
 * (r00010 S2, 2026-09-03), que cacheaba la raíz una vez por proceso.
 * Aquí cada llamada devuelve un objeto nuevo, así que dos proyectos
 * analizados a la vez no se pisan.
 *
 * Ver p00017 para el recorrido completo: la fachada con estado cayó
 * definitivamente en r00010 y este es el único resolutor que queda.
 */
import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  IProjectContext,
  IProjectDirs,
} from "../../contracts/interfaces/core/project-context.interface.js";
import { findRepoRoot, moduleDir } from "../helpers/module-path.helper.js";
import { OUTPUT_DIR_NAME } from "../../contracts/constants/core/postman.constant.js";
import { readFlag } from "../helpers/argv.helper.js";
import type { IResolveContextOptions } from "../../contracts/interfaces/core/discovery.interface.js";

// `findRepoRoot` y no `repoRoot`: este módulo acaba DENTRO del binario
// compilado, donde los ficheros viven en `/$bunfs/root/` y no hay
// ningún `package.json` que encontrar. Allí el plan B es la carpeta del
// propio módulo, que es lo que había antes de que existiera el helper.
const PACKAGE_ROOT = findRepoRoot(import.meta.url) ?? moduleDir(import.meta.url);

/**
 * Construye el contexto de un proyecto.
 *
 * Prioridad de la raíz: parámetro explícito → `--project-root` en argv →
 * `POSTMAN_PROJECT_ROOT` en env. Lanza si no hay ninguna, porque
 * continuar con una raíz adivinada produce colecciones vacías sin decir
 * por qué (fue exactamente el bug del CLI con `--project-root`).
 */
export function resolveProjectContext(
  options: IResolveContextOptions = {},
): IProjectContext {
  const argv = options.argv ?? process.argv;
  const env = options.env ?? process.env;

  const root =
    options.projectRoot ??
    readFlag(argv, "--project-root") ??
    env["POSTMAN_PROJECT_ROOT"];

  if (!root) {
    throw new Error(
      "No se pudo determinar la raíz del proyecto. Pasa `--project-root <ruta>` " +
        "o define POSTMAN_PROJECT_ROOT.",
    );
  }

  const projectRoot = resolve(root);
  const outputDir = resolve(
    options.outputDir ??
      readFlag(argv, "--output-dir") ??
      env["POSTMAN_OUTPUT_DIR"] ??
      join(projectRoot, OUTPUT_DIR_NAME),
  );

  return {
    projectRoot,
    packageRoot: PACKAGE_ROOT,
    projectBasename: basenameOf(projectRoot),
    outputDir,
  };
}

/** Subdirectorios convencionales del proyecto. */
export function projectDirs(context: IProjectContext): IProjectDirs {
  return {
    routes: join(context.projectRoot, "routes"),
    app: join(context.projectRoot, "app"),
    requests: join(context.projectRoot, "app", "Http", "Requests"),
  };
}

/** Ruta absoluta a partir de una relativa al proyecto. */
export function fromProjectRoot(context: IProjectContext, relPath: string): string {
  return join(context.projectRoot, relPath);
}

/**
 * Ruta relativa al proyecto, en formato POSIX.
 *
 * Antes se hacía `normalized.startsWith(context.projectRoot)`, pero
 * `startsWith` no entiende de fronteras de segmento: `/home/u/api-secret`
 * matchea falsamente `/home/u/api` (x00022, audit 2026-09-04). Ahora se
 * usa la misma fórmula canónica que
 * `packages/core/helpers/path-containment.helper.ts`: `relative()` más
 * la guarda de prefijo `..${sep}` / absoluto.
 *
 * Si `absPath` es exactamente la raíz del proyecto, se devuelve la
 * cadena vacía para preservar la idempotencia `fromProjectRoot ∘
 * toProjectRelative`.
 */
export function toProjectRelative(context: IProjectContext, absPath: string): string {
  const normalized = resolve(absPath);
  if (normalized === context.projectRoot) return "";
  const rel = relative(context.projectRoot, normalized);
  const inside =
    !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
  if (!inside) return normalized;
  return rel.split(sep).join("/");
}

/** ¿Existe este subdirectorio del proyecto? */
export function hasProjectDir(context: IProjectContext, relPath: string): boolean {
  return existsSync(join(context.projectRoot, relPath));
}

function basenameOf(path: string): string {
  return path.split(sep).filter(Boolean).pop() ?? "unnamed";
}
