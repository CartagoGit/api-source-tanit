/**
 * `ModuleResolver` tests (proposal `r00020` S1).
 *
 * The resolver replaces the posix-shaped import resolver that only
 * knew how to join a relative path with the directory of the
 * importing file. These tests cover every rule it has to understand:
 *
 *   1. `tsconfig` `baseUrl` and `paths` (the `@/*` aliases).
 *   2. `package.json#exports` and its conditions.
 *   3. `package.json#imports` (the `#internal` aliases).
 *   4. Workspaces (npm, pnpm) and `node_modules` hoisting.
 *   5. Declaration files (`.d.ts`).
 *   6. Windows drive letters and UNC shares.
 *   7. The structured error of a specifier that resolves to nothing.
 *
 * Two scenarios run against the real fixtures of the repository
 * (`tests/fixtures/tsconfig-paths-monorepo/` and
 * `tests/fixtures/windows-paths-mock/`); the rest run against
 * synthetic projects created in a temp directory, the way the rest of
 * the core tests do.
 */
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { moduleDir } from "../../packages/core/helpers/module-path.helper.js";
import { resolveImportPath } from "../../packages/core/discovery/import-resolver.js";
import { ModuleResolver } from "../../packages/core/module-resolution/resolver.service.js";
import {
  detectPathStyle,
  isAbsolutePath,
  splitDrive,
} from "../../packages/core/module-resolution/platform-paths.helper.js";
import {
  resolvePackageExports,
  splitBareSpecifier,
} from "../../packages/core/module-resolution/package-exports.helper.js";
import { resolvePackageImports } from "../../packages/core/module-resolution/package-imports.helper.js";
import {
  matchPathPattern,
  parseTsconfigPaths,
} from "../../packages/core/module-resolution/tsconfig-paths.helper.js";
import { withFixture } from "../helpers/fixtures.js";

const FIXTURES = join(moduleDir(import.meta.url), "..", "fixtures");
const MONOREPO = join(FIXTURES, "tsconfig-paths-monorepo");
const WINDOWS = join(FIXTURES, "windows-paths-mock");

const MONOREPO_MAIN = join(MONOREPO, "src", "main.ts");
const WINDOWS_MAIN = join(WINDOWS, "src", "main.ts");

describe("ModuleResolver — tsconfig baseUrl and paths (criterion 1)", () => {
  test("resolves a `paths` alias (@/*) to the file it points at", () => {
    const resolver = new ModuleResolver({ projectRoot: MONOREPO });
    const outcome = resolver.resolve("@/users/users.controller", MONOREPO_MAIN);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.path).toBe(
      join(MONOREPO, "src", "users", "users.controller.ts"),
    );
    expect(outcome.kind).toBe("tsconfig-paths");
  });

  test("resolves a `paths` alias that crosses into a workspace package", () => {
    const resolver = new ModuleResolver({ projectRoot: MONOREPO });
    const outcome = resolver.resolve("@orders/main", MONOREPO_MAIN);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.path).toBe(
      join(MONOREPO, "packages", "orders", "src", "main.ts"),
    );
  });

  test("resolves a bare specifier through `baseUrl`", () => {
    const resolver = new ModuleResolver({ projectRoot: MONOREPO });
    const outcome = resolver.resolve("src/users/users.controller", MONOREPO_MAIN);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.path).toBe(
      join(MONOREPO, "src", "users", "users.controller.ts"),
    );
    expect(outcome.kind).toBe("base-url");
  });

  test("the alias and the baseUrl are two different rules", () => {
    const resolver = new ModuleResolver({ projectRoot: MONOREPO });
    const alias = resolver.searchPaths(
      "@/users/users.controller",
      MONOREPO_MAIN,
    );
    const baseUrl = resolver.searchPaths(
      "src/users/users.controller",
      MONOREPO_MAIN,
    );

    expect(alias[0]).toBe(join(MONOREPO, "src", "users", "users.controller"));
    expect(baseUrl[0]).toBe(join(MONOREPO, "src", "users", "users.controller"));
    // The alias is tried first: it is the more specific rule.
    expect(alias).toContain(
      join(MONOREPO, "src", "users", "users.controller.ts"),
    );
    expect(baseUrl).toContain(
      join(MONOREPO, "src", "users", "users.controller.ts"),
    );
  });

  test("a tsconfig with comments and trailing commas is understood", () => {
    const parsed = parseTsconfigPaths(
      `{
        // the alias everybody uses
        "compilerOptions": {
          "baseUrl": "./src",
          "paths": {
            "@/*": ["./*"],
          },
        },
      }`,
      "/proj",
    );

    expect(parsed.baseUrl).toBe("/proj/src");
    expect(parsed.paths["@/*"]).toEqual(["./*"]);
  });

  test("a `paths` pattern only matches the specifiers it should", () => {
    expect(matchPathPattern("@/*", "@/users/list")).toBe("users/list");
    expect(matchPathPattern("@/*", "users/list")).toBeNull();
    expect(matchPathPattern("@app/*/main", "@app/api/main")).toBe("api");
    expect(matchPathPattern("@app/*/main", "@app/api/other")).toBeNull();
  });
});

describe("ModuleResolver — package exports and conditions (criterion 1)", () => {
  const exportsProject = {
    "package.json": JSON.stringify({
      name: "exports-demo",
      version: "1.0.0",
      exports: {
        ".": {
          import: "./esm.js",
          require: "./cjs.js",
          browser: "./browser.js",
          node: "./node.js",
          default: "./default.js",
        },
        "./feature": "./feature.js",
      },
    }),
    "esm.js": "export const esm = true;\n",
    "cjs.js": "module.exports = { cjs: true };\n",
    "browser.js": "export const browser = true;\n",
    "node.js": "export const node = true;\n",
    "default.js": "export const fallback = true;\n",
    "feature.js": "export const feature = true;\n",
  };

  interface IResolution {
    readonly ok: boolean;
    readonly path: string;
    readonly code: string;
  }

  function resolveWith(
    conditions: ReadonlyArray<string>,
    specifier: string,
  ): IResolution {
    return withFixture(exportsProject, (root) => {
      const resolver = new ModuleResolver({
        projectRoot: root,
        conditions: [...conditions],
      });
      const outcome = resolver.resolve(specifier, join(root, "src", "main.ts"));
      return outcome.ok
        ? { ok: true, path: outcome.path, code: "" }
        : { ok: false, path: "", code: outcome.error.code };
    });
  }

  test("the `import` condition wins by default", () => {
    const result = resolveWith(
      ["import", "require", "node", "default"],
      "exports-demo",
    );
    expect(result.ok).toBe(true);
    expect(result.path).toContain("esm.js");
  });

  test("the `require` condition resolves to the CommonJS entry", () => {
    const result = resolveWith(["require", "default"], "exports-demo");
    expect(result.ok).toBe(true);
    expect(result.path).toContain("cjs.js");
  });

  test("the `node` condition resolves to the node entry", () => {
    const result = resolveWith(["node", "default"], "exports-demo");
    expect(result.ok).toBe(true);
    expect(result.path).toContain("node.js");
  });

  test("the `browser` condition resolves to the browser entry", () => {
    const result = resolveWith(["browser", "default"], "exports-demo");
    expect(result.ok).toBe(true);
    expect(result.path).toContain("browser.js");
  });

  test("`default` is the last resort", () => {
    const result = resolveWith([], "exports-demo");
    expect(result.ok).toBe(true);
    expect(result.path).toContain("default.js");
  });

  test("a subpath of the exports map resolves", () => {
    const result = resolveWith(["import"], "exports-demo/feature");
    expect(result.ok).toBe(true);
    expect(result.path).toContain("feature.js");
  });

  test("a subpath that is not exported does not resolve", () => {
    const result = resolveWith(["import"], "exports-demo/private");
    expect(result.ok).toBe(false);
    expect(result.code).toBe("NOT_FOUND");
  });

  test("the helper resolves the same map without a filesystem", () => {
    const exportsField = {
      ".": { import: "./esm.js", default: "./default.js" },
    };
    expect(
      resolvePackageExports(exportsField, ".", ["import", "default"]),
    ).toBe("./esm.js");
    expect(
      resolvePackageExports(exportsField, ".", ["require", "default"]),
    ).toBe("./default.js");
  });

  test("a bare specifier splits into package and subpath", () => {
    expect(splitBareSpecifier("lodash")).toEqual({
      packageName: "lodash",
      subpath: ".",
    });
    expect(splitBareSpecifier("lodash/fp")).toEqual({
      packageName: "lodash",
      subpath: "./fp",
    });
    expect(splitBareSpecifier("@nestjs/core")).toEqual({
      packageName: "@nestjs/core",
      subpath: ".",
    });
    expect(splitBareSpecifier("@nestjs/core/testing")).toEqual({
      packageName: "@nestjs/core",
      subpath: "./testing",
    });
  });
});

describe("ModuleResolver — package imports (criterion 1)", () => {
  const importsProject = {
    "package.json": JSON.stringify({
      name: "imports-demo",
      version: "1.0.0",
      imports: {
        "#internal/db": "./src/db/index.js",
        "#internal/*": "./src/*",
      },
    }),
    "src/db/index.js": "export const db = true;\n",
    "src/logger.js": "export const logger = true;\n",
  };

  test("an exact `#internal` alias resolves", () => {
    withFixture(importsProject, (root) => {
      const resolver = new ModuleResolver({ projectRoot: root });
      const outcome = resolver.resolve("#internal/db", join(root, "src", "main.ts"));

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.path).toBe(join(root, "src", "db", "index.js"));
      expect(outcome.kind).toBe("package-imports");
    });
  });

  test("a wildcard `#internal` alias resolves", () => {
    withFixture(importsProject, (root) => {
      const resolver = new ModuleResolver({ projectRoot: root });
      const outcome = resolver.resolve(
        "#internal/logger",
        join(root, "src", "main.ts"),
      );

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.path).toBe(join(root, "src", "logger.js"));
    });
  });

  test("an alias that does not exist does not resolve", () => {
    withFixture(importsProject, (root) => {
      const resolver = new ModuleResolver({ projectRoot: root });
      const outcome = resolver.resolve(
        "#internal/missing",
        join(root, "src", "main.ts"),
      );

      expect(outcome.ok).toBe(false);
    });
  });

  test("the helper resolves the same map without a filesystem", () => {
    const importsField = {
      "#internal/db": "./src/db/index.js",
      "#internal/*": "./src/*",
    };
    expect(
      resolvePackageImports(importsField, "#internal/db", ["import"]),
    ).toBe("./src/db/index.js");
    expect(
      resolvePackageImports(importsField, "#internal/logger", ["import"]),
    ).toBe("./src/logger");
    expect(
      resolvePackageImports(importsField, "#other/logger", ["import"]),
    ).toBeNull();
  });
});

describe("ModuleResolver — workspaces and node_modules (criteria 1 and 2)", () => {
  test("a workspace package resolves by the name its manifest declares", () => {
    const resolver = new ModuleResolver({ projectRoot: MONOREPO });
    const outcome = resolver.resolve("@acme/orders", MONOREPO_MAIN);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.path).toBe(
      join(MONOREPO, "packages", "orders", "src", "main.ts"),
    );
    expect(outcome.packageName).toBe("@acme/orders");
  });

  test("a subpath of a workspace package resolves", () => {
    const resolver = new ModuleResolver({ projectRoot: MONOREPO });
    const outcome = resolver.resolve("@acme/orders/main", MONOREPO_MAIN);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.path).toBe(
      join(MONOREPO, "packages", "orders", "src", "main.ts"),
    );
  });

  test("a hoisted package resolves from a nested file", () => {
    const project = {
      "package.json": JSON.stringify({ name: "hoisted-demo", version: "1.0.0" }),
      "src/deep/nested/consumer.ts": "export const consumer = true;\n",
      "node_modules/lodash/package.json": JSON.stringify({
        name: "lodash",
        version: "4.17.21",
        main: "index.js",
      }),
      "node_modules/lodash/index.js": "export const lodash = true;\n",
    };

    withFixture(project, (root) => {
      const resolver = new ModuleResolver({ projectRoot: root });
      const from = join(root, "src", "deep", "nested", "consumer.ts");
      const outcome = resolver.resolve("lodash", from);

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      // The package lives in the ROOT node_modules, three directories
      // above the importer: that is what hoisting means.
      expect(outcome.path).toBe(join(root, "node_modules", "lodash", "index.js"));
      expect(outcome.packageName).toBe("lodash");
    });
  });

  test("a scoped package resolves from node_modules", () => {
    const project = {
      "package.json": JSON.stringify({ name: "scoped-demo", version: "1.0.0" }),
      "src/main.ts": "export const main = true;\n",
      "node_modules/@nestjs/core/package.json": JSON.stringify({
        name: "@nestjs/core",
        version: "10.0.0",
        exports: { ".": "./index.js" },
      }),
      "node_modules/@nestjs/core/index.js": "export const core = true;\n",
    };

    withFixture(project, (root) => {
      const resolver = new ModuleResolver({ projectRoot: root });
      const outcome = resolver.resolve("@nestjs/core", join(root, "src", "main.ts"));

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.path).toBe(
        join(root, "node_modules", "@nestjs", "core", "index.js"),
      );
    });
  });

  test("a declaration file is a valid target", () => {
    const project = {
      "package.json": JSON.stringify({ name: "types-demo", version: "1.0.0" }),
      "src/main.ts": "export const main = true;\n",
      "node_modules/typed/package.json": JSON.stringify({
        name: "typed",
        version: "1.0.0",
        main: "index.js",
        types: "index.d.ts",
      }),
      "node_modules/typed/index.js": "export const typed = true;\n",
      "node_modules/typed/index.d.ts": "export declare const typed: boolean;\n",
    };

    withFixture(project, (root) => {
      const resolver = new ModuleResolver({ projectRoot: root });
      const outcome = resolver.resolve("typed", join(root, "src", "main.ts"));

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.path).toBe(join(root, "node_modules", "typed", "index.d.ts"));
    });
  });

  test("a bare specifier without an entry fails with a structured error", () => {
    const project = {
      "package.json": JSON.stringify({ name: "empty-demo", version: "1.0.0" }),
      "src/main.ts": "export const main = true;\n",
    };

    withFixture(project, (root) => {
      const resolver = new ModuleResolver({ projectRoot: root });
      const outcome = resolver.resolve("lodash", join(root, "src", "main.ts"));

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.error.code).toBe("NOT_FOUND");
      expect(outcome.error.specifier).toBe("lodash");
      expect(outcome.error.searchPaths.length).toBeGreaterThan(0);
      expect(
        outcome.error.searchPaths.some((path) =>
          path.includes(join("node_modules", "lodash")),
        ),
      ).toBe(true);
      expect(outcome.error.message).toContain("lodash");
    });
  });

  test("an empty specifier is rejected with a structured error", () => {
    const resolver = new ModuleResolver({ projectRoot: MONOREPO });
    const outcome = resolver.resolve("", MONOREPO_MAIN);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("INVALID_SPECIFIER");
    expect(outcome.error.specifier).toBe("");
  });
});

describe("ModuleResolver — Windows paths (criteria 1 and 4)", () => {
  test("a drive letter is an absolute path", () => {
    expect(isAbsolutePath("C:\\app\\src\\main.ts")).toBe(true);
    expect(isAbsolutePath("\\\\server\\share\\pkg")).toBe(true);
    expect(isAbsolutePath("/app/src/main.ts")).toBe(true);
    expect(isAbsolutePath("./app")).toBe(false);
    expect(isAbsolutePath("lodash")).toBe(false);
  });

  test("the dialect of a path is detected", () => {
    expect(detectPathStyle("C:\\app\\src\\main.ts")).toBe("win32");
    expect(detectPathStyle("\\\\server\\share\\pkg")).toBe("unc");
    expect(detectPathStyle("/app/src/main.ts")).toBe("posix");
  });

  test("the drive is split off the path", () => {
    expect(splitDrive("C:\\app\\src\\main.ts")).toEqual({
      drive: "C:",
      rest: "\\app\\src\\main.ts",
    });
    expect(splitDrive("/app/src/main.ts")).toEqual({
      drive: "",
      rest: "/app/src/main.ts",
    });
  });

  test("an absolute Windows import resolves to the file it names", () => {
    const resolver = new ModuleResolver({ projectRoot: WINDOWS });
    const outcome = resolver.resolve("C:\\src\\helper", WINDOWS_MAIN);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.path).toBe(join(WINDOWS, "src", "helper.ts"));
    expect(outcome.kind).toBe("absolute");
  });

  test("a UNC import resolves to the file it names", () => {
    const resolver = new ModuleResolver({ projectRoot: WINDOWS });
    const outcome = resolver.resolve("\\\\server\\share\\src\\helper", WINDOWS_MAIN);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.path).toBe(join(WINDOWS, "src", "helper.ts"));
  });

  test("an explicit drive mapping wins over the default one", () => {
    const resolver = new ModuleResolver({
      projectRoot: WINDOWS,
      driveRoots: { "C:": join(WINDOWS, "src") },
    });
    const outcome = resolver.resolve("C:\\helper", WINDOWS_MAIN);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.path).toBe(join(WINDOWS, "src", "helper.ts"));
  });
});

describe("import resolver adapter (criterion 4)", () => {
  test("a relative import keeps the candidate chain", () => {
    const candidates = resolveImportPath(
      join(MONOREPO, "src", "main.ts"),
      "./users/users.controller",
      MONOREPO,
    );
    const paths = candidates.map((candidate) => candidate.path);

    expect(paths[0]).toBe(join(MONOREPO, "src", "users", "users.controller"));
    expect(paths).toContain(
      join(MONOREPO, "src", "users", "users.controller.ts"),
    );
    expect(candidates[0]?.kind).toBe("literal");
  });

  test("an absolute Windows import resolves (it used to resolve to nothing)", () => {
    const candidates = resolveImportPath(
      WINDOWS_MAIN,
      "C:\\src\\helper",
      WINDOWS,
    );
    const paths = candidates.map((candidate) => candidate.path);

    expect(paths.length).toBeGreaterThan(0);
    expect(paths).toContain(join(WINDOWS, "src", "helper.ts"));
  });

  test("a `paths` alias resolves through the adapter", () => {
    const candidates = resolveImportPath(
      MONOREPO_MAIN,
      "@/users/users.controller",
      MONOREPO,
    );
    const paths = candidates.map((candidate) => candidate.path);

    expect(paths).toContain(join(MONOREPO, "src", "users", "users.controller.ts"));
    expect(candidates.some((c) => c.kind === "tsconfig-paths")).toBe(true);
  });

  test("a bare specifier resolves to the node_modules chain", () => {
    const candidates = resolveImportPath(
      MONOREPO_MAIN,
      "lodash",
      MONOREPO,
    );
    const paths = candidates.map((candidate) => candidate.path);

    expect(
      paths.some((path) => path.includes(join("node_modules", "lodash"))),
    ).toBe(true);
    expect(candidates.some((c) => c.kind === "node-modules")).toBe(true);
  });

  test("an empty specifier resolves to no candidate", () => {
    expect(resolveImportPath(MONOREPO_MAIN, "", MONOREPO)).toEqual([]);
  });
});
