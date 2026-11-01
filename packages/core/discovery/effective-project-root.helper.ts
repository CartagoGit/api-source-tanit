/**
 * Effective project root — a00014 S1.
 *
 * This helper centralizes what Express, Hono, NestJS, and Next.js already did
 * inline with `expressSearchRoot` / `honoEffectiveSearchRoot` /
 * `nestjsEffectiveSearchRoot` / `nextjsEffectiveSearchRoot`: resolve the root
 * where a scanner should search for its sources from
 * `match.frameworkSearchRoot`, and return `match.projectRoot` when that field
 * is absent.
 *
 * Unlike the inline implementations, **no scanner can accidentally ignore
 * `frameworkSearchRoot`**. In a monorepo, the scanner previously walked the
 * entire workspace tree instead of the framework subdirectory, returning empty
 * paths or paths contaminated by other packages. With this helper, all 21
 * scanners use the same primitive, and the `lint:effective-project-root` gate
 * rejects any scanner that still reads `match.projectRoot` directly.
 *
 * ## Contract
 *
 * - `effectiveProjectRoot(match)` and `effectiveSearchRoot(match)` are aliases
 *   of the same function. The latter exposes the name already used by scanner
 *   callers (Hono, NestJS, and Next.js); they share an implementation because
 *   their semantics are one and the same.
 *
 * - If `match.frameworkSearchRoot` is `undefined`, `null`, or the empty string,
 *   return `match.projectRoot` **unchanged**. Flat projects that do not
 *   populate `frameworkSearchRoot` behave exactly as before.
 *
 * - If `frameworkSearchRoot` is absolute (starts with `/` on POSIX or a drive
 *   letter on Windows), **throw**. The `IProjectMatch.frameworkSearchRoot`
 *   contract declares it "relative to projectRoot and never absolute"; an
 *   implementation that accepted and returned absolute paths verbatim would
 *   reopen the containment leak closed by x00022 (a manifest pointing to
 *   `/etc` or `\\server\share` would stop being a rare exception and become the
 *   helper's backdoor). If shared artifacts outside the project are ever
 *   needed, that must be a separate explicit field, not a reinterpretation of
 *   `frameworkSearchRoot`. (a00014 S4)
 *
 * - Otherwise (relative), join `projectRoot` with `frameworkSearchRoot` using
 *   `path.resolve`, and verify that the result remains within `projectRoot`.
 *   The check uses `relative()` plus the `..${sep}` / `..` / absolute-path
 *   prefix guards—the SAME canonical containment formula used by
 *   `toProjectRelative` and `path-containment.helper` (x00022)—instead of
 *   `startsWith(root + sep)`: a string prefix would allow `/tmp/bad-root` when
 *   the root is `/tmp/root`, and maintaining two algorithms that define
 *   "inside" differently is the seed of the next drift (a00014 S4).
 *
 * - If the check fails, **throw** an `Error` containing the framework,
 *   `projectRoot`, and `frameworkSearchRoot` that caused it. Do not hide the
 *   failure or return the root unchecked. A scanner that ignores the
 *   containment check has the same bug we are closing, only quieter.
 *
 * - `rawProjectRoot(match)` returns `match.projectRoot` **as provided**. It
 *   exists for places where a scanner needs the user's root—the `projectRoot:`
 *   returned when building an `IProjectMatch`, or a `join` with a
 *   `route.sourceFile` already relative to `projectRoot`—and the gate requires
 *   those sites to go through this helper instead of reading
 *   `match.projectRoot` directly.
 *
 * ## Why it is pure
 *
 * The helper does not read `process.cwd()`, touch the file system, or hold
 * state. It is a deterministic function of its arguments. This allows the
 * contract to be tested without fixtures in
 * `tests/core/effective-project-root.helper.spec.ts` and keeps the universal
 * `no process.cwd / process.env` lint rule silent.
 *
 * @see ./scan-root.helper.ts for `effectiveScanRoot`, the mirror of this helper
 *   for the "filesystem root to read" case rather than the "root reported by
 *   the scanner" case.
 * @see ../../../scripts/gates/lint-effective-project-root.script.ts for the
 *   gate that rejects incompatible scanners.
 */
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { IProjectMatch } from "../../contracts/interfaces/core/scanner.interface.js";

/**
 * Effective project root, honoring `frameworkSearchRoot`.
 *
 * - Without `frameworkSearchRoot` → `match.projectRoot` (for compatibility
 *   with flat projects and tests that do not populate the field).
 * - With `frameworkSearchRoot` → `path.resolve(projectRoot,
 *   frameworkSearchRoot)`, provided the result remains within `projectRoot`.
 *
 * Throws a clear `Error` if `frameworkSearchRoot` points outside `projectRoot`
 *   (for example, because it contains `..` or is absolute).
 */
export function effectiveProjectRoot(match: IProjectMatch): string {
  return resolveProjectRoot(match);
}

/**
 * Alias for `effectiveProjectRoot` with the name Hono, NestJS, and Next.js
 * already used in their inline helpers. A scanner migrating from a local helper
 * to the central one can keep calling its preferred function without another
 * change.
 *
 * The behavior is identical to `effectiveProjectRoot`: the same resolution,
 * guard, and error. Only the name changes to preserve existing call sites.
 */
export function effectiveSearchRoot(match: IProjectMatch): string {
  return resolveProjectRoot(match);
}

/**
 * The actual project root, unchanged.
 *
 * Returns `match.projectRoot` as provided. This lets a scanner that needs the
 * user's root—the `projectRoot:` of the `IProjectMatch` returned to the
 * orchestrator, or a `join` with a `route.sourceFile` already relative to
 * `projectRoot`—go through a helper instead of reading `match.projectRoot`
 * directly. The `lint:effective-project-root` gate can then control all
 * references to `match.projectRoot` through one allowlist.
 */
export function rawProjectRoot(match: IProjectMatch): string {
  return match.projectRoot;
}

/**
 * Single implementation for both guarded exports. It is intentionally not
 * exported: adding a third function with identical behavior would dilute the
 * contract. If a future caller needs another variant, it should build on
 * this logic.
 */
function resolveProjectRoot(match: IProjectMatch): string {
  const root = match.projectRoot;
  const requested = match.frameworkSearchRoot;
  if (requested === undefined || requested === null || requested === "") {
    return root;
  }
  // Absolute: NO. The contract (`IProjectMatch.frameworkSearchRoot`) declares
  // it "relative to projectRoot and never absolute"; returning it verbatim was
  // the containment backdoor this helper just closed. Reject it with the same
  // explicit error used for an escape through `..`, so the offending manifest
  // remains visible.
  if (isAbsolute(requested)) {
    throw new Error(
      `frameworkSearchRoot inválido para framework "${match.framework}": ` +
        `"${requested}" es una ruta absoluta y el contrato la requiere ` +
        `relativa a projectRoot ("${root}")`,
    );
  }
  const resolved = resolve(root, requested);
  // Single containment check: the SAME pure formula as toProjectRelative
  // (x00022), rather than comparing string prefixes with
  // startsWith(root + sep). Two algorithms defining "inside" differently are
  // the seed of the next drift.
  const rel = relative(root, resolved);
  // rel === "" is the root itself (`frameworkSearchRoot = "."`), which is
  // inside. Anything escaping starts with "..", is exactly "..", or is
  // absolute (a Windows drive crossing).
  const inside =
    rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
  if (!inside) {
    throw new Error(
      `frameworkSearchRoot inválido para framework "${match.framework}": ` +
        `"${requested}" resuelto a "${resolved}" queda fuera de ` +
        `projectRoot "${root}"`,
    );
  }
  return resolved;
}
