/**
 * El ensayo: qué pasaría si se generara, sin generar.
 *
 * Lo que se comprueba es lo único que hace útil a un ensayo: **que
 * acierte**. Un ensayo que dice una cosa y una generación que hace otra
 * es peor que no tener ensayo, porque además da confianza.
 *
 * Por eso el test que cierra el círculo compara el plan con lo que
 * `generate` deja de verdad en disco.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { planDryRun } from "../../projects/ui/server/dry-run.service";
import { generateWithAllFrameworks } from "../../projects/frameworks/index";
import { CLI_COMMANDS_DIR, exampleDir } from "../../scripts/helpers/root.helper";
import { copyExampleClean } from "../helpers/fixtures";
import { runProcess } from "../helpers/run-process";
import type { IGenerationResult } from "../../projects/contracts/interfaces/core/discovery.interface";

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

describe("qué dice el ensayo", () => {
  test("cuenta las requests que tendría la colección", () => {
    const plan = planDryRun({ projectRoot: proyecto, result: resultado });
    expect(plan.ok).toBe(true);
    expect(plan.requests).toBeGreaterThan(0);
  });

  test("nombra el framework y el proyecto", () => {
    const plan = planDryRun({ projectRoot: proyecto, result: resultado });
    expect(plan.framework).toBe("express");
    expect(plan.projectName).toBe("sample-express");
  });

  test("por defecto va a la carpeta convencional", () => {
    const plan = planDryRun({ projectRoot: proyecto, result: resultado });
    expect(plan.outputDir).toBe(join(proyecto, "export-to-postman"));
  });

  test("y respeta la que se le pida", () => {
    const plan = planDryRun({
      projectRoot: proyecto,
      outputDir: "/otro/sitio",
      result: resultado,
    });
    expect(plan.outputDir).toBe("/otro/sitio");
    expect(plan.files.every((f) => f.path.startsWith("/otro/sitio"))).toBe(true);
  });

  /**
   * Los entornos son de Postman: no salen con un OpenAPI ni con un
   * script de cURL, y prometerlos ahí sería mentir sobre lo que va a
   * aparecer.
   */
  test("los entornos solo cuando se pide Postman", () => {
    const conPostman = planDryRun({ projectRoot: proyecto, result: resultado });
    const soloOpenApi = planDryRun({
      projectRoot: proyecto,
      formats: ["openapi"],
      result: resultado,
    });

    expect(conPostman.files.some((f) => f.kind === "environment")).toBe(true);
    expect(soloOpenApi.files.some((f) => f.kind === "environment")).toBe(false);
  });

  test("un formato inventado invalida el plan y dice cuáles valen", () => {
    const plan = planDryRun({
      projectRoot: proyecto,
      formats: ["inventado"],
      result: resultado,
    });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toContain("postman");
  });
});

describe("lo que de verdad asusta: sobrescribir", () => {
  /**
   * La primera vez todo es nuevo y el dato no dice nada. A partir de la
   * segunda es la única pregunta que importa: qué se pierde.
   */
  test("sobre una carpeta vacía no sobrescribe nada", async () => {
    const limpio = join(work, "limpio");
    await copyExampleClean(exampleDir("express"), limpio);
    const plan = planDryRun({ projectRoot: limpio, result: resultado });
    expect(plan.overwrites).toBe(0);
    expect(plan.files.every((f) => !f.overwrites)).toBe(true);
  });

  test("un fichero que ya está sale marcado, y contado", async () => {
    const conAlgo = join(work, "con-algo");
    await copyExampleClean(exampleDir("express"), conAlgo);
    const salida = join(conAlgo, "export-to-postman");
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

describe("el ensayo no toca el disco", () => {
  /** Si lo tocara, dejaría de ser un ensayo. */
  test("planificar no crea la carpeta de salida", async () => {
    const intacto = join(work, "intacto");
    await copyExampleClean(exampleDir("express"), intacto);
    await rm(join(intacto, "export-to-postman"), { recursive: true, force: true });

    planDryRun({ projectRoot: intacto, result: resultado });

    await expect(readdir(join(intacto, "export-to-postman"))).rejects.toThrow();
  });
});

describe("y sobre todo: acierta", () => {
  /**
   * EL test. Un ensayo que dice una cosa y una generación que hace otra
   * es peor que no tener ensayo, porque además da confianza. Se compara
   * el plan con lo que `generate` deja de verdad en disco.
   */
  test("lo que el ensayo anuncia es lo que `generate` escribe", async () => {
    const real = join(work, "de-verdad");
    await copyExampleClean(exampleDir("express"), real);
    await rm(join(real, "export-to-postman"), { recursive: true, force: true });

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

    const enDisco = (await readdir(join(real, "export-to-postman"))).sort();
    const anunciados = plan.files
      .map((f) => f.path.split("/").pop()!)
      .sort();

    expect(anunciados, `el ensayo anunció ${anunciados.length} y salieron ${enDisco.length}`)
      .toEqual(enDisco);
  }, 240_000);
});
