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
import {
  removeLegacyGlobalNameLookup,
  SymbolGraph,
} from "../../packages/core/discovery/symbol-graph.js";
import { resolveImportPath } from "../../packages/core/discovery/import-resolver.js";
import { ModuleResolver } from "../../packages/core/module-resolution/resolver.service.js";
import {
  applyDriveRoot,
  basenamePath,
  detectPathStyle,
  dirnamePath,
  extnamePath,
  isAbsolutePath,
  joinPath,
  normalizePath,
  splitDrive,
  stripExtension,
  toNativePath,
  toPosixPath,
} from "../../packages/core/module-resolution/platform-paths.helper.js";
import {
  readPackageEntryPoints,
  resolvePackageExports,
  splitBareSpecifier,
} from "../../packages/core/module-resolution/package-exports.helper.js";
import { resolvePackageImports } from "../../packages/core/module-resolution/package-imports.helper.js";
import {
  expandPathTargets,
  matchPathPattern,
  matchTsconfigPaths,
  parseTsconfigPaths,
  stripJsonComments,
  stripTrailingCommas,
} from "../../packages/core/module-resolution/tsconfig-paths.helper.js";
import {
  createResolverError,
  invalidSpecifierError,
  isResolverError,
  notFoundError,
} from "../../packages/core/module-resolution/resolver-error.helper.js";
import { detectWorkspacePackages } from "../../packages/core/module-resolution/workspace-resolver.service.js";
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

  /**
   * A package that exports its root and nothing else, with a file
   * that is right there on disk.
   *
   * The file exists **on purpose**: a resolver that falls back to
   * the file when the subpath is not in the map would resolve it,
   * and the test below has to be able to fail on that.
   */
  const strictExportsProject = {
    "package.json": JSON.stringify({
      name: "strict-exports-demo",
      version: "1.0.0",
      exports: { ".": "./index.js" },
    }),
    "index.js": "export const index = true;\n",
    "private.js": "export const secret = true;\n",
  };

  /**
   * A package whose root is blocked under the `import` condition.
   *
   * The `default` condition would answer, and Node does not let
   * it: a `null` target under an active condition stops the
   * resolution there.
   */
  const blockedExportsProject = {
    "package.json": JSON.stringify({
      name: "blocked-demo",
      version: "1.0.0",
    }),
    "src/main.ts": "export const main = true;\n",
    "node_modules/blocked/package.json": JSON.stringify({
      name: "blocked",
      version: "1.0.0",
      exports: { ".": { import: null, default: "./index.js" } },
    }),
    "node_modules/blocked/index.js": "export const blocked = true;\n",
  };

  interface IResolution {
    readonly ok: boolean;
    readonly path: string;
    readonly code: string;
    readonly subpath: string;
  }

  function resolveWith(
    conditions: ReadonlyArray<string>,
    specifier: string,
    project: Record<string, string> = exportsProject,
  ): IResolution {
    return withFixture(project, (root) => {
      const resolver = new ModuleResolver({
        projectRoot: root,
        conditions: [...conditions],
      });
      const outcome = resolver.resolve(specifier, join(root, "src", "main.ts"));
      return outcome.ok
        ? {
            ok: true,
            path: outcome.path,
            code: "",
            subpath: outcome.subpath ?? "",
          }
        : { ok: false, path: "", code: outcome.error.code, subpath: "" };
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

  test("a subpath that exists on disk but is not exported does not resolve", () => {
    const result = resolveWith(
      ["import"],
      "strict-exports-demo/private",
      strictExportsProject,
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe("NOT_FOUND");
  });

  test("the exported root of that package does resolve", () => {
    const result = resolveWith(
      ["import"],
      "strict-exports-demo",
      strictExportsProject,
    );
    expect(result.ok).toBe(true);
    expect(result.path).toContain("index.js");
  });

  test("the resolution reports the subpath that was requested", () => {
    const subpath = resolveWith(["import"], "exports-demo/feature");
    expect(subpath.ok).toBe(true);
    expect(subpath.subpath).toBe("./feature");

    const root = resolveWith(["import"], "exports-demo");
    expect(root.ok).toBe(true);
    expect(root.subpath).toBe(".");
  });

  test("a `null` target under an active condition blocks the export", () => {
    withFixture(blockedExportsProject, (root) => {
      const resolver = new ModuleResolver({ projectRoot: root });
      const outcome = resolver.resolve("blocked", join(root, "src", "main.ts"));

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.error.code).toBe("NOT_FOUND");
    });
  });

  test("the blocked package resolves when that condition is not active", () => {
    withFixture(blockedExportsProject, (root) => {
      const resolver = new ModuleResolver({
        projectRoot: root,
        conditions: ["require", "default"],
      });
      const outcome = resolver.resolve("blocked", join(root, "src", "main.ts"));

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.path).toContain("index.js");
    });
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


describe("platform paths (criterion 1)", () => {
  test("the dialect of a path is detected", () => {
    expect(detectPathStyle("C:/app/src/main.ts")).toBe("win32");
    expect(detectPathStyle("//server/share/pkg")).toBe("unc");
    expect(detectPathStyle("/app/src/main.ts")).toBe("posix");
    expect(detectPathStyle("./app")).toBe("posix");
  });

  test("a drive without a separator is not absolute", () => {
    expect(isAbsolutePath("C:app")).toBe(false);
    expect(isAbsolutePath("C:\\app")).toBe(true);
  });

  test("the drive is split off a UNC path", () => {
    const split = splitDrive("\\\\server\\share\\pkg\\index.js");
    expect(split.drive).toBe("\\\\server\\share");
    expect(split.rest).toBe("\\pkg\\index.js");
  });

  test("a path without a drive keeps its whole text", () => {
    expect(splitDrive("app/src/main.ts")).toEqual({
      drive: "",
      rest: "app/src/main.ts",
    });
  });

  test("`.` and `..` are collapsed", () => {
    expect(normalizePath("/a/b/../c")).toBe("/a/c");
    expect(normalizePath("/a/./b")).toBe("/a/b");
    expect(normalizePath("/a/../..")).toBe("/");
    expect(normalizePath("a/../../b")).toBe("../b");
    expect(normalizePath("")).toBe("");
  });

  test("a relative path is joined onto its base", () => {
    expect(joinPath("/a/b", "../c")).toBe("/a/c");
    expect(joinPath("/a/b", "./c/d")).toBe("/a/b/c/d");
    expect(joinPath("/a/b", "")).toBe("/a/b");
  });

  test("an absolute path wins over the base it is joined to", () => {
    expect(joinPath("/a/b", "/x/y")).toBe("/x/y");
    expect(joinPath("/a/b", "C:\\x")).toBe("C:\\x");
  });

  test("the directory, the name and the extension of a path", () => {
    expect(dirnamePath("/a/b/c.ts")).toBe("/a/b");
    expect(dirnamePath("/c.ts")).toBe("/");
    expect(dirnamePath("c.ts")).toBe(".");
    expect(basenamePath("/a/b/c.ts")).toBe("c.ts");
    expect(extnamePath("/a/b/c.ts")).toBe(".ts");
    // A dotfile has no extension: the dot is the name.
    expect(extnamePath("/a/.eslintrc")).toBe("");
    expect(stripExtension("/a/b/c.ts")).toBe("/a/b/c");
  });

  test("a path is rewritten in the other dialect", () => {
    expect(toPosixPath("C:\\app\\src")).toBe("C:/app/src");
    expect(toNativePath("/app/src", "win32")).toBe("\\app\\src");
    expect(toNativePath("/app/src", "posix")).toBe("/app/src");
  });

  test("a drive is mapped onto a local directory", () => {
    expect(applyDriveRoot("C:\\app\\src", { "C:": "/root" })).toBe(
      "/root/app/src",
    );
    // An unmapped drive is left alone when there is no fallback.
    expect(applyDriveRoot("C:\\app\\src", {})).toBe("C:\\app\\src");
    // With a fallback (the project root), it is interpreted inside it.
    expect(applyDriveRoot("C:\\app\\src", {}, "/root")).toBe(
      "/root/app/src",
    );
  });
});

describe("package exports helper (criterion 1)", () => {
  test("a string exports only serves the root subpath", () => {
    expect(resolvePackageExports("./index.js", ".", ["import"])).toBe(
      "./index.js",
    );
    expect(resolvePackageExports("./index.js", "./sub", ["import"])).toBeNull();
  });

  test("a subpath map is matched exactly", () => {
    const exportsField = { ".": "./index.js", "./feature": "./feature.js" };
    expect(resolvePackageExports(exportsField, "./feature", ["import"])).toBe(
      "./feature.js",
    );
    expect(resolvePackageExports(exportsField, "./other", ["import"])).toBeNull();
  });

  test("a wildcard subpath is matched", () => {
    const exportsField = { "./*": "./src/*.js" };
    expect(resolvePackageExports(exportsField, "./thing", ["import"])).toBe(
      "./src/thing.js",
    );
  });

  test("the conditions decide, in the order of the map", () => {
    const exportsField = {
      ".": { import: "./esm.js", require: "./cjs.js", default: "./def.js" },
    };
    expect(resolvePackageExports(exportsField, ".", ["import"])).toBe(
      "./esm.js",
    );
    expect(resolvePackageExports(exportsField, ".", ["require"])).toBe(
      "./cjs.js",
    );
    expect(resolvePackageExports(exportsField, ".", [])).toBe("./def.js");
  });

  test("a condition that is not active is skipped", () => {
    const exportsField = {
      ".": { browser: "./browser.js", default: "./def.js" },
    };
    expect(resolvePackageExports(exportsField, ".", ["import"])).toBe(
      "./def.js",
    );
  });

  test("a `null` target under a matched condition blocks the resolution", () => {
    const exportsField = {
      ".": { import: null, default: "./def.js" },
    };
    // The `import` condition is active and its target is `null`:
    // the resolution stops there, exactly as Node does. It does NOT
    // carry on with the `default` condition.
    expect(
      resolvePackageExports(exportsField, ".", ["import", "default"]),
    ).toBeNull();
    // Without `import` active, the `default` condition answers.
    expect(resolvePackageExports(exportsField, ".", ["default"])).toBe(
      "./def.js",
    );
  });

  test("a `null` entry of a fallback array is skipped", () => {
    const exportsField = { ".": [null, "./y.js"] };
    expect(resolvePackageExports(exportsField, ".", ["import"])).toBe(
      "./y.js",
    );
  });

  test("an exports that is not a map resolves to nothing", () => {
    expect(resolvePackageExports(undefined, ".", ["import"])).toBeNull();
    expect(resolvePackageExports(null, ".", ["import"])).toBeNull();
    expect(resolvePackageExports(42, ".", ["import"])).toBeNull();
  });

  test("the entry points of a manifest are read", () => {
    expect(
      readPackageEntryPoints({
        main: "index.js",
        module: "esm.mjs",
        types: "index.d.ts",
      }),
    ).toEqual({ main: "index.js", module: "esm.mjs", types: "index.d.ts" });
    expect(readPackageEntryPoints({ typings: "index.d.ts" }).types).toBe(
      "index.d.ts",
    );
    expect(readPackageEntryPoints({})).toEqual({
      main: undefined,
      module: undefined,
      types: undefined,
    });
  });
});

describe("package imports helper (criterion 1)", () => {
  test("an exact alias resolves", () => {
    expect(
      resolvePackageImports({ "#db": "./src/db.js" }, "#db", ["import"]),
    ).toBe("./src/db.js");
  });

  test("a wildcard alias resolves", () => {
    expect(
      resolvePackageImports({ "#db/*": "./src/db/*" }, "#db/pool", ["import"]),
    ).toBe("./src/db/pool");
  });

  test("the conditions decide", () => {
    const importsField = {
      "#db": { import: "./esm.js", default: "./def.js" },
    };
    expect(resolvePackageImports(importsField, "#db", ["import"])).toBe(
      "./esm.js",
    );
    expect(resolvePackageImports(importsField, "#db", [])).toBe("./def.js");
  });

  test("a fallback array is used in order", () => {
    expect(
      resolvePackageImports({ "#db": ["./a.js", "./b.js"] }, "#db", ["import"]),
    ).toBe("./a.js");
  });

  test("a `null` target under a matched condition blocks the alias", () => {
    const importsField = { "#db": { import: null, default: "./db.js" } };
    expect(
      resolvePackageImports(importsField, "#db", ["import", "default"]),
    ).toBeNull();
    expect(resolvePackageImports(importsField, "#db", ["default"])).toBe(
      "./db.js",
    );
  });

  test("an alias that does not exist resolves to nothing", () => {
    expect(resolvePackageImports({}, "#db", ["import"])).toBeNull();
    expect(
      resolvePackageImports({ "#db": "./db.js" }, "#other", ["import"]),
    ).toBeNull();
    expect(resolvePackageImports("not a map", "#db", ["import"])).toBeNull();
  });
});

describe("tsconfig paths helper (criterion 1)", () => {
  test("the comments of a tsconfig are stripped", () => {
    expect(stripJsonComments('{"url": "https://example.com"}')).toBe(
      '{"url": "https://example.com"}',
    );
    expect(stripJsonComments('{ /* block */ "a": 1 } // trailing')).toBe(
      '{  "a": 1 } ',
    );
  });

  test("the trailing commas of a tsconfig are stripped", () => {
    expect(stripTrailingCommas('{"a": [1, 2,],}')).toBe('{"a": [1, 2]}');
  });

  test("a tsconfig that cannot be parsed yields nothing", () => {
    expect(parseTsconfigPaths("{ broken", "/proj")).toEqual({ paths: {} });
    expect(parseTsconfigPaths('{"compilerOptions": 3}', "/proj")).toEqual({
      paths: {},
    });
  });

  test("the alias with the longest prefix wins", () => {
    const paths = { "@/*": ["src/*"], "@app/*": ["app/*"] };
    const matched = matchTsconfigPaths(paths, "@app/thing");
    expect(matched?.pattern).toBe("@app/*");
    expect(matched?.capture).toBe("thing");
    // A specifier that matches no pattern resolves to nothing.
    expect(matchTsconfigPaths(paths, "@other/thing")).toBeNull();
  });

  test("the targets of an alias are expanded against the base", () => {
    expect(expandPathTargets(["/abs/*"], "x", "/base")).toEqual(["/abs/x"]);
    expect(expandPathTargets(["rel/*"], "x", "/base")).toEqual(["/base/rel/x"]);
  });
});

describe("workspace packages (criterion 1)", () => {
  /** A filesystem of one project, described by its files. */
  function fakeFs(files: Readonly<Record<string, string>>): {
    readonly readTextFile: (absPath: string) => string | null;
    readonly listDirectories: (absPath: string) => ReadonlyArray<string>;
  } {
    return {
      readTextFile: (absPath) => files[absPath] ?? null,
      listDirectories: (absPath) => {
        const prefix = absPath.endsWith("/") ? absPath : `${absPath}/`;
        const dirs = new Set<string>();
        for (const path of Object.keys(files)) {
          if (!path.startsWith(prefix)) continue;
          const rest = path.slice(prefix.length);
          const slash = rest.indexOf("/");
          if (slash === -1) continue;
          dirs.add(rest.slice(0, slash));
        }
        return [...dirs];
      },
    };
  }

  test("the npm workspaces are read", () => {
    const fs = fakeFs({
      "/proj/package.json": JSON.stringify({ workspaces: ["packages/*"] }),
      "/proj/packages/orders/package.json": JSON.stringify({
        name: "@acme/orders",
      }),
    });
    const packages = detectWorkspacePackages("/proj", fs);
    expect(packages).toHaveLength(1);
    expect(packages[0]?.name).toBe("@acme/orders");
    expect(packages[0]?.dir).toBe("/proj/packages/orders");
    expect(packages[0]?.relativeDir).toBe("packages/orders");
  });

  test("the `{ packages: [...] }` shape is read too", () => {
    const fs = fakeFs({
      "/proj/package.json": JSON.stringify({
        workspaces: { packages: ["apps/*"] },
      }),
      "/proj/apps/api/package.json": JSON.stringify({ name: "@acme/api" }),
    });
    const packages = detectWorkspacePackages("/proj", fs);
    expect(packages.map((p) => p.name)).toEqual(["@acme/api"]);
  });

  test("the pnpm workspace file is read", () => {
    const fs = fakeFs({
      "/proj/pnpm-workspace.yaml": "packages:\n  - 'libs/*'\n",
      "/proj/libs/one/package.json": JSON.stringify({ name: "one" }),
    });
    const packages = detectWorkspacePackages("/proj", fs);
    expect(packages.map((p) => p.name)).toEqual(["one"]);
  });

  test("a literal path is accepted", () => {
    const fs = fakeFs({
      "/proj/package.json": JSON.stringify({ workspaces: ["apps/api"] }),
      "/proj/apps/api/package.json": JSON.stringify({ name: "@acme/api" }),
    });
    expect(detectWorkspacePackages("/proj", fs).map((p) => p.name)).toEqual([
      "@acme/api",
    ]);
  });

  test("a workspace without a name is skipped", () => {
    const fs = fakeFs({
      "/proj/package.json": JSON.stringify({ workspaces: ["packages/*"] }),
      "/proj/packages/anon/package.json": JSON.stringify({ version: "1.0.0" }),
      "/proj/packages/named/package.json": JSON.stringify({ name: "named" }),
    });
    expect(detectWorkspacePackages("/proj", fs).map((p) => p.name)).toEqual([
      "named",
    ]);
  });

  test("a pattern that escapes the project is refused", () => {
    const fs = fakeFs({
      "/proj/package.json": JSON.stringify({ workspaces: ["../outside/*"] }),
    });
    expect(detectWorkspacePackages("/proj", fs)).toEqual([]);
  });
});

describe("resolver errors (criterion 2)", () => {
  test("an error carries the code, the specifier and the paths", () => {
    const error = createResolverError("NOT_FOUND", "lodash", ["/a"], "nope");
    expect(error.code).toBe("NOT_FOUND");
    expect(error.specifier).toBe("lodash");
    expect(error.searchPaths).toEqual(["/a"]);
    expect(error.message).toBe("nope");
  });

  test("the error of a missing module names the specifier", () => {
    const error = notFoundError("lodash", ["/a", "/b"], "/proj/main.ts");
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toContain("lodash");
    expect(error.message).toContain("2 path(s)");
    expect(error.fromFile).toBe("/proj/main.ts");
  });

  test("the error of an invalid specifier is a different code", () => {
    const error = invalidSpecifierError("", "/proj/main.ts");
    expect(error.code).toBe("INVALID_SPECIFIER");
    expect(error.searchPaths).toEqual([]);
  });

  test("a resolver error is recognised", () => {
    expect(isResolverError({ code: "NOT_FOUND", specifier: "x" })).toBe(true);
    expect(isResolverError({ code: 1 })).toBe(false);
    expect(isResolverError(null)).toBe(false);
    expect(isResolverError("nope")).toBe(false);
  });
});

describe("the legacy global symbol lookup (criterion 3)", () => {
  test("the lookup is off by default", () => {
    const builder = SymbolGraph.builder();
    builder.addSymbol({
      id: { sourceFile: "/proj/users.ts", declarationStart: 0, localName: "router" },
      kind: "router",
    });
    builder.addImport({
      sourceFile: "/proj/app.ts",
      specifier: "./users",
      localName: "router",
      importedName: "router",
    });
    const graph = builder.finalize();
    expect(
      graph.resolveByImportPath("/proj/app.ts", "./users", "router"),
    ).toEqual([]);
  });

  test("the lookup can be removed from a graph that allows it", () => {
    const builder = SymbolGraph.builder({
      experimental: { allowGlobalSymbolLookup: true },
    });
    builder.addSymbol({
      id: { sourceFile: "/proj/users.ts", declarationStart: 0, localName: "router" },
      kind: "router",
    });
    builder.addImport({
      sourceFile: "/proj/app.ts",
      specifier: "./users",
      localName: "router",
      importedName: "router",
    });
    const graph = builder.finalize();
    expect(
      graph.resolveByImportPath("/proj/app.ts", "./users", "router"),
    ).toHaveLength(1);

    const strict = removeLegacyGlobalNameLookup(graph);
    expect(
      strict.resolveByImportPath("/proj/app.ts", "./users", "router"),
    ).toEqual([]);
  });
});
