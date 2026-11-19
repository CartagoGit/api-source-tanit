/**
 * Explicit project context resolution.
 *
 * This is the stateless alternative to the retired `paths.service` singleton
 * (r00010 S2, 2026-09-03), which cached the root once per process. Each call
 * returns a new object, so two projects analyzed concurrently do not overwrite
 * each other.
 *
 * See p00017 for the full walkthrough: the stateful facade was definitively
 * removed in r00010, and this is the only resolver left.
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

// `findRepoRoot`, not `repoRoot`: this module ends up INSIDE the compiled
// binary, where files live in `/$bunfs/root/` and there is no `package.json`
// to find. Plan B there is the module's own directory, which is what existed
// before the helper was created.
const PACKAGE_ROOT = findRepoRoot(import.meta.url) ?? moduleDir(import.meta.url);

/**
 * Builds a project context.
 *
 * Root priority: explicit parameter → `--project-root` in argv →
 * `POSTMAN_PROJECT_ROOT` in env. Throws if none is present because continuing
 * with a guessed root produces empty collections without explaining why (this
 * was exactly the CLI bug with `--project-root`).
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

/** Conventional project subdirectories. */
export function projectDirs(context: IProjectContext): IProjectDirs {
  return {
    routes: join(context.projectRoot, "routes"),
    app: join(context.projectRoot, "app"),
    requests: join(context.projectRoot, "app", "Http", "Requests"),
  };
}

/** Absolute path from a project-relative path. */
export function fromProjectRoot(context: IProjectContext, relPath: string): string {
  return join(context.projectRoot, relPath);
}

/**
 * Path relative to the project, in POSIX format.
 *
 * Previously this used `normalized.startsWith(context.projectRoot)`, but
 * `startsWith` does not understand segment boundaries: `/home/u/api-secret`
 * falsely matches `/home/u/api` (x00022, audit 2026-09-04). It now uses the
 * same canonical formula as
 * `packages/core/helpers/path-containment.helper.ts`: `relative()` plus the
 * `..${sep}` / absolute prefix guard.
 *
 * If `absPath` is exactly the project root, return the empty string to
 * preserve the idempotence of `fromProjectRoot ∘ toProjectRelative`.
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

/** Does this project subdirectory exist? */
export function hasProjectDir(context: IProjectContext, relPath: string): boolean {
  return existsSync(join(context.projectRoot, relPath));
}

function basenameOf(path: string): string {
  return path.split(sep).filter(Boolean).pop() ?? "unnamed";
}
