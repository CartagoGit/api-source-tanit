/**
 * The dry run: what would happen if we generated, without generating.
 *
 * What is checked is the only thing that makes a dry run useful:
 * **that it is accurate**. A dry run that says one thing and a
 * generation that does another is worse than having no dry run,
 * because it also gives confidence.
 *
 * That is why the test that closes the circle compares the plan with
 * what `generate` actually leaves on disk.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { planDryRun } from "../../packages/ui/server/dry-run.service";
import { generateWithAllFrameworks } from "../../packages/frameworks/index";
import { OUTPUT_DIR_NAME } from "../../packages/contracts/constants/core/postman.constant";
import { CLI_COMMANDS_DIR, exampleDir } from "../../scripts/helpers/root.helper";
import { copyExampleClean } from "../helpers/fixtures";
import { runProcess } from "../helpers/run-process";
import type { IGenerationResult } from "../../packages/contracts/interfaces/core/discovery.interface";

let work = "";
let proyecto = "";
let resultado: IGenerationResult;

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "ensayo-"));
  proyecto = join(work, "api");
  await copyExampleClean(exampleDir("express"), proyecto);
  resultado = await generateWithAllFrameworks(proyecto);
}, 240_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

describe("what the dry run says", () => {
  test("counts the requests the collection would have", () => {
    const plan = planDryRun({ projectRoot: proyecto, result: resultado });
    expect(plan.ok).toBe(true);
    expect(plan.requests).toBeGreaterThan(0);
  });

  test("names the framework and the project", () => {
    const plan = planDryRun({ projectRoot: proyecto, result: resultado });
    expect(plan.framework).toBe("express");
    expect(plan.projectName).toBe("sample-express");
  });

  test("by default goes to the conventional folder", () => {
    const plan = planDryRun({ projectRoot: proyecto, result: resultado });
    expect(plan.outputDir).toBe(join(proyecto, OUTPUT_DIR_NAME));
  });

  test("and respects the one it is given", () => {
    const plan = planDryRun({
      projectRoot: proyecto,
      outputDir: "/otro/sitio",
      result: resultado,
    });
    expect(plan.outputDir).toBe("/otro/sitio");
    expect(plan.files.every((f) => f.path.startsWith("/otro/sitio"))).toBe(true);
  });

  /**
   * Environments are Postman: they do not come out with an OpenAPI
   * nor with a cURL script, and promising them there would be lying
   * about what is going to appear.
   */
  test("environments only when Postman is requested", () => {
    const conPostman = planDryRun({ projectRoot: proyecto, result: resultado });
    const soloOpenApi = planDryRun({
      projectRoot: proyecto,
      formats: ["openapi"],
      result: resultado,
    });

    expect(conPostman.files.some((f) => f.kind === "environment")).toBe(true);
    expect(soloOpenApi.files.some((f) => f.kind === "environment")).toBe(false);
  });

  test("a made-up format invalidates the plan and says which ones are valid", () => {
    const plan = planDryRun({
      projectRoot: proyecto,
      formats: ["inventado"],
      result: resultado,
    });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toContain("postman");
  });
});

describe("what really scares: overwriting", () => {
  /**
   * The first time everything is new and the datum says nothing.
   * From the second on, it is the only question that matters: what
   * is lost.
   */
  test("on an empty folder overwrites nothing", async () => {
    const limpio = join(work, "limpio");
    await copyExampleClean(exampleDir("express"), limpio);
    const plan = planDryRun({ projectRoot: limpio, result: resultado });
    expect(plan.overwrites).toBe(0);
    expect(plan.files.every((f) => !f.overwrites)).toBe(true);
  });

  test("a file that is already there is marked, and counted", async () => {
    const conAlgo = join(work, "con-algo");
    await copyExampleClean(exampleDir("express"), conAlgo);
    const salida = join(conAlgo, OUTPUT_DIR_NAME);
    await rm(salida, { recursive: true, force: true });
    await mkdtemp(join(tmpdir(), "x-"));
    const { mkdir } = await import("node:fs/promises");
    await mkdir(salida, { recursive: true });
    await writeFile(
      join(salida, "sample-express.postman_collection.json"),
      "{}",
    );

    const plan = planDryRun({ projectRoot: conAlgo, result: resultado });
    expect(plan.overwrites).toBe(1);
    const coleccion = plan.files.find((f) => f.kind === "collection");
    expect(coleccion?.overwrites).toBe(true);
  });
});

describe("the dry run does not touch the disk", () => {
  /** If it did, it would stop being a dry run. */
  test("planning does not create the output folder", async () => {
    const intacto = join(work, "intacto");
    await copyExampleClean(exampleDir("express"), intacto);
    await rm(join(intacto, "export-to-postman"), { recursive: true, force: true });

    planDryRun({ projectRoot: intacto, result: resultado });

    await expect(readdir(join(intacto, "export-to-postman"))).rejects.toThrow();
  });
});

describe("and above all: it is accurate", () => {
  /**
   * THE test. A dry run that says one thing and a generation that
   * does another is worse than having no dry run, because it also
   * gives confidence. The plan is compared with what `generate`
   * actually leaves on disk.
   */
  test("what the dry run advertises is what `generate` writes", async () => {
    const real = join(work, "de-verdad");
    await copyExampleClean(exampleDir("express"), real);
    await rm(join(real, OUTPUT_DIR_NAME), { recursive: true, force: true });

    const plan = planDryRun({
      projectRoot: real,
      formats: ["postman", "openapi"],
      result: resultado,
    });

    await runProcess("bun", [
      join(CLI_COMMANDS_DIR, "generate.script.ts"),
      "--project-root",
      real,
      "--format",
      "postman,openapi",
    ]);

    const enDisco = (await readdir(join(real, OUTPUT_DIR_NAME))).sort();
    const anunciados = plan.files
      .map((f) => f.path.split("/").pop()!)
      .sort();

    expect(
      anunciados,
      `dry run announced ${anunciados.length} and ${enDisco.length} came out`,
    ).toEqual(enDisco);
  }, 240_000);
});
