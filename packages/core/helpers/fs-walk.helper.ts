/**
 * Recursive directory walk for the scanners.
 *
 * Four scanners repeated the same `readdir` call with a cast to skip
 * the types of `Dirent`. That cast silences real errors, so the walk
 * lives here, only once, with honest types.
 *
 * The walk is **manual**, folder by folder, and not a
 * `readdir(root, { recursive: true })`. The difference matters: the
 * recursive version is a single call, so as soon as something inside
 * fails —a symlink loop, a subfolder without permission— the **entire**
 * walk is lost, including what had already been found. Measured: an
 * Express project with a `src/self -> .` returned 0 files even though
 * `server.js` was right there, and the collection came out empty
 * without saying why.
 *
 * And loops aren't rare: Capistrano deploys with a `current -> .`,
 * monorepos link packages to each other, and `node_modules/.bin` is
 * full of links.
 *
 * Walking by hand, a problematic directory only loses itself. And it
 * keeps a record of the real paths already visited, which is what cuts
 * the cycles.
 */
import { readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { ICollectFilesOptions } from "../../contracts/interfaces/core/helpers.interface.js";

/** Directory entry. */
interface IDirentLike {
  readonly name: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

/** Directories that never contain scanned project code. */
const ALWAYS_SKIPPED = new Set([
  "node_modules",
  ".git",
  "vendor",
  "__pycache__",
  "dist",
  "build",
  ".venv",
  "venv",
  ".cache",
]);

/**
 * Maximum depth. A real project doesn't nest code 40 levels deep; if we
 * get here, something is wrong, and it's better to stop than walk the
 * whole disk.
 */
const MAX_DEPTH = 40;

/**
 * Absolute paths of all files under `root` (recursive) whose name
 * passes the filter.
 *
 * Never throws. An unreadable directory or a link cycle are skipped and
 * the rest of the tree is still walked — which is what this function
 * promised and didn't deliver.
 */
export async function collectFiles(
  root: string,
  matches: (fileName: string) => boolean,
  options: ICollectFilesOptions = {},
): Promise<string[]> {
  const skipVendor = options.skipVendorDirs !== false;
  const out: string[] = [];
  /** Real paths already visited: this is what cuts the cycles. */
  const visited = new Set<string>();

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return;

    // `realpath` resolves links: two different paths pointing to the
    // same place are visited only once.
    let real: string;
    try {
      real = await realpath(dir);
    } catch {
      return;
    }
    if (visited.has(real)) return;
    visited.add(real);

    let entries: IDirentLike[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // No permission, or it disappeared while we were walking. We lose
      // this folder and only this one.
      return;
    }

    for (const entry of entries) {
      const full = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (skipVendor && ALWAYS_SKIPPED.has(entry.name)) continue;
        await walk(full, depth + 1);
        continue;
      }

      if (entry.isFile()) {
        if (matches(entry.name)) out.push(full);
        continue;
      }

      // A symbolic link is neither a file nor a directory for `Dirent`:
      // we have to resolve it. Projects link code more often than it
      // seems, and skipping them left out files that do count.
      if (entry.isSymbolicLink()) {
        try {
          const target = await realpath(full);
          const targetEntries = await readdir(target, { withFileTypes: true }).then(
            () => true,
            () => false,
          );
          if (targetEntries) {
            if (skipVendor && ALWAYS_SKIPPED.has(entry.name)) continue;
            await walk(full, depth + 1);
          } else if (matches(entry.name) && !visited.has(target)) {
            visited.add(target);
            out.push(full);
          }
        } catch {
          // Broken link: ignored.
        }
      }
    }
  }

  await walk(root, 0);
  return out;
}

/**
 * Same as `collectFiles` over multiple roots, without duplicates and
 * skipping those that don't exist.
 */
export async function collectFilesFrom(
  roots: ReadonlyArray<string>,
  matches: (fileName: string) => boolean,
  options: ICollectFilesOptions = {},
): Promise<string[]> {
  const seen = new Set<string>();
  for (const root of roots) {
    for (const file of await collectFiles(root, matches, options)) seen.add(file);
  }
  return [...seen];
}

/** Reusable filter: JS/TS source code files, without tests or .d.ts. */
export function isSourceJsTsFile(name: string): boolean {
  if (!/\.(ts|js|mjs|cjs|tsx|jsx)$/.test(name)) return false;
  if (name.endsWith(".d.ts")) return false;
  if (name.includes(".test.") || name.includes(".spec.")) return false;
  return name !== "vite.config.ts" && name !== "vitest.config.ts";
}
