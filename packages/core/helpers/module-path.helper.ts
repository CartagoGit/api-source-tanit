/**
 * Directory of the current module, in a portable way.
 *
 * `import.meta.dir` only exists in Bun. The package declares
 * `engines.node >= 20` and the tests run under vitest, so using it
 * left both with `undefined` — and `resolve(undefined, "..")` does not
 * fail with a useful message, it fails with a `TypeError` on `paths[0]`
 * 3 layers away from the actual site.
 *
 * `import.meta.url` is an ESM standard and works in Bun, in Node, and
 * under vitest. `fileURLToPath` is what turns it into a valid system
 * path also on Windows (where `new URL(...).pathname` would return
 * `/C:/…`).
 *
 * @example
 * const PACKAGE_ROOT = resolve(moduleDir(import.meta.url), "..");
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Folder containing the module whose `import.meta.url` is passed. */
export function moduleDir(importMetaUrl: string): string {
  return dirname(fileURLToPath(importMetaUrl));
}

/**
 * Repo/package root: walks up from the module until it finds a
 * `package.json`.
 *
 * Before, each script counted its own `".."` to the root. That works
 * until the file moves to a different folder, and then `PACKAGE_ROOT`
 * points elsewhere **without failing**: the script simply does not find
 * anything and says "no proposals found". It happened with four gates
 * at once when reorganizing into `packages/`.
 *
 * Counting levels is coupling a file to its depth in the tree.
 * Looking for the marker is not.
 */
export function repoRoot(importMetaUrl: string): string {
  const found = findRepoRoot(importMetaUrl);
  if (found) return found;
  throw new Error(
    `No package.json found walking up from ${moduleDir(importMetaUrl)}`,
  );
}

/**
 * Like `repoRoot()`, but returns `null` instead of throwing.
 *
 * Production code needs this: inside the compiled binary the modules
 * live in a virtual file system (`/$bunfs/root/`) where there is no
 * `package.json`, so there is no root to find. Throwing there crashes
 * the whole binary at startup — it happened when this helper was
 * introduced, and the binary-without-runtime test was what caught it.
 *
 * Rule: gates and tests use `repoRoot()`, which throws because a
 * failure there is a repo failure. Code that ends up inside the binary
 * uses this one and has a plan B.
 */
export function findRepoRoot(importMetaUrl: string): string | null {
  let dir = moduleDir(importMetaUrl);
  for (let up = 0; up < 12; up++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

