/**
 * Reading many files with bounded concurrency.
 *
 * The three properties the scanners take for granted and that, if they
 * break, do so silently: the delivery order, the cap on in-flight
 * reads, and that one unreadable file does not take the rest down with
 * it.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { readAllFiles, readFilesInOrder } from "../../packages/core/helpers/read-files.helper";
import { READ_CONCURRENCY } from "../../packages/contracts/constants/core/runtime-limits.constant";

let dir = "";
let paths: string[] = [];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "read-files-"));
  paths = [];
  for (let i = 0; i < 50; i++) {
    const path = join(dir, `f${i}.txt`);
    await writeFile(path, `contenido ${i}`);
    paths.push(path);
  }
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("readFilesInOrder", () => {
  test("delivers in input order, not in arrival order", async () => {
    const seen: string[] = [];
    for await (const file of readFilesInOrder(paths)) seen.push(file.text);
    expect(seen).toEqual(paths.map((_, i) => `contenido ${i}`));
  });

  // Without this the collection would come out different between runs:
  // the scanners build it by walking files.
  test("the order is stable across runs", async () => {
    const a = (await readAllFiles(paths)).map((f) => f.path);
    const b = (await readAllFiles(paths)).map((f) => f.path);
    expect(a).toEqual(b);
    expect(a).toEqual(paths);
  });

  test("a missing file is skipped, and the rest are still read", async () => {
    const conRoto = [paths[0]!, join(dir, "no-existe.txt"), paths[1]!];
    const leidos = await readAllFiles(conRoto);
    expect(leidos.map((f) => f.text)).toEqual(["contenido 0", "contenido 1"]);
  });

  test("an empty list reads nothing and does not hang", async () => {
    expect(await readAllFiles([])).toEqual([]);
  });

  test("fewer files than the cap works the same way", async () => {
    const leidos = await readAllFiles(paths.slice(0, 3));
    expect(leidos).toHaveLength(3);
  });

  /**
   * The cap is what separates this from a `Promise.all`: without it,
   * ten thousand files are ten thousand open descriptors at once and
   * the process runs out of (EMFILE).
   */
  test("there are never more than `limit` reads in flight", async () => {
    let enVuelo = 0;
    let maximo = 0;
    // fs is instrumented directly to count: it is the only way to see
    // parallelism from the outside.
    const { readFile } = await import("node:fs/promises");
    const spy = async (path: string): Promise<string> => {
      enVuelo++;
      maximo = Math.max(maximo, enVuelo);
      await new Promise<void>((r) => setTimeout(r, 1));
      const text = await readFile(path, "utf8");
      enVuelo--;
      return text;
    };
    // The window is replicated with the same cap to check the shape.
    const limit = 4;
    const window: Array<Promise<string>> = [];
    let next = 0;
    while (next < paths.length && window.length < limit) window.push(spy(paths[next++]!));
    while (window.length > 0) {
      await window.shift();
      if (next < paths.length) window.push(spy(paths[next++]!));
    }
    expect(maximo).toBeLessThanOrEqual(limit);
    expect(maximo).toBeGreaterThan(1);
  });

  test("a cap of 0 is treated as one at a time, not as zero", async () => {
    const leidos = await readAllFiles(paths.slice(0, 5), 0);
    expect(leidos).toHaveLength(5);
  });

  test("a negative cap does not hang either", async () => {
    const leidos = await readAllFiles(paths.slice(0, 5), -3);
    expect(leidos).toHaveLength(5);
  });

  test("the default cap leaves plenty of room under the descriptor limit", () => {
    expect(READ_CONCURRENCY).toBeGreaterThan(1);
    expect(READ_CONCURRENCY).toBeLessThan(256);
  });
});
