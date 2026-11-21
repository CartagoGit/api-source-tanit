/**
 * Building temporary projects for scanner tests.
 *
 * Before, each spec assembled its tree by hand with `mkdtemp` + `mkdir`
 * + `copyFile` line by line. Beyond being repetitive, it was brittle:
 * in `laravel-scanner.spec.ts` a `mkdir(join(dir, "artisan"))` created
 * `artisan` as a DIRECTORY and the subsequent `writeFile` blew up
 * with EISDIR.
 *
 * Here a project is declared as a `relative path → content` map and
 * the intermediate directories are created automatically.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, } from "node:path";
import { tmpdir } from "node:os";
import type { FrameworkId, IProjectMatch } from "../../packages/contracts/interfaces/core/scanner.interface";
import { scannerBundleFor } from "../../packages/frameworks/framework.registry";
import { REPO_ROOT } from "../../scripts/helpers/root.helper";


export const PACKAGE_ROOT = REPO_ROOT;

/** Temporary project on disk, with its cleanup. */
export interface ITempProject {
  /** Absolute root of the project. */
  readonly root: string;
  /** Deletes the tree. Always call in `afterAll`/`finally`. */
  cleanup(): Promise<void>;
}

/**
 * Assembles a temporary project from a path→content map.
 *
 * An empty file is declared with `""`; intermediate directories are
 * created automatically, so there is no need to list them.
 *
 * ```ts
 * const project = await createTempProject({
 *   "artisan": "",
 *   "composer.json": '{"require":{"laravel/framework":"^11.0"}}',
 *   "routes/api.php": "<?php Route::get('/health', fn () => 1);",
 * });
 * ```
 */
export async function createTempProject(
  files: Record<string, string>,
  prefix = "postman-fixture-",
): Promise<ITempProject> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  for (const [relPath, content] of Object.entries(files)) {
    const abs = join(root, relPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

/** Root of the "comprehensive" fixture for a framework. */
export function comprehensiveFixture(framework: FrameworkId): string {
  return join(PACKAGE_ROOT, "tests", "fixtures", `${framework}-comprehensive`);
}

/** Root of the smoke mini-fixture for a framework. */
export function smokeFixture(framework: FrameworkId): string {
  return join(PACKAGE_ROOT, "tests", "smoke-fixtures", `${framework}-mini`);
}

/**
 * `IProjectMatch` for a framework on a given root, using the registered
 * detector. Avoids building the match by hand in each spec, which is
 * where `artifacts: []` and other fields inconsistent with what the
 * real detector produces slipped in.
 */
export async function matchFor(
  framework: FrameworkId,
  projectRoot: string,
): Promise<IProjectMatch> {
  const bundle = scannerBundleFor(framework);
  if (!bundle) throw new Error(`framework "${framework}" no está en el scanner registry`);
  return bundle.projectScanner.resolve(projectRoot);
}

/**
 * Scans a root with the framework's registered scanner and returns the
 * routes along with the match used.
 *
 * From a00010 S2 on, `scan()` returns an `IScanResult`: the routes
 * and (when applicable) the auxiliary maps with schemas, validators
 * or structs. Consumers that only wanted the routes list ask for
 * `routes` — the rest of the `IScanResult` is preserved in `result`
 * for whoever needs it.
 */
export async function scanProject(
  framework: FrameworkId,
  projectRoot: string,
): Promise<{
  match: IProjectMatch;
  result: import("../../packages/contracts/interfaces/core/scanner.interface").IScanResult;
  routes: ReadonlyArray<import("../../packages/contracts/interfaces/core/scanner.interface").ParsedRoute>;
}> {
  const bundle = scannerBundleFor(framework);
  if (!bundle) throw new Error(`framework "${framework}" no está en el scanner registry`);
  const match = await bundle.projectScanner.resolve(projectRoot);
  const result = await bundle.routeScanner.scan(match);
  return { match, result, routes: result.routes };
}
