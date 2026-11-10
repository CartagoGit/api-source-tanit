import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectFiles, collectFilesFrom, isSourceJsTsFile } from "../../packages/core/helpers/fs-walk.helper";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "fs-walk-"));
  await mkdir(join(root, "src", "nested", "deep"), { recursive: true });
  await mkdir(join(root, "lib"), { recursive: true });
  await writeFile(join(root, "src", "a.ts"), "");
  await writeFile(join(root, "src", "nested", "b.ts"), "");
  await writeFile(join(root, "src", "nested", "deep", "c.js"), "");
  await writeFile(join(root, "src", "skip.md"), "");
  await writeFile(join(root, "lib", "d.ts"), "");
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("collectFiles", () => {
  test("walks recursively and returns absolute paths", async () => {
    const files = await collectFiles(join(root, "src"), (n) => n.endsWith(".ts"));
    expect(files).toHaveLength(2);
    for (const f of files) expect(f.startsWith(root)).toBe(true);
  });

  test("descends more than one nesting level", async () => {
    const files = await collectFiles(join(root, "src"), (n) => n.endsWith(".js"));
    expect(files).toHaveLength(1);
    expect(files[0]).toContain(join("nested", "deep", "c.js"));
  });

  test("applies the filename filter", async () => {
    expect(await collectFiles(root, (n) => n.endsWith(".md"))).toHaveLength(1);
  });

  test("returns [] for a non-existent directory instead of throwing", async () => {
    expect(await collectFiles(join(root, "no-existe"), () => true)).toEqual([]);
  });

  test("returns [] when nothing matches the filter", async () => {
    expect(await collectFiles(root, () => false)).toEqual([]);
  });
});

describe("collectFilesFrom", () => {
  test("aggregates several roots", async () => {
    const files = await collectFilesFrom(
      [join(root, "src"), join(root, "lib")],
      (n) => n.endsWith(".ts"),
    );
    expect(files).toHaveLength(3);
  });

  test("does not repeat files when roots overlap", async () => {
    const files = await collectFilesFrom(
      [root, join(root, "src")],
      (n) => n.endsWith(".ts"),
    );
    expect(new Set(files).size).toBe(files.length);
  });

  test("ignores roots that do not exist", async () => {
    const files = await collectFilesFrom(
      [join(root, "lib"), join(root, "fantasma")],
      (n) => n.endsWith(".ts"),
    );
    expect(files).toHaveLength(1);
  });
});

describe("isSourceJsTsFile", () => {
  test("accepts the code extensions", () => {
    for (const n of ["a.ts", "a.js", "a.mjs", "a.cjs", "a.tsx", "a.jsx"]) {
      expect(isSourceJsTsFile(n)).toBe(true);
    }
  });

  test("rejects other extensions", () => {
    expect(isSourceJsTsFile("a.py")).toBe(false);
    expect(isSourceJsTsFile("README.md")).toBe(false);
  });

  test("rejects type declarations", () => {
    expect(isSourceJsTsFile("types.d.ts")).toBe(false);
  });

  test("rejects tests, which do not declare real endpoints", () => {
    expect(isSourceJsTsFile("users.test.ts")).toBe(false);
    expect(isSourceJsTsFile("users.spec.ts")).toBe(false);
  });

  test("rejects vite/vitest configs", () => {
    expect(isSourceJsTsFile("vite.config.ts")).toBe(false);
    expect(isSourceJsTsFile("vitest.config.ts")).toBe(false);
  });
});

describe("hostile trees", () => {
  // The regression that motivated rewriting the walk. With
  // `readdir({ recursive: true })` —a single call— a symlink cycle
  // would fail the ENTIRE walk and return an empty list, also losing
  // what had already been found. Measured: an Express project with
  // `src/self -> .` returned 0 endpoints while `server.js` was right
  // there, and the collection came out empty without saying why.
  //
  // Not a lab case: Capistrano deploys with `current -> .`, and
  // monorepos symlink packages to each other.
  test("a symlink cycle does not blind the walk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fs-walk-loop-"));
    try {
      await mkdir(join(dir, "src"), { recursive: true });
      await writeFile(join(dir, "src", "server.js"), "export const a = 1;");
      await symlink(dir, join(dir, "src", "self"));

      const files = await collectFiles(dir, isSourceJsTsFile);
      expect(files.some((f) => f.endsWith("server.js"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("an unreadable folder only loses itself", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fs-walk-perm-"));
    try {
      await mkdir(join(dir, "abierta"), { recursive: true });
      await mkdir(join(dir, "cerrada"), { recursive: true });
      await writeFile(join(dir, "abierta", "visible.ts"), "export const a = 1;");
      await writeFile(join(dir, "cerrada", "oculto.ts"), "export const b = 2;");
      await chmod(join(dir, "cerrada"), 0o000);

      const files = await collectFiles(dir, isSourceJsTsFile);
      expect(files.some((f) => f.endsWith("visible.ts"))).toBe(true);
    } finally {
      await chmod(join(dir, "cerrada"), 0o755).catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a symlink to a code file does count", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fs-walk-link-"));
    try {
      await mkdir(join(dir, "real"), { recursive: true });
      await writeFile(join(dir, "real", "rutas.ts"), "export const a = 1;");
      await symlink(join(dir, "real", "rutas.ts"), join(dir, "enlazado.ts"));

      const files = await collectFiles(dir, isSourceJsTsFile);
      expect(files.length).toBeGreaterThanOrEqual(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a broken symlink does not break the walk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fs-walk-broken-"));
    try {
      await writeFile(join(dir, "bueno.ts"), "export const a = 1;");
      await symlink(join(dir, "no-existe"), join(dir, "roto.ts"));

      const files = await collectFiles(dir, isSourceJsTsFile);
      expect(files.some((f) => f.endsWith("bueno.ts"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
