/**
 * The watch mode, for real: touch a file and regenerate.
 *
 * The `watcher.service.spec.ts` tests cover the pieces separately. This
 * one checks the only thing that cannot be tested with doubles: that
 * recursive `fs.watch` reaches, that the change triggers, and — most of
 * all — that **writing the collection does not trigger the watcher
 * again**. That feedback loop is infinite, and it is only visible by
 * running it.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { watchProject } from "../../packages/core/domain/watcher.service";
import { OUTPUT_DIR_NAME } from "../../packages/contracts/constants/core/postman.constant";
import type { IWatchHandle } from "../../packages/contracts/interfaces/core/domain.interface.js";

let root = "";
let handle: IWatchHandle | null = null;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "expostman-watch-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, OUTPUT_DIR_NAME), { recursive: true });
});

afterEach(async () => {
  handle?.close();
  handle = null;
  if (root) await rm(root, { recursive: true, force: true });
});

/** Waits until `check` is true, or gives up. */
async function waitFor(check: () => boolean, ms = 3000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise<void>((r) => setTimeout(r, 25));
  }
  return check();
}

describe("watchProject", () => {
  test("a change in a source file triggers onChange", { timeout: 15_000 }, async () => {
    const batches: string[][] = [];
    handle = watchProject({
      root,
      debounceMs: 50,
      onChange: (changed) => {
        batches.push([...changed]);
      },
    });

    await writeFile(join(root, "src", "users.route.ts"), "export const x = 1;\n");
    const fired = await waitFor(() => batches.length > 0);

    expect(fired, "the watcher did not react to the change").toBe(true);
    expect(batches[0]?.some((p) => p.includes("users.route.ts"))).toBe(true);
  });

  /**
   * The test that justifies all the care put into the service.
   *
   * It writes to the output folder, which is INSIDE the watched root —
   * exactly what the tool does on generate. If the watcher reacted,
   * each generation would trigger the next one and the process would
   * never stop.
   */
  test(
    "writing to the output folder does NOT trigger anything",
    { timeout: 15_000 },
    async () => {
      let calls = 0;
      handle = watchProject({
        root,
        debounceMs: 50,
        onChange: () => {
          calls++;
        },
      });

      for (let i = 0; i < 3; i++) {
        await writeFile(
          join(root, OUTPUT_DIR_NAME, `api.postman_collection.json`),
          JSON.stringify({ intento: i }),
        );
      }
      // Plenty of slack for any event to have arrived.
      await new Promise<void>((r) => setTimeout(r, 600));

      expect(calls, "the watcher fired on its own write").toBe(0);
    },
  );

  test("several saves in a row produce a single onChange", { timeout: 15_000 }, async () => {
    let calls = 0;
    handle = watchProject({
      root,
      debounceMs: 200,
      onChange: () => {
        calls++;
      },
    });

    for (let i = 0; i < 5; i++) {
      await writeFile(join(root, "src", `r${i}.ts`), `export const x = ${i};\n`);
    }
    await waitFor(() => calls > 0);
    await new Promise<void>((r) => setTimeout(r, 400));

    expect(calls).toBe(1);
  });

  test("close() stops watching", { timeout: 15_000 }, async () => {
    let calls = 0;
    handle = watchProject({
      root,
      debounceMs: 50,
      onChange: () => {
        calls++;
      },
    });
    handle.close();
    handle = null;

    await writeFile(join(root, "src", "tarde.ts"), "export const x = 1;\n");
    await new Promise<void>((r) => setTimeout(r, 400));

    expect(calls).toBe(0);
  });

  test("node_modules does not wake the watcher", { timeout: 15_000 }, async () => {
    let calls = 0;
    handle = watchProject({
      root,
      debounceMs: 50,
      onChange: () => {
        calls++;
      },
    });

    await mkdir(join(root, "node_modules", "algo"), { recursive: true });
    await writeFile(join(root, "node_modules", "algo", "index.js"), "module.exports = {};\n");
    await new Promise<void>((r) => setTimeout(r, 500));

    expect(calls).toBe(0);
  });
});
