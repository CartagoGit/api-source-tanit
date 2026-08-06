/**
 * Resolución explícita del contexto de un proyecto.
 *
 * Es la alternativa sin estado a `paths.service`, que cachea la raíz una
 * vez por proceso. Aquí cada llamada devuelve un objeto nuevo, así que
 * dos proyectos analizados a la vez no se pisan.
 *
 * `paths.service` sigue existiendo como fachada para el CLI y los
 * consumidores que aún no reciben contexto; internamente resuelve lo
 * mismo. Ver p00017.
 */
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type {
  IProjectContext,
  IProjectDirs,
} from "../contract/project-context.interface.js";
import { moduleDir } from "../helper/module-path.helper.js";

/** Entradas de las que se puede derivar el contexto. */
export interface IResolveContextOptions {
  /** Raíz del proyecto. Si falta, se deduce de `argv` o `env`. */
  readonly projectRoot?: string | undefined;
  /** Directorio de salida. Si falta, `<raíz>/build`. */
  readonly outputDir?: string | undefined;
  /** `process.argv` inyectable, para poder testear sin tocar el global. */
  readonly argv?: ReadonlyArray<string>;
  /** `process.env` inyectable, por el mismo motivo. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

const PACKAGE_ROOT = resolve(moduleDir(import.meta.url), "..");

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
      join(projectRoot, "build"),
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

/** Ruta relativa al proyecto, en formato POSIX. */
export function toProjectRelative(context: IProjectContext, absPath: string): string {
  const normalized = resolve(absPath);
  if (!normalized.startsWith(context.projectRoot)) return normalized;
  return normalized.slice(context.projectRoot.length + 1).split(sep).join("/");
}

/** ¿Existe este subdirectorio del proyecto? */
export function hasProjectDir(context: IProjectContext, relPath: string): boolean {
  return existsSync(join(context.projectRoot, relPath));
}

function readFlag(argv: ReadonlyArray<string>, name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  return argv[index + 1];
}

function basenameOf(path: string): string {
  return path.split(sep).filter(Boolean).pop() ?? "unnamed";
}
