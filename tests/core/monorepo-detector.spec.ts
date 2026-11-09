/**
 * `detectMonorepo` — f00011 S3.
 *
 * Helper puro que decide si una raíz de proyecto es un monorepo y, si
 * lo es, qué workspace concreto sugerir. Lo que se cubre:
 *
 *  - Las cuatro señales estándar (turbo.json, pnpm-workspace.yaml,
 *    lerna.json, package.json#workspaces).
 *  - La prioridad entre ellas (turbo > pnpm > lerna > package.json).
 *  - La resolución de globs (`apps/*` → subdirectorios reales, no el
 *    prefijo; ver a00012 S1.a).
 *  - Las normalizaciones (`./apps/api`, `apps/../api`, escapes).
 *  - El contrato de `frameworkSearchRoot`: solo se rellena cuando hay
 *    **exactamente un** workspace; con cero o varios, `null`.
 *
 * No se cubre el sub-camino de la `generation.pipeline.ts` que decide
 * si el `frameworkSearchRoot` del usuario gana sobre el auto; eso
 * vive en `tests/cli/framework-search-root.spec.ts`.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { detectMonorepo } from "../../packages/core/discovery/monorepo-detector.helper";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "monorepo-detector-"));
});

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function writeJson(relPath: string, value: unknown): Promise<void> {
  await writeFile(join(root, relPath), JSON.stringify(value, null, 2), "utf8");
}

async function writeText(relPath: string, value: string): Promise<void> {
  await writeFile(join(root, relPath), value, "utf8");
}

async function makeDir(relPath: string): Promise<void> {
  await mkdir(join(root, relPath), { recursive: true });
}

describe("detectMonorepo — sin monorepo", () => {
  test("un directorio vacío no se considera monorepo", async () => {
    const result = await detectMonorepo(root);
    expect(result.isMonorepo).toBe(false);
    expect(result.signal).toBeNull();
    expect(result.workspaceDirs).toEqual([]);
    expect(result.frameworkSearchRoot).toBeNull();
  });

  test("un package.json sin workspaces no cuenta", async () => {
    await writeJson("package.json", { name: "no-monorepo" });
    const result = await detectMonorepo(root);
    expect(result.isMonorepo).toBe(false);
    expect(result.workspaceDirs).toEqual([]);
  });
});

describe("detectMonorepo — turbo.json", () => {
  test("turbo.json básico → isMonorepo, con workspaces", async () => {
    await writeJson("turbo.json", { workspaces: ["apps/*", "packages/*"] });
    await makeDir("apps/api");
    await makeDir("apps/web");
    await makeDir("packages/auth");

    const result = await detectMonorepo(root);
    expect(result.isMonorepo).toBe(true);
    expect(result.signal).toBe("turbo.json");
    // a00012 S1.a: los globs se materializan a los subdirectorios
    // reales, no al prefijo. El scanner consume `workspaceDirs`
    // directamente sin tener que re-enumerar.
    expect(result.workspaceDirs).toContain("apps/api");
    expect(result.workspaceDirs).toContain("apps/web");
    expect(result.workspaceDirs).toContain("packages/auth");
    expect(result.frameworkSearchRoot).toBeNull(); // hay tres workspaces distintos
  });

  test("turbo.json con `packages:` (Lerna-style)", async () => {
    await writeJson("turbo.json", { packages: ["apps/*"] });
    await makeDir("apps/api");
    const result = await detectMonorepo(root);
    expect(result.isMonorepo).toBe(true);
    expect(result.workspaceDirs).toEqual(["apps/api"]);
  });

  test("turbo.json con un solo workspace concreto → frameworkSearchRoot", async () => {
    await writeJson("turbo.json", { workspaces: ["apps/api"] });
    await makeDir("apps/api");
    const result = await detectMonorepo(root);
    expect(result.frameworkSearchRoot).toBe("apps/api");
  });
});

describe("detectMonorepo — pnpm-workspace.yaml", () => {
  test("con un workspace bajo `apps/*`", async () => {
    await writeText(
      "pnpm-workspace.yaml",
      ["packages:", "  - 'apps/*'", "  - 'packages/*'", ""].join("\n"),
    );
    await makeDir("apps/api");
    await makeDir("packages/auth");
    const result = await detectMonorepo(root);
    expect(result.isMonorepo).toBe(true);
    expect(result.signal).toBe("pnpm-workspace.yaml");
    // a00012 S1.a: materialización real, no prefijo.
    expect(result.workspaceDirs).toContain("apps/api");
    expect(result.workspaceDirs).toContain("packages/auth");
  });

  test("con workspaces entrecomillados y comentarios inline", async () => {
    await writeText(
      "pnpm-workspace.yaml",
      ["packages:", "  - \"apps/api\" # solo api", ""].join("\n"),
    );
    await makeDir("apps/api");
    const result = await detectMonorepo(root);
    expect(result.workspaceDirs).toEqual(["apps/api"]);
    expect(result.frameworkSearchRoot).toBe("apps/api");
  });

  test("ignora bloques posteriores al primero", async () => {
    // El parser mínimo lee solo el primer `packages:`. Esto es por
    // diseño: pnpm permite varios bloques (catalog), pero no nos
    // aportan subdirs adicionales para esta detección.
    await writeText(
      "pnpm-workspace.yaml",
      ["packages:", "  - 'apps/*'", "catalog:", "  - 'a'", ""].join("\n"),
    );
    await makeDir("apps/api");
    const result = await detectMonorepo(root);
    expect(result.workspaceDirs).toContain("apps/api");
  });

  test("un YAML sin `packages:` no detecta", async () => {
    await writeText("pnpm-workspace.yaml", "onlyBuiltDependencies:\n  - foo\n");
    const result = await detectMonorepo(root);
    expect(result.isMonorepo).toBe(true); // el archivo existe, pero…
    expect(result.workspaceDirs).toEqual([]);
    expect(result.frameworkSearchRoot).toBeNull();
  });
});

describe("detectMonorepo — lerna.json", () => {
  test("lerna.json con packages", async () => {
    await writeJson("lerna.json", { packages: ["packages/*"] });
    await makeDir("packages/api");
    const result = await detectMonorepo(root);
    expect(result.isMonorepo).toBe(true);
    expect(result.signal).toBe("lerna.json");
    expect(result.workspaceDirs).toEqual(["packages/api"]);
  });
});

describe("detectMonorepo — package.json#workspaces", () => {
  test("package.json con workspaces en formato array", async () => {
    await writeJson("package.json", {
      name: "mi-monorepo",
      workspaces: ["apps/*"],
    });
    await makeDir("apps/api");
    const result = await detectMonorepo(root);
    expect(result.isMonorepo).toBe(true);
    expect(result.signal).toBe("package.json#workspaces");
    expect(result.workspaceDirs).toEqual(["apps/api"]);
  });

  test("package.json con workspaces en formato objeto (npm 7+)", async () => {
    await writeJson("package.json", {
      name: "mi-monorepo",
      workspaces: { packages: ["apps/api"] },
    });
    await makeDir("apps/api");
    const result = await detectMonorepo(root);
    expect(result.isMonorepo).toBe(true);
    expect(result.frameworkSearchRoot).toBe("apps/api");
  });

  test("un package.json sin workspaces se ignora", async () => {
    await writeJson("package.json", { name: "no-monorepo" });
    const result = await detectMonorepo(root);
    expect(result.isMonorepo).toBe(false);
  });
});

describe("detectMonorepo — prioridad entre señales", () => {
  test("turbo.json gana sobre package.json#workspaces", async () => {
    // Si los dos están, turbo manda: es el orden de la documentación.
    await writeJson("turbo.json", { workspaces: ["apps/api"] });
    await writeJson("package.json", { workspaces: ["packages/*"] });
    await makeDir("apps/api");
    await makeDir("packages/auth");

    const result = await detectMonorepo(root);
    expect(result.signal).toBe("turbo.json");
    expect(result.frameworkSearchRoot).toBe("apps/api");
  });

  test("pnpm-workspace.yaml gana sobre lerna.json", async () => {
    await writeText("pnpm-workspace.yaml", "packages:\n  - 'apps/api'\n");
    await writeJson("lerna.json", { packages: ["packages/*"] });
    await makeDir("apps/api");
    await makeDir("packages/auth");

    const result = await detectMonorepo(root);
    expect(result.signal).toBe("pnpm-workspace.yaml");
  });
});

describe("detectMonorepo — normalización de paths", () => {
  test("`./apps/api` se queda como `apps/api`", async () => {
    await writeJson("package.json", { workspaces: ["./apps/api"] });
    await makeDir("apps/api");
    const result = await detectMonorepo(root);
    expect(result.frameworkSearchRoot).toBe("apps/api");
  });

  test("`apps/../api` se colapsa a `api`", async () => {
    await writeJson("package.json", { workspaces: ["apps/../api"] });
    await makeDir("api");
    const result = await detectMonorepo(root);
    expect(result.frameworkSearchRoot).toBe("api");
  });

  test("`apps/../../etc` se rechaza (escapa de projectRoot)", async () => {
    await writeJson("package.json", { workspaces: ["apps/../../etc"] });
    const result = await detectMonorepo(root);
    expect(result.workspaceDirs).toEqual([]);
    expect(result.frameworkSearchRoot).toBeNull();
  });

  test("`/abs/path` se rechaza", async () => {
    await writeJson("package.json", { workspaces: ["/abs/path"] });
    const result = await detectMonorepo(root);
    expect(result.workspaceDirs).toEqual([]);
  });

  test("duplicados colapsan y el orden es estable", async () => {
    await writeJson("turbo.json", {
      workspaces: ["apps/api", "apps/api", "packages/api"],
    });
    await makeDir("apps/api");
    await makeDir("packages/api");
    const result = await detectMonorepo(root);
    expect(result.workspaceDirs).toEqual(["apps/api", "packages/api"]);
  });
});

describe("detectMonorepo — entradas inválidas", () => {
  test("una raíz relativa devuelve no-monorepo", async () => {
    const result = await detectMonorepo("./relative/path");
    expect(result.isMonorepo).toBe(false);
    expect(result.signal).toBeNull();
  });

  test("una cadena vacía devuelve no-monorepo", async () => {
    const result = await detectMonorepo("");
    expect(result.isMonorepo).toBe(false);
  });

  test("un package.json corrupto se ignora", async () => {
    await writeText("package.json", "{ no es json\n");
    const result = await detectMonorepo(root);
    expect(result.isMonorepo).toBe(false);
  });
});
describe("detectMonorepo — turbo.json sin workspaces + package.json (audit 2nd-review #6)", () => {
  test("turbo.json presente pero SIN workspaces: cae a package.json#workspaces", async () => {
    // Caso real del audit: un proyecto Turborepo donde el
    // `turbo.json` solo contiene tasks (no `workspaces`) y la
    // lista real de paquetes vive en `package.json#workspaces`.
    // Antes el detector devolvía `isMonorepo=true, workspaceDirs=[]`
    // y nunca llegaba a package.json.
    await writeJson("turbo.json", {
      pipeline: { build: { outputs: ["dist/**"] } },
      tasks: { build: "tsc" },
    });
    await writeJson("package.json", {
      name: "monorepo",
      private: true,
      workspaces: ["apps/api"], // workspace único y directo
    });
    await makeDir("apps/api");

    const result = await detectMonorepo(root);
    // turbo.json marca presencia y aporta signal.
    expect(result.isMonorepo).toBe(true);
    expect(result.signal).toBe("turbo.json");
    // Los workspaces vienen del package.json (fallback) y se
    // materializan correctamente.
    expect(result.workspaceDirs).toEqual(["apps/api"]);
    // Único workspace → frameworkSearchRoot se rellena.
    expect(result.frameworkSearchRoot).toBe("apps/api");
  });

  test("turbo.json CON workspaces: gana solo turbo.json (no combina con package.json)", async () => {
    // Caso histórico: cuando turbo.json define workspaces, esos son
    // los del proyecto, no se mezclan con package.json. El test
    // previo verifica este contrato.
    await writeJson("turbo.json", { workspaces: ["apps/api"] });
    await writeJson("package.json", { workspaces: ["packages/*"] });
    await makeDir("apps/api");
    await makeDir("packages/auth");

    const result = await detectMonorepo(root);
    expect(result.signal).toBe("turbo.json");
    expect(result.frameworkSearchRoot).toBe("apps/api");
  });
});
