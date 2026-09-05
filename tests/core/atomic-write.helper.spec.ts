/**
 * Write the whole thing or do not write.
 *
 * `writeFile` truncates before writing, so between the two moments the
 * file is half-written. The case that matters is `watch`: it rewrites
 * the collection on every project change while Postman has it
 * imported, so each save was a window in which to read a truncated
 * JSON — and a truncated JSON is not an incomplete collection, it is a
 * file that Postman cannot open.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  writeFileAtomic,
  writeJsonAtomic,
} from "../../packages/core/helpers/atomic-write.helper";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "atomic-"));
});

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  test("writes the content", async () => {
    const destino = join(dir, "a.txt");
    await writeFileAtomic(destino, "hola");
    expect(await readFile(destino, "utf8")).toBe("hola");
  });

  test("replaces what was there", async () => {
    const destino = join(dir, "a.txt");
    await writeFile(destino, "viejo");
    await writeFileAtomic(destino, "nuevo");
    expect(await readFile(destino, "utf8")).toBe("nuevo");
  });

  test("creates the directory if it does not exist", async () => {
    const destino = join(dir, "sub", "otro", "a.txt");
    await writeFileAtomic(destino, "hola");
    expect(await readFile(destino, "utf8")).toBe("hola");
  });

  /**
   * The temp file has to be born **next to** the destination. In
   * `/tmp` the `rename` would cross filesystems, which is not atomic:
   * the system returns `EXDEV` and you fall back to copying, which is
   * exactly what you wanted to avoid.
   */
  test("leaves no temp files when it finishes", async () => {
    await writeFileAtomic(join(dir, "a.txt"), "hola");
    expect(await readdir(dir)).toEqual(["a.txt"]);
  });

  test("also leaves none when it fails", async () => {
    // A destination that is a directory: the `rename` cannot replace it.
    const destino = join(dir, "soy-un-dir");
    await writeFileAtomic(join(destino, "dentro.txt"), "x");
    await expect(writeFileAtomic(destino, "hola")).rejects.toThrow();
    // The directory and its contents remain; no stray `.tmp`.
    const sobrantes = (await readdir(dir)).filter((n) => n.endsWith(".tmp"));
    expect(sobrantes).toEqual([]);
  });

  /**
   * THE test. With `writeFile` directly, a mid-flight failure leaves
   * the previous file mangled; here it must stay intact.
   */
  test("a failure leaves the previous file exactly as it was", async () => {
    const destino = join(dir, "coleccion.json");
    const bueno = JSON.stringify({ item: [1, 2, 3] }, null, 2);
    await writeFile(destino, bueno);

    // An object with a cycle: `JSON.stringify` throws before touching
    // disk.
    const ciclo: Record<string, unknown> = {};
    ciclo["yo"] = ciclo;
    await expect(writeJsonAtomic(destino, ciclo)).rejects.toThrow();

    expect(await readFile(destino, "utf8")).toBe(bueno);
    expect(() => JSON.parse(bueno) as unknown).not.toThrow();
  });

  test("concurrent writes on the same path do not stomp on each other's temp file", async () => {
    const destino = join(dir, "a.txt");
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => writeFileAtomic(destino, `valor-${i}`)),
    );
    // One wins, but the file is one of the twelve in full, not a piece
    // of one glued to a piece of another.
    expect(await readFile(destino, "utf8")).toMatch(/^valor-\d+$/);
    expect((await readdir(dir)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
});

describe("writeJsonAtomic", () => {
  test("writes indented JSON with a trailing newline", async () => {
    const destino = join(dir, "a.json");
    await writeJsonAtomic(destino, { a: 1 });
    const raw = await readFile(destino, "utf8");
    expect(raw).toBe('{\n  "a": 1\n}\n');
  });

  test("what it writes can be read back", async () => {
    const destino = join(dir, "a.json");
    const valor = { item: [{ name: "x" }], info: { schema: "v2.1.0" } };
    await writeJsonAtomic(destino, valor);
    expect(JSON.parse(await readFile(destino, "utf8")) as unknown).toEqual(valor);
  });

  /**
   * Serializing before opening the file is not a style detail: if
   * serialization happened during the write, an object with a cycle
   * would leave the file half-written without the process ever dying.
   */
  test("an object that cannot be serialized does not create a file", async () => {
    const destino = join(dir, "nunca.json");
    const ciclo: Record<string, unknown> = {};
    ciclo["yo"] = ciclo;
    await expect(writeJsonAtomic(destino, ciclo)).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });
});
