/**
 * Where the tool writes, and where it does NOT.
 *
 * The output used to go to `${projectRoot}/build/`. `build/` is the
 * default output folder of Gradle, of Maven under certain
 * configurations, of many Go projects, and of half the Makefiles in
 * the world, so we were mixing collections with the build artifacts
 * of whoever used the tool — in a folder that their `clean` wipes
 * entirely.
 *
 * Now the output is `${projectRoot}/export-to-postman/`. Nobody has
 * a folder with that name; if they do, it is ours.
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

/** Content we leave in the project's `build/` to watch it. */
const SENTINEL = "no me toques\n";

let workDir = "";
let project = "";

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "output-dir-"));
  project = join(workDir, "proyecto-ajeno");
  await cp(SOURCE_PROJECT, project, { recursive: true });

  // The project already has its own `build/` with stuff inside, like
  // any Gradle or Go project would.
  await mkdir(join(project, "build"), { recursive: true });
  await writeFile(join(project, "build", "artefacto-del-usuario.jar"), SENTINEL);

  await runProcess("bun", [GENERATE, "--project-root", project], { cwd: REPO_ROOT });
}, 60_000);

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

describe("output folder", () => {
  test("writes to export-to-postman/, not to build/", async () => {
    expect(existsSync(join(project, OUTPUT_DIR_NAME))).toBe(true);
    const files = await readdir(join(project, OUTPUT_DIR_NAME));
    expect(files.some((f) => f.endsWith(".postman_collection.json"))).toBe(true);
  });

  // The real test: the user's `build/` is still as it was.
  test("does not touch the project's existing build/", async () => {
    const files = await readdir(join(project, "build"));
    expect(files).toEqual(["artefacto-del-usuario.jar"]);
    expect(await readFile(join(project, "build", "artefacto-del-usuario.jar"), "utf8")).toBe(
      SENTINEL,
    );
  });

  test("environments go to the same folder", async () => {
    const files = await readdir(join(project, OUTPUT_DIR_NAME));
    expect(files.filter((f) => f.endsWith(".postman_environment.json")).length).toBeGreaterThan(
      0,
    );
  });

  test("the constant carries no separators: it is a name, not a path", () => {
    expect(OUTPUT_DIR_NAME).not.toContain("/");
    expect(OUTPUT_DIR_NAME).not.toContain("\\");
    expect(OUTPUT_DIR_NAME).not.toContain(sep);
  });

  test("--output-dir still overrides", async () => {
    const custom = join(workDir, "otra-carpeta");
    await runProcess("bun", [GENERATE, "--project-root", project, "--output-dir", custom], {
      cwd: REPO_ROOT,
    });
    const files = await readdir(custom);
    expect(files.some((f) => f.endsWith(".postman_collection.json"))).toBe(true);
  }, 60_000);

  test("POSTMAN_OUTPUT_DIR too", async () => {
    const custom = join(workDir, "por-entorno");
    await runProcess("bun", [GENERATE, "--project-root", project], {
      cwd: REPO_ROOT,
      env: { POSTMAN_OUTPUT_DIR: custom },
    });
    const files = await readdir(custom);
    expect(files.some((f) => f.endsWith(".postman_collection.json"))).toBe(true);
  }, 60_000);
});
