/**
 * The folder browser.
 *
 * Writing the path by hand is where most mistakes happen: a typo
 * returns "does not exist" with no clue of where you were. What is
 * checked here is that browsing does not become something else:
 *
 *   1. **Only folders.** Neither files nor their content. This is an
 *      HTTP server on someone's machine, and an endpoint that returned
 *      content would be an arbitrary file reader.
 *   2. **An unreadable directory does not break the listing.** Whoever
 *      browses `/` runs into system folders without permission, and
 *      having the whole list fail because of that would make the
 *      browser useless exactly where it is most needed.
 *   3. **The root has no parent.** Returning to itself would make the
 *      up button look broken.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  breadcrumbs,
  browseDirectory,
  defaultBrowseRoot,
} from "../../packages/ui/server/browse.service";

let raiz = "";

beforeAll(async () => {
  raiz = await mkdtemp(join(tmpdir(), "explorar-"));
  await mkdir(join(raiz, "alfa"));
  await mkdir(join(raiz, "beta"));
  await mkdir(join(raiz, "alfa", "dentro"));
  await mkdir(join(raiz, ".oculta"));
  await writeFile(join(raiz, "un-fichero.txt"), "no soy una carpeta");
  await writeFile(join(raiz, "secreto.json"), JSON.stringify({ clave: "no salir" }));
});

afterAll(async () => {
  if (raiz) await rm(raiz, { recursive: true, force: true });
});

describe("what is listed", () => {
  test("the folders, in order", async () => {
    const r = await browseDirectory(raiz);
    expect(r.ok).toBe(true);
    expect(r.entries.map((e) => e.name)).toEqual(["alfa", "beta"]);
  });

  /**
   * THE security test. Neither the file nor —much less— what is
   * inside. A browser that returns content is an arbitrary file reader
   * under another name.
   */
  test("neither the files nor their content", async () => {
    const r = await browseDirectory(raiz);
    const serializado = JSON.stringify(r);

    expect(r.entries.map((e) => e.name)).not.toContain("un-fichero.txt");
    expect(serializado).not.toContain("no soy una carpeta");
    expect(serializado).not.toContain("no salir");
  });

  /**
   * Hidden ones out: with them, the home folder starts with thirty
   * config entries before the first one someone cares about. Whoever
   * needs them can type the path.
   */
  test("hidden ones do not clutter the listing", async () => {
    const r = await browseDirectory(raiz);
    expect(r.entries.map((e) => e.name)).not.toContain(".oculta");
  });

  test("each entry carries its absolute path, which is what is chosen", async () => {
    const r = await browseDirectory(raiz);
    expect(r.entries[0]?.path).toBe(join(raiz, "alfa"));
  });
});

describe("moving through the tree", () => {
  test("goes down into a subfolder", async () => {
    const r = await browseDirectory(join(raiz, "alfa"));
    expect(r.entries.map((e) => e.name)).toEqual(["dentro"]);
  });

  test("goes up through the parent", async () => {
    const r = await browseDirectory(join(raiz, "alfa"));
    expect(r.parent).toBe(raiz);
  });

  /** Returning to itself would make the up button look broken. */
  test("the system root has no parent", async () => {
    const r = await browseDirectory("/");
    expect(r.parent).toBeNull();
  });

  test("without a path starts at the home folder, not at the root", async () => {
    const r = await browseDirectory();
    expect(r.path).toBe(defaultBrowseRoot());
  });

  test("an empty path is not an error either: nothing has been chosen yet", async () => {
    const r = await browseDirectory("   ");
    expect(r.ok).toBe(true);
    expect(r.path).toBe(defaultBrowseRoot());
  });
});

describe("what cannot be opened is told, without breaking anything", () => {
  test("a folder that does not exist gives a reason, not an exception", async () => {
    const r = await browseDirectory(join(raiz, "no-existe"));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("not a folder");
    expect(r.entries).toEqual([]);
  });

  test("a file is not a folder, and it says so", async () => {
    const r = await browseDirectory(join(raiz, "un-fichero.txt"));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("not a folder");
  });

  /**
   * A broken symlink is **marked**, not hidden: seeing it and not
   * being able to enter is understood; not showing it looks like the
   * browser is failing.
   */
  test("a broken symlink is shown marked as unreadable", async () => {
    const conEnlace = await mkdtemp(join(tmpdir(), "enlace-"));
    try {
      await symlink(join(conEnlace, "no-existe"), join(conEnlace, "colgando"));
      const r = await browseDirectory(conEnlace);
      const colgando = r.entries.find((e) => e.name === "colgando");
      expect(colgando).toBeDefined();
      expect(colgando!.readable).toBe(false);
    } finally {
      await rm(conEnlace, { recursive: true, force: true });
    }
  });
});

describe("breadcrumbs", () => {
  test("go from the root to the current folder", async () => {
    const migas = breadcrumbs("/uno/dos/tres");
    expect(migas.map((m) => m.name)).toEqual(["/", "uno", "dos", "tres"]);
  });

  test("each crumb carries the path it jumps to", () => {
    const migas = breadcrumbs("/uno/dos");
    expect(migas.map((m) => m.path)).toEqual(["/", "/uno", "/uno/dos"]);
  });

  test("the root alone is a single crumb", () => {
    expect(breadcrumbs("/").map((m) => m.name)).toEqual(["/"]);
  });
});
