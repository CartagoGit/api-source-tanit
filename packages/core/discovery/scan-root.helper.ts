/**
 * Effective scan root for a scanner — a00012 S1.b.
 *
 * Before this helper, each scanner decided on its own where to read its
 * sources. Three of them (`fastify.scanner.ts`, `fiber.scanner.ts`,
 * `rust.scanner.ts`) passed `match.projectRoot` directly to
 * `collectFiles(...)`, ignoring `match.frameworkSearchRoot`: in a
 * monorepo, the scanner walked the entire workspace tree instead of the
 * framework subdirectory, returning empty paths or paths contaminated by
 * other packages.
 *
 * Hono, NestJS, and Next.js already resolved this inline with their own
 * `honoEffectiveSearchRoot` / `nestjsEffectiveSearchRoot` /
 * `effectiveSearchRoot`. This helper **centralizes** them and adds the
 * missing containment check: a `frameworkSearchRoot` containing `..`
 * must not be able to escape `projectRoot`, not even when written by a
 * manifest in the host project.
 *
 * ## Contract
 *
 * - `effectiveScanRoot(match)` and `safeScanRoot(match)` are aliases of
 *   the same function. The latter exposes a name for callers that want to
 *   make it explicit that the helper can throw when `frameworkSearchRoot`
 *   points outside `projectRoot`; both share an implementation because
 *   containment security is not optional.
 *
 * - If `match.frameworkSearchRoot` is `undefined`, `null`, or the empty
 *   string, return `match.projectRoot` **unchanged** (do not call
 *   `path.resolve` or perform any other operation). Flat projects that do
 *   not populate `frameworkSearchRoot` behave exactly as before.
 *
 * - Otherwise, join `projectRoot` with `frameworkSearchRoot` using
 *   `path.resolve`, then verify that the result remains within
 *   `projectRoot`. The check compares path segments with
 *   `.startsWith(root + sep) || === root`, which is the correct approach
 *   (a string prefix would allow `/tmp/bad-root` when the root is
 *   `/tmp/root`).
 *
 * - If the check fails, **throw** an `Error` containing the framework,
 *   `projectRoot`, and `frameworkSearchRoot` that caused it. Do not hide
 *   the failure or return the root unchecked. A scanner that ignores the
 *   containment check has the same bug we are closing, only quieter.
 *
 * ## Why it is pure
 *
 * The helper does not read `process.cwd()`, touch the file system, or
 * hold state. It is a deterministic function of its arguments, just like
 * `effectiveSearchRoot` in `nextjs.scanner.ts`. This allows the contract
 * to be tested without fixtures in
 * `tests/frameworks/scan-root-contract.spec.ts` and keeps the universal
 * `no process.cwd / process.env` lint rule silent.
 */
import { resolve, sep } from "node:path";

import type { IProjectMatch } from "../../contracts/interfaces/core/scanner.interface.js";

/**
 * The root where a scanner should search for its sources.
 *
 * - Without `frameworkSearchRoot` → `match.projectRoot` (for compatibility
 *   with flat projects and tests that do not populate the field).
 * - With `frameworkSearchRoot` → `path.resolve(projectRoot,
 *   frameworkSearchRoot)`, provided the result remains within `projectRoot`.
 *
 * Throws a clear `Error` if `frameworkSearchRoot` points outside
 * `projectRoot` (for example, because it contains `..` or is absolute).
 */
export function effectiveScanRoot(match: IProjectMatch): string {
  return resolveScanRoot(match);
}

/**
 * Alias for `effectiveScanRoot` with a name that emphasizes that the
 * helper **can throw** when the search path escapes the project root.
 * Useful when the caller wants to make the containment check explicit
 * (for example, in multi-step pipelines where the `try`/`catch` should be
 * clear).
 *
 * The behavior is identical to `effectiveScanRoot`: the same resolution,
 * guard, and error. Only the name changes so code using it can express its
 * intent.
 */
export function safeScanRoot(match: IProjectMatch): string {
  return resolveScanRoot(match);
}

/**
 * Single implementation for both public exports. It is intentionally not
 * exported: adding a third function with identical behavior would dilute
 * the contract. If a future caller needs another variant, it should build
 * on this logic.
 */
function resolveScanRoot(match: IProjectMatch): string {
  const root = match.projectRoot;
  const requested = match.frameworkSearchRoot;
  if (requested === undefined || requested === null || requested === "") {
    return root;
  }
  const resolved = resolve(root, requested);
  const inside = resolved === root || resolved.startsWith(root + sep);
  if (!inside) {
    throw new Error(
      `frameworkSearchRoot inválido para framework "${match.framework}": ` +
        `"${requested}" resuelto a "${resolved}" queda fuera de ` +
        `projectRoot "${root}"`,
    );
  }
  return resolved;
}
