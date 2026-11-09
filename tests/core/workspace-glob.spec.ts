/**
 * `resolveWorkspaceGlobs` — a00012 S1.a.
 *
 * The resolver materializes workspace globs into real directories.
 * These tests create the workspaces with `mkdtemp` + `mkdir`
 * (`fs` is not mocked) and verify:
 *
 *  - Expansion of `*` (one level) with real materialization.
 *  - Expansion of `**` (recursive).
 *  - Exclusion with `!` (pnpm-style).
 *  - Rejection of absolute paths and escapes.
 *  - Determinism: stable order across invocations.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resolveWorkspaceGlobs } from "../../packages/core/discovery/workspace-glob.helper";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "workspace-glob-"));
});

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function makeDir(relPath: string): Promise<void> {
  await mkdir(join(root, relPath), { recursive: true });
}

async function touchFile(relPath: string): Promise<void> {
  await writeFile(join(root, relPath), "x", "utf8");
}

async function resolve(globs: ReadonlyArray<string>): Promise<ReadonlyArray<string>> {
  return resolveWorkspaceGlobs(root, globs);
}

describe("resolveWorkspaceGlobs — expansi\u00f3n de `*` (un nivel)", () => {
  test("`apps/*` con `apps/api` y `apps/web` devuelve ambas", async () => {
    await makeDir("apps/api");
    await makeDir("apps/web");
    expect(await resolve(["apps/*"])).toEqual(["apps/api", "apps/web"]);
  });

  test("`apps/*` sin materializar devuelve `[]`", async () => {
    expect(await resolve(["apps/*"])).toEqual([]);
  });

  test("`packages/*` con múltiples devuelve todas las reales", async () => {
    await makeDir("packages/auth");
    await makeDir("packages/billing");
    await makeDir("packages/notifications");
    // Un archivo suelto entre los directorios no cuenta.
    await makeDir("packages");
    await touchFile("packages/readme.md");
    expect(await resolve(["packages/*"])).toEqual([
      "packages/auth",
      "packages/billing",
      "packages/notifications",
    ]);
  });

  test("los hijos se devuelven ordenados lexicogr\u00e1ficamente", async () => {
    await makeDir("apps/zeta");
    await makeDir("apps/alpha");
    await makeDir("apps/middle");
    expect(await resolve(["apps/*"])).toEqual([
      "apps/alpha",
      "apps/middle",
      "apps/zeta",
    ]);
  });
});

describe("resolveWorkspaceGlobs — expansi\u00f3n de `**` (recursivo)", () => {
  test("`packages/**` enumera todos los descendientes", async () => {
    await makeDir("packages/auth/v2");
    await makeDir("packages/auth/v2/nested");
    await makeDir("packages/billing");
    const result = await resolve(["packages/**"]);
    // El prefijo `packages` no aparece (solo los descendientes).
    expect(result).toContain("packages/auth");
    expect(result).toContain("packages/auth/v2");
    expect(result).toContain("packages/auth/v2/nested");
    expect(result).toContain("packages/billing");
    expect(result).not.toContain("packages");
  });

  test("`packages/**` filtra seg\u00fan el patr\u00f3n completo", async () => {
    await makeDir("packages/auth/v2");
    await makeDir("packages/billing/v1");
    await makeDir("other/skip");
    const result = await resolve(["packages/**"]);
    expect(result.every((p) => p.startsWith("packages/"))).toBe(true);
    expect(result).not.toContain("other/skip");
  });
});

describe("resolveWorkspaceGlobs — literales", () => {
  test("`apps/api` (sin *) devuelve `[apps/api]` si existe", async () => {
    await makeDir("apps/api");
    expect(await resolve(["apps/api"])).toEqual(["apps/api"]);
  });

  test("`apps/api` devuelve `[]` si no existe", async () => {
    expect(await resolve(["apps/api"])).toEqual([]);
  });

  test("`apps/api` apuntando a un archivo (no directorio) devuelve `[]`", async () => {
    await makeDir("apps");
    await touchFile("apps/api");
    expect(await resolve(["apps/api"])).toEqual([]);
  });
});

describe("resolveWorkspaceGlobs — exclusiones (`!`)", () => {
  test("mezcla con `!apps/test` devuelve las reales excepto esa", async () => {
    await makeDir("apps/api");
    await makeDir("apps/web");
    await makeDir("apps/test");
    const result = await resolve(["apps/*", "!apps/test"]);
    expect(result).toEqual(["apps/api", "apps/web"]);
  });

  test("una lista duplicada de inclusiones se colapsa", async () => {
    await makeDir("apps/api");
    await makeDir("apps/web");
    const result = await resolve(["apps/*", "apps/*", "!apps/test"]);
    expect(result).toEqual(["apps/api", "apps/web"]);
  });

  test("exclusi\u00f3n de un subdirectorio no elimina su padre", async () => {
    await makeDir("packages/auth");
    await makeDir("packages/auth/__tests__");
    const result = await resolve(["packages/**", "!packages/auth/__tests__"]);
    expect(result).toContain("packages/auth");
    expect(result).not.toContain("packages/auth/__tests__");
  });
});

describe("resolveWorkspaceGlobs — rechazo de escapes y absolutos", () => {
  test("un absoluto `/etc` se descarta", async () => {
    expect(await resolve(["/etc"])).toEqual([]);
  });

  test("un `apps/../../etc` se descarta (escapa de la ra\u00edz)", async () => {
    expect(await resolve(["apps/../../etc"])).toEqual([]);
  });

  test("un `./apps/api` se normaliza correctamente", async () => {
    await makeDir("apps/api");
    expect(await resolve(["./apps/api"])).toEqual(["apps/api"]);
  });

  test("un `apps/../api` colapsa a `api`", async () => {
    await makeDir("api");
    expect(await resolve(["apps/../api"])).toEqual(["api"]);
  });

  test("una ra\u00edz relativa devuelve `[]`", async () => {
    const result = await resolveWorkspaceGlobs("./relative", ["apps/*"]);
    expect(result).toEqual([]);
  });

  test("una cadena vac\u00eda devuelve `[]`", async () => {
    const result = await resolveWorkspaceGlobs("", ["apps/*"]);
    expect(result).toEqual([]);
  });
});

describe("resolveWorkspaceGlobs — determinismo y dedup", () => {
  test("dos invocaciones devuelven los resultados en el mismo orden", async () => {
    await makeDir("apps/api");
    await makeDir("apps/web");
    await makeDir("packages/billing");
    const first = await resolve(["apps/*", "packages/*"]);
    const second = await resolve(["packages/*", "apps/*"]);
    expect(first).toEqual(second);
  });

  test("globs duplicados se colapsan a un \u00fanico resultado", async () => {
    await makeDir("apps/api");
    const first = await resolve(["apps/api", "apps/*"]);
    const second = await resolve(["apps/*"]);
    expect(first).toEqual(second);
    expect(first).toEqual(["apps/api"]);
  });

  test("mezcla con inclusi\u00f3n + su exclusion literal sin matchear no afecta", async () => {
    await makeDir("apps/api");
    expect(await resolve(["apps/*", "!apps/does-not-exist"])).toEqual([
      "apps/api",
    ]);
  });
});
