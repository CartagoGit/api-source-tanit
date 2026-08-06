import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  collectFiles,
  collectFilesFrom,
  isSourceJsTsFile,
} from "../../helper/fs-walk.helper";

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
  test("recorre recursivamente y devuelve rutas absolutas", async () => {
    const files = await collectFiles(join(root, "src"), (n) => n.endsWith(".ts"));
    expect(files).toHaveLength(2);
    for (const f of files) expect(f.startsWith(root)).toBe(true);
  });

  test("baja más de un nivel de anidamiento", async () => {
    const files = await collectFiles(join(root, "src"), (n) => n.endsWith(".js"));
    expect(files).toHaveLength(1);
    expect(files[0]).toContain(join("nested", "deep", "c.js"));
  });

  test("aplica el filtro por nombre de fichero", async () => {
    expect(await collectFiles(root, (n) => n.endsWith(".md"))).toHaveLength(1);
  });

  test("devuelve [] en un directorio inexistente en lugar de lanzar", async () => {
    expect(await collectFiles(join(root, "no-existe"), () => true)).toEqual([]);
  });

  test("devuelve [] cuando nada casa el filtro", async () => {
    expect(await collectFiles(root, () => false)).toEqual([]);
  });
});

describe("collectFilesFrom", () => {
  test("agrega varias raíces", async () => {
    const files = await collectFilesFrom(
      [join(root, "src"), join(root, "lib")],
      (n) => n.endsWith(".ts"),
    );
    expect(files).toHaveLength(3);
  });

  test("no repite ficheros cuando las raíces se solapan", async () => {
    const files = await collectFilesFrom(
      [root, join(root, "src")],
      (n) => n.endsWith(".ts"),
    );
    expect(new Set(files).size).toBe(files.length);
  });

  test("ignora las raíces que no existen", async () => {
    const files = await collectFilesFrom(
      [join(root, "lib"), join(root, "fantasma")],
      (n) => n.endsWith(".ts"),
    );
    expect(files).toHaveLength(1);
  });
});

describe("isSourceJsTsFile", () => {
  test("acepta las extensiones de código", () => {
    for (const n of ["a.ts", "a.js", "a.mjs", "a.cjs", "a.tsx", "a.jsx"]) {
      expect(isSourceJsTsFile(n)).toBe(true);
    }
  });

  test("rechaza otras extensiones", () => {
    expect(isSourceJsTsFile("a.py")).toBe(false);
    expect(isSourceJsTsFile("README.md")).toBe(false);
  });

  test("rechaza declaraciones de tipos", () => {
    expect(isSourceJsTsFile("types.d.ts")).toBe(false);
  });

  test("rechaza tests, que no declaran endpoints reales", () => {
    expect(isSourceJsTsFile("users.test.ts")).toBe(false);
    expect(isSourceJsTsFile("users.spec.ts")).toBe(false);
  });

  test("rechaza los configs de vite/vitest", () => {
    expect(isSourceJsTsFile("vite.config.ts")).toBe(false);
    expect(isSourceJsTsFile("vitest.config.ts")).toBe(false);
  });
});
