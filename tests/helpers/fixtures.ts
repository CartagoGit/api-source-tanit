/**
 * Helpers for creating filesystem fixtures in tests.
 *
 * `mkFixtureSync` accepts a tree of files { path: content } and
 * writes it under a tmpdir. It returns the absolute path.
 *
 * This enables fast unit tests without needing a full project on
 * disk.
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { cp as cpAsync, rm as rmAsync } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import { OUTPUT_DIR_NAME } from "../../packages/contracts/constants/core/postman.constant";

export type FixtureTree = Record<string, string>;

/**
 * Creates a temporary fixture and returns its absolute path.
 *
 * Example:
 *   const root = mkFixtureSync({
 *     "package.json": `{"name": "demo"}`,
 *     "src/index.ts": `console.log("hi")`,
 *   });
 */
export function mkFixtureSync(tree: FixtureTree): string {
  const base = mkdtempSync(join(tmpdir(), "export-to-postman-test-"));
  for (const [rel, content] of Object.entries(tree)) {
    const abs = join(base, rel);
    const dir = dirname(abs);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(abs, content, "utf8");
  }
  return base;
}

/**
 * Cleans up a fixture created with `mkFixtureSync`.
 */
export function rmFixtureSync(root: string): void {
  if (existsSync(root)) {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * High-level helper: runs `fn` with a temporary fixture and cleans
 * up afterwards.
 */
export function withFixture<T>(tree: FixtureTree, fn: (root: string) => T): T {
  const root = mkFixtureSync(tree);
  try {
    return fn(root);
  } finally {
    rmFixtureSync(root);
  }
}

/**
 * Async version of `withFixture`.
 */
export async function withFixtureAsync<T>(
  tree: FixtureTree,
  fn: (root: string) => Promise<T>,
): Promise<T> {
  const root = mkFixtureSync(tree);
  try {
    return await fn(root);
  } finally {
    rmFixtureSync(root);
  }
}

/**
 * Copies a project from `examples/` to a temporary location **without
 * anything a previous run generated**.
 *
 * A bare `cp` is not enough, and the failure does not show up until it
 * bites. The examples are real projects the CLI is run against, so
 * they end up with an `export-to-postman/` folder inside. It is in
 * `.gitignore`, not in the repo — but it is **on disk**, and `cp`
 * copies it.
 *
 * `exit-codes.test.ts` paid the price: it created a read-only project
 * with `chmod 0555` on the root to check that `generate` fails when
 * it cannot write. With the output folder already copied — and with
 * its permissions, 0755 — `generate` happily wrote inside and exited
 * 0. The test only passed on a machine where nobody had run the CLI
 * on the examples; on anyone who had run `bun run build`, it failed
 * for no apparent reason.
 *
 * This is what separates a test from one that depends on luck.
 */
export async function copyExampleClean(source: string, destination: string): Promise<void> {
  await cpAsync(source, destination, { recursive: true });
  await rmAsync(join(destination, OUTPUT_DIR_NAME), { recursive: true, force: true });
}
