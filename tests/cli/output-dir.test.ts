/**
 * Dónde escribe la herramienta, y dónde NO.
 *
 * La salida iba a `${projectRoot}/build/`. `build/` es la carpeta de
 * salida por defecto de Gradle, de Maven con ciertas configuraciones, de
 * muchos proyectos de Go y de la mitad de los Makefile del mundo, así
 * que estábamos mezclando colecciones con los artefactos de compilación
 * de quien usa la herramienta — en una carpeta que su `clean` borra
 * entera.
 *
 * Ahora la salida es `${projectRoot}/export-to-postman/`. Nadie tiene
 * una carpeta con ese nombre; si la tiene, es la nuestra.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";

import { OUTPUT_DIR_NAME } from "../../packages/contracts/constants/core/postman.constant";
import { runProcess } from "../helpers/run-process";
import { CLI_COMMANDS_DIR, REPO_ROOT, exampleDir } from "../../scripts/helpers/root.helper";

const GENERATE = join(CLI_COMMANDS_DIR, "generate.script.ts");
const SOURCE_PROJECT = exampleDir("express");

/** Contenido que dejamos en el `build/` del proyecto para vigilarlo. */
const SENTINEL = "no me toques\n";

let workDir = "";
let project = "";

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "output-dir-"));
  project = join(workDir, "proyecto-ajeno");
  await cp(SOURCE_PROJECT, project, { recursive: true });

  // El proyecto ya tiene su propio `build/` con cosas dentro, como
  // tendría cualquier proyecto de Gradle o de Go.
  await mkdir(join(project, "build"), { recursive: true });
  await writeFile(join(project, "build", "artefacto-del-usuario.jar"), SENTINEL);

  await runProcess("bun", [GENERATE, "--project-root", project], { cwd: REPO_ROOT });
}, 60_000);

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

describe("carpeta de salida", () => {
  test("escribe en export-to-postman/, no en build/", async () => {
    expect(existsSync(join(project, OUTPUT_DIR_NAME))).toBe(true);
    const files = await readdir(join(project, OUTPUT_DIR_NAME));
    expect(files.some((f) => f.endsWith(".postman_collection.json"))).toBe(true);
  });

  // El test de verdad: el `build/` del usuario sigue como estaba.
  test("no toca el build/ que ya tenía el proyecto", async () => {
    const files = await readdir(join(project, "build"));
    expect(files).toEqual(["artefacto-del-usuario.jar"]);
    expect(await readFile(join(project, "build", "artefacto-del-usuario.jar"), "utf8")).toBe(
      SENTINEL,
    );
  });

  test("los environments van a la misma carpeta", async () => {
    const files = await readdir(join(project, OUTPUT_DIR_NAME));
    expect(files.filter((f) => f.endsWith(".postman_environment.json")).length).toBeGreaterThan(
      0,
    );
  });

  test("la constante no lleva separadores: es un nombre, no una ruta", () => {
    expect(OUTPUT_DIR_NAME).not.toContain("/");
    expect(OUTPUT_DIR_NAME).not.toContain("\\");
    expect(OUTPUT_DIR_NAME).not.toContain(sep);
  });

  test("--output-dir sigue mandando por encima", async () => {
    const custom = join(workDir, "otra-carpeta");
    await runProcess("bun", [GENERATE, "--project-root", project, "--output-dir", custom], {
      cwd: REPO_ROOT,
    });
    const files = await readdir(custom);
    expect(files.some((f) => f.endsWith(".postman_collection.json"))).toBe(true);
  }, 60_000);

  test("POSTMAN_OUTPUT_DIR también", async () => {
    const custom = join(workDir, "por-entorno");
    await runProcess("bun", [GENERATE, "--project-root", project], {
      cwd: REPO_ROOT,
      env: { POSTMAN_OUTPUT_DIR: custom },
    });
    const files = await readdir(custom);
    expect(files.some((f) => f.endsWith(".postman_collection.json"))).toBe(true);
  }, 60_000);
});
