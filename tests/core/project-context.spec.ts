import { describe, expect, test } from "vitest";
import { join, resolve } from "node:path";
import {
  fromProjectRoot,
  hasProjectDir,
  projectDirs,
  resolveProjectContext,
  toProjectRelative,
} from "../../projects/core/discovery/project-context.service";
import { createTempProject } from "../helpers/scanner-fixture";
import { OUTPUT_DIR_NAME } from "../../projects/core/contracts/postman.constant";

const ctx = (projectRoot: string) => resolveProjectContext({ projectRoot });

describe("resolveProjectContext — de dónde sale la raíz", () => {
  test("el parámetro explícito manda", () => {
    expect(ctx("/tmp/mi-api").projectRoot).toBe("/tmp/mi-api");
  });

  test("resuelve una ruta relativa a absoluta", () => {
    expect(resolveProjectContext({ projectRoot: "." }).projectRoot).toBe(resolve("."));
  });

  test("lee --project-root de argv", () => {
    const context = resolveProjectContext({
      argv: ["bun", "cli", "--project-root", "/tmp/desde-argv"],
    });
    expect(context.projectRoot).toBe("/tmp/desde-argv");
  });

  test("lee POSTMAN_PROJECT_ROOT del entorno", () => {
    const context = resolveProjectContext({
      env: { POSTMAN_PROJECT_ROOT: "/tmp/desde-env" },
    });
    expect(context.projectRoot).toBe("/tmp/desde-env");
  });

  test("el parámetro gana a argv y al entorno", () => {
    const context = resolveProjectContext({
      projectRoot: "/tmp/gana",
      argv: ["--project-root", "/tmp/argv"],
      env: { POSTMAN_PROJECT_ROOT: "/tmp/env" },
    });
    expect(context.projectRoot).toBe("/tmp/gana");
  });

  test("argv gana al entorno", () => {
    const context = resolveProjectContext({
      argv: ["--project-root", "/tmp/argv"],
      env: { POSTMAN_PROJECT_ROOT: "/tmp/env" },
    });
    expect(context.projectRoot).toBe("/tmp/argv");
  });

  // Seguir con una raíz adivinada produce colecciones vacías sin decir
  // por qué; fue exactamente el bug del CLI con `--project-root`.
  test("sin ninguna fuente lanza con un mensaje accionable", () => {
    expect(() => resolveProjectContext({ argv: [], env: {} })).toThrow(
      /--project-root|POSTMAN_PROJECT_ROOT/,
    );
  });
});

describe("resolveProjectContext — derivados", () => {
  test("el outputDir por defecto es <raíz>/build", () => {
    expect(ctx("/tmp/mi-api").outputDir).toBe(join("/tmp/mi-api", OUTPUT_DIR_NAME));
  });

  test("respeta un outputDir explícito", () => {
    const context = resolveProjectContext({
      projectRoot: "/tmp/mi-api",
      outputDir: "/tmp/salida",
    });
    expect(context.outputDir).toBe("/tmp/salida");
  });

  test("lee --output-dir de argv", () => {
    const context = resolveProjectContext({
      projectRoot: "/tmp/mi-api",
      argv: ["--output-dir", "/tmp/flag"],
    });
    expect(context.outputDir).toBe("/tmp/flag");
  });

  test("lee POSTMAN_OUTPUT_DIR del entorno", () => {
    const context = resolveProjectContext({
      projectRoot: "/tmp/mi-api",
      env: { POSTMAN_OUTPUT_DIR: "/tmp/env-out" },
    });
    expect(context.outputDir).toBe("/tmp/env-out");
  });

  test("el basename sale del último segmento de la raíz", () => {
    expect(ctx("/tmp/proyectos/mi-api").projectBasename).toBe("mi-api");
  });

  test("el packageRoot apunta a este paquete", () => {
    const pkgRoot = ctx("/tmp/x").packageRoot;
    expect(pkgRoot.includes("export-to-postman") || pkgRoot.includes("postman-exporter")).toBe(true);
  });
});

// El problema de fondo del singleton: dos proyectos en el mismo proceso.
describe("resolveProjectContext — reentrancia", () => {
  test("dos contextos coexisten sin pisarse", () => {
    const a = ctx("/tmp/proyecto-a");
    const b = ctx("/tmp/proyecto-b");
    expect(a.projectRoot).toBe("/tmp/proyecto-a");
    expect(b.projectRoot).toBe("/tmp/proyecto-b");
  });

  test("cada llamada devuelve un objeto nuevo", () => {
    expect(ctx("/tmp/x")).not.toBe(ctx("/tmp/x"));
  });

  test("no toca process.env", () => {
    const before = process.env["POSTMAN_PROJECT_ROOT"];
    resolveProjectContext({ projectRoot: "/tmp/x" });
    expect(process.env["POSTMAN_PROJECT_ROOT"]).toBe(before);
  });
});

describe("projectDirs", () => {
  test("deriva routes, app y requests de la raíz", () => {
    const dirs = projectDirs(ctx("/tmp/mi-api"));
    expect(dirs.routes).toBe(join("/tmp/mi-api", "routes"));
    expect(dirs.app).toBe(join("/tmp/mi-api", "app"));
    expect(dirs.requests).toBe(join("/tmp/mi-api", "app", "Http", "Requests"));
  });
});

describe("fromProjectRoot / toProjectRelative", () => {
  test("son inversos entre sí", () => {
    const context = ctx("/tmp/mi-api");
    const abs = fromProjectRoot(context, "app/Http/Controllers/UserController.php");
    expect(toProjectRelative(context, abs)).toBe("app/Http/Controllers/UserController.php");
  });

  test("una ruta fuera del proyecto se devuelve absoluta", () => {
    expect(toProjectRelative(ctx("/tmp/mi-api"), "/otro/sitio/x.php")).toBe(
      "/otro/sitio/x.php",
    );
  });

  test("el resultado usa siempre separadores POSIX", () => {
    const context = ctx("/tmp/mi-api");
    expect(toProjectRelative(context, "/tmp/mi-api/a/b/c.php")).toBe("a/b/c.php");
  });
});

describe("hasProjectDir", () => {
  test("detecta un subdirectorio existente", async () => {
    const project = await createTempProject({ "routes/api.php": "<?php" });
    try {
      expect(hasProjectDir(ctx(project.root), "routes")).toBe(true);
      expect(hasProjectDir(ctx(project.root), "no-existe")).toBe(false);
    } finally {
      await project.cleanup();
    }
  });
});
