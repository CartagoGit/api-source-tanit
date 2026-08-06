/**
 * El CLI ejecutado sobre un proyecto EXTERNO al paquete.
 *
 * Es el caso de uso principal —alguien instala el paquete y lo lanza
 * contra su API— y era el único sin cobertura. Estuvo roto: el CLI
 * spawnea el script de generación con `cwd` = raíz del paquete, y el
 * pipeline resolvía la raíz del proyecto como `process.env.
 * POSTMAN_PROJECT_ROOT ?? "."`, así que `--project-root` se ignoraba y
 * el escaneo apuntaba al propio postman-exporter: colección vacía.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { moduleDir } from "../../helpers/module-path.helper";
import { runProcess } from "../helpers/run-process";
import { OUTPUT_DIR_NAME } from "../../contracts/postman.constant";

const PACKAGE_ROOT = resolve(moduleDir(import.meta.url), "../..");
const CLI = join(PACKAGE_ROOT, "scripts", "cli.script.ts");
const SOURCE_PROJECT = join(PACKAGE_ROOT, "examples", "example-express");

let externalProject = "";

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "postman-cli-external-"));
  externalProject = join(dir, "mi-api");
  await cp(SOURCE_PROJECT, externalProject, { recursive: true });
});

afterAll(async () => {
  if (externalProject) {
    await rm(resolve(externalProject, ".."), { recursive: true, force: true });
  }
});

async function runCli(args: string[]): Promise<{ code: number; output: string }> {
  return runProcess("bun", [CLI, ...args], { cwd: PACKAGE_ROOT });
}

async function readCollection(): Promise<Record<string, unknown>> {
  const buildDir = join(externalProject, OUTPUT_DIR_NAME);
  const files = await readdir(buildDir);
  const name = files.find((f) => f.endsWith(".postman_collection.json"));
  expect(name).toBeDefined();
  return JSON.parse(await readFile(join(buildDir, name!), "utf8")) as Record<string, unknown>;
}

function countRequests(items: ReadonlyArray<Record<string, any>>): number {
  return items.reduce(
    (total, item) => total + (item["item"] ? countRequests(item["item"]) : 1),
    0,
  );
}

describe("CLI sobre un proyecto externo", () => {
  test("`generate --project-root` escanea el proyecto indicado, no el paquete", async () => {
    const { code } = await runCli(["generate", "--project-root", externalProject]);
    expect(code).toBe(0);

    const collection = await readCollection();
    const requests = countRequests((collection["item"] as Record<string, any>[]) ?? []);
    // El fixture de express expone 9 endpoints. Antes salían 0.
    expect(requests).toBe(9);
  });

  test("detecta el framework del proyecto externo", async () => {
    const { output } = await runCli(["generate", "--project-root", externalProject]);
    expect(output).toContain("framework=express");
  });

  test("escribe la colección dentro del proyecto, no del paquete", async () => {
    await runCli(["generate", "--project-root", externalProject]);
    const files = await readdir(join(externalProject, OUTPUT_DIR_NAME));
    expect(files.some((f) => f.endsWith(".postman_collection.json"))).toBe(true);
  });

  test("genera también los environments", async () => {
    await runCli(["generate", "--project-root", externalProject]);
    const files = await readdir(join(externalProject, OUTPUT_DIR_NAME));
    expect(files.filter((f) => f.endsWith(".postman_environment.json")).length).toBeGreaterThan(
      0,
    );
  });

  test("la colección resultante es Postman v2.1.0 con id estable", async () => {
    await runCli(["generate", "--project-root", externalProject]);
    const first = (await readCollection())["info"] as Record<string, string>;
    await runCli(["generate", "--project-root", externalProject]);
    const second = (await readCollection())["info"] as Record<string, string>;

    expect(first["schema"]).toContain("2.1.0");
    expect(first["_postman_id"]).toBe(second["_postman_id"]!);
  });

  test("`--help` documenta los comandos disponibles", async () => {
    const { output } = await runCli(["--help"]);
    for (const command of ["generate", "check", "enrich", "list", "stats", "validate"]) {
      expect(output).toContain(command);
    }
  });
});
