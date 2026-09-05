import { describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fromProjectRoot, hasProjectDir, projectDirs, resolveProjectContext, toProjectRelative } from "../../packages/core/discovery/project-context.service";
import { createTempProject } from "../helpers/scanner-fixture";
import { OUTPUT_DIR_NAME } from "../../packages/contracts/constants/core/postman.constant";

const ctx = (projectRoot: string) => resolveProjectContext({ projectRoot });

describe("resolveProjectContext — where the root comes from", () => {
  test("the explicit parameter wins", () => {
    expect(ctx("/tmp/mi-api").projectRoot).toBe("/tmp/mi-api");
  });

  test("resolves a relative path to absolute", () => {
    expect(resolveProjectContext({ projectRoot: "." }).projectRoot).toBe(resolve("."));
  });

  test("reads --project-root from argv", () => {
    const context = resolveProjectContext({
      argv: ["bun", "cli", "--project-root", "/tmp/desde-argv"],
    });
    expect(context.projectRoot).toBe("/tmp/desde-argv");
  });

  test("reads POSTMAN_PROJECT_ROOT from the environment", () => {
    const context = resolveProjectContext({
      env: { POSTMAN_PROJECT_ROOT: "/tmp/desde-env" },
    });
    expect(context.projectRoot).toBe("/tmp/desde-env");
  });

  test("the parameter wins over argv and the environment", () => {
    const context = resolveProjectContext({
      projectRoot: "/tmp/gana",
      argv: ["--project-root", "/tmp/argv"],
      env: { POSTMAN_PROJECT_ROOT: "/tmp/env" },
    });
    expect(context.projectRoot).toBe("/tmp/gana");
  });

  test("argv wins over the environment", () => {
    const context = resolveProjectContext({
      argv: ["--project-root", "/tmp/argv"],
      env: { POSTMAN_PROJECT_ROOT: "/tmp/env" },
    });
    expect(context.projectRoot).toBe("/tmp/argv");
  });

  // Continuing with a guessed root produces empty collections without
  // saying why; that was exactly the CLI bug with `--project-root`.
  test("with no source throws an actionable message", () => {
    expect(() => resolveProjectContext({ argv: [], env: {} })).toThrow(
      /--project-root|POSTMAN_PROJECT_ROOT/,
    );
  });
});

describe("resolveProjectContext — derivatives", () => {
  test("the default outputDir is <root>/build", () => {
    expect(ctx("/tmp/mi-api").outputDir).toBe(join("/tmp/mi-api", OUTPUT_DIR_NAME));
  });

  test("respects an explicit outputDir", () => {
    const context = resolveProjectContext({
      projectRoot: "/tmp/mi-api",
      outputDir: "/tmp/salida",
    });
    expect(context.outputDir).toBe("/tmp/salida");
  });

  test("reads --output-dir from argv", () => {
    const context = resolveProjectContext({
      projectRoot: "/tmp/mi-api",
      argv: ["--output-dir", "/tmp/flag"],
    });
    expect(context.outputDir).toBe("/tmp/flag");
  });

  test("reads POSTMAN_OUTPUT_DIR from the environment", () => {
    const context = resolveProjectContext({
      projectRoot: "/tmp/mi-api",
      env: { POSTMAN_OUTPUT_DIR: "/tmp/env-out" },
    });
    expect(context.outputDir).toBe("/tmp/env-out");
  });

  test("the basename comes from the last segment of the root", () => {
    expect(ctx("/tmp/proyectos/mi-api").projectBasename).toBe("mi-api");
  });

  /**
   * That it points to **this** package is checked by looking at what
   * it contains, not by the folder's name. The directory name belongs
   * to the environment: whoever clones elsewhere, or builds in a
   * container that mounts at `/work`, has a different one.
   */
  test("the packageRoot points to this package", () => {
    const pkgRoot = ctx("/tmp/x").packageRoot;
    expect(isAbsolute(pkgRoot)).toBe(true);
    expect(existsSync(join(pkgRoot, "package.json"))).toBe(true);
  });
});

// The underlying problem of the singleton: two projects in the same
// process.
describe("resolveProjectContext — reentrancy", () => {
  test("two contexts coexist without clashing", () => {
    const a = ctx("/tmp/proyecto-a");
    const b = ctx("/tmp/proyecto-b");
    expect(a.projectRoot).toBe("/tmp/proyecto-a");
    expect(b.projectRoot).toBe("/tmp/proyecto-b");
  });

  test("each call returns a new object", () => {
    expect(ctx("/tmp/x")).not.toBe(ctx("/tmp/x"));
  });

  test("does not touch process.env", () => {
    const before = process.env["POSTMAN_PROJECT_ROOT"];
    resolveProjectContext({ projectRoot: "/tmp/x" });
    expect(process.env["POSTMAN_PROJECT_ROOT"]).toBe(before);
  });
});

describe("projectDirs", () => {
  test("derives routes, app and requests from the root", () => {
    const dirs = projectDirs(ctx("/tmp/mi-api"));
    expect(dirs.routes).toBe(join("/tmp/mi-api", "routes"));
    expect(dirs.app).toBe(join("/tmp/mi-api", "app"));
    expect(dirs.requests).toBe(join("/tmp/mi-api", "app", "Http", "Requests"));
  });
});

describe("fromProjectRoot / toProjectRelative", () => {
  test("are inverses of each other", () => {
    const context = ctx("/tmp/mi-api");
    const abs = fromProjectRoot(context, "app/Http/Controllers/UserController.php");
    expect(toProjectRelative(context, abs)).toBe("app/Http/Controllers/UserController.php");
  });

  test("a path outside the project is returned as absolute", () => {
    expect(toProjectRelative(ctx("/tmp/mi-api"), "/otro/sitio/x.php")).toBe(
      "/otro/sitio/x.php",
    );
  });

  test("the result always uses POSIX separators", () => {
    const context = ctx("/tmp/mi-api");
    expect(toProjectRelative(context, "/tmp/mi-api/a/b/c.php")).toBe("a/b/c.php");
  });
});

// x00022 — previously the check was `startsWith(root)`, which falsely
// matched `/home/u/api-secret` against `/home/u/api`. The new formula
// (relative() + `..${sep}` / absolute guard) closes that hole.
describe("toProjectRelative — path containment (x00022)", () => {
  test("a sibling with a common prefix is NOT considered inside", () => {
    expect(toProjectRelative(ctx("/home/u/api"), "/home/u/api-secret/x.ts")).toBe(
      "/home/u/api-secret/x.ts",
    );
  });

  test("a path truly inside IS trimmed", () => {
    expect(toProjectRelative(ctx("/home/u/api"), "/home/u/api/sub/file.ts")).toBe(
      "sub/file.ts",
    );
  });

  test("the root itself maps to an empty string", () => {
    expect(toProjectRelative(ctx("/home/u/api"), "/home/u/api")).toBe("");
  });

  test("the root with a trailing slash still maps to an empty string", () => {
    expect(toProjectRelative(ctx("/home/u/api/"), "/home/u/api/")).toBe("");
  });
});

describe("hasProjectDir", () => {
  test("detects an existing subdirectory", async () => {
    const project = await createTempProject({ "routes/api.php": "<?php" });
    try {
      expect(hasProjectDir(ctx(project.root), "routes")).toBe(true);
      expect(hasProjectDir(ctx(project.root), "no-existe")).toBe(false);
    } finally {
      await project.cleanup();
    }
  });
});
