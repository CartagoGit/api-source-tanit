/**
 * `enrich` no puede destruir la colección.
 *
 * El comando descubre endpoints por el camino **legacy de Laravel**, no
 * por el registro de scanners. En los otros veinte frameworks
 * `discovered.specs` sale vacío — y aun así escribía.
 *
 * Con `--in-place` eso significaba escribir la colección vacía **encima
 * de la buena**: se midió sobre `example-express`, donde una colección
 * de 27.514 bytes con nueve requests quedó en 502 bytes con ninguna.
 * Imprimiendo `✔ Colección principal escrita` y saliendo con 0, así que
 * ni la persona ni un script se enteraban.
 *
 * Escribir cero endpoints no es un resultado: es haber fallado al
 * descubrirlos.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CLI_ENTRYPOINT, exampleDir } from "../../scripts/helpers/root.helper";
import { copyExampleClean } from "../helpers/fixtures";
import { runProcess } from "../helpers/run-process";

let work = "";
let project = "";
let collection = "";

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "enrich-cmd-"));
  project = join(work, "proj");
  await copyExampleClean(exampleDir("express"), project);
  await runProcess("bun", ["run", CLI_ENTRYPOINT, "generate", "--project-root", project]);
  collection = join(project, "export-to-postman", "sample-express.postman_collection.json");
}, 180_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

function enrich(...extra: string[]): Promise<{ code: number; output: string }> {
  return runProcess("bun", [
    "run",
    CLI_ENTRYPOINT,
    "enrich",
    "--project-root",
    project,
    ...extra,
  ]);
}

describe("enrich sobre un proyecto que no es Laravel", () => {
  test("la colección de partida es real", { timeout: 60_000 }, async () => {
    const doc = JSON.parse(await readFile(collection, "utf8")) as { item: unknown[] };
    expect(doc.item.length).toBeGreaterThan(0);
    expect((await stat(collection)).size).toBeGreaterThan(10_000);
  });

  // EL test. Sin la guarda, esto dejaba el fichero en 502 bytes.
  test("`--in-place` no vacía la colección", { timeout: 60_000 }, async () => {
    const antes = await readFile(collection, "utf8");
    await enrich("--in-place");
    expect(await readFile(collection, "utf8")).toBe(antes);
  });

  test("falla en vez de fingir que ha ido bien", { timeout: 60_000 }, async () => {
    const { code } = await enrich("--in-place");
    expect(code).toBe(1);
  });

  test("dice qué pasó y qué usar en su lugar", { timeout: 60_000 }, async () => {
    const { output } = await enrich();
    expect(output).toContain("no se escribe nada");
    // Un error que no dice la salida deja a la persona igual de atascada.
    expect(output).toContain("generate");
  });

  test("tampoco escribe el fichero `.enriched.json`", { timeout: 60_000 }, async () => {
    await enrich();
    const enriched = join(
      project,
      "export-to-postman",
      "sample-express.postman_collection.enriched.json",
    );
    await expect(stat(enriched)).rejects.toThrow();
  });
});

describe("enrich sobre Laravel, que es lo que sí sabe hacer", () => {
  test("sigue enriqueciendo", { timeout: 120_000 }, async () => {
    const laravel = await mkdtemp(join(tmpdir(), "enrich-lar-"));
    try {
      const root = join(laravel, "proj");
      await copyExampleClean(exampleDir("laravel"), root);
      const { code, output } = await runProcess("bun", [
        "run",
        CLI_ENTRYPOINT,
        "enrich",
        "--project-root",
        root,
      ]);
      expect(code).toBe(0);
      expect(output).toMatch(/[1-9]\d* requests/);
    } finally {
      await rm(laravel, { recursive: true, force: true });
    }
  });
});
