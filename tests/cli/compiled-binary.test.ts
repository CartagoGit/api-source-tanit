/**
 * El binario compilado funciona sin runtime de JavaScript.
 *
 * `bun build --compile` produce un ejecutable autocontenido, pero solo
 * si todo el código está dentro. Mientras el CLI spawneaba
 * `bun run <script>`, el binario compilaba sin errores y luego fallaba
 * en ejecución con `Module not found "/scripts/generate.script.ts"`:
 * dentro del ejecutable no hay ficheros que resolver.
 *
 * Estos tests compilan de verdad y ejecutan el resultado con un PATH sin
 * `bun`, que es la única forma de comprobar que no queda una dependencia
 * escondida del runtime.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { moduleDir } from "../../helper/module-path.helper";
import { runProcess } from "../helpers/run-process";
import { OUTPUT_DIR_NAME } from "../../contract/postman.constant";

const PACKAGE_ROOT = resolve(moduleDir(import.meta.url), "../..");
const ENTRYPOINT = join(PACKAGE_ROOT, "scripts", "cli.script.ts");
const SAMPLE_PROJECT = join(PACKAGE_ROOT, "examples", "example-express");

let workDir = "";
let binary = "";
let project = "";

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "postman-binary-"));
  binary = join(workDir, "postman-from-routes");
  project = join(workDir, "mi-api");
  await cp(SAMPLE_PROJECT, project, { recursive: true });

  await runProcess("bun", ["build", "--compile", ENTRYPOINT, "--outfile", binary], {
    cwd: PACKAGE_ROOT,
  });
}, 120_000);

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

/** Ejecuta el binario con un PATH que NO contiene bun ni node. */
async function runWithoutRuntime(
  args: string[],
): Promise<{ code: number; output: string }> {
  return runProcess(binary, args, {
    cwd: workDir,
    // El PATH recortado es el fondo del test: si el binario necesitase
    // un bun o un node instalados, aquí no los encuentra y falla. Tiene
    // que ser `exactEnv`, no `env`: heredando el PATH real el test
    // pasaría siempre sin comprobar nada.
    exactEnv: { PATH: "/usr/bin:/bin", HOME: workDir },
  });
}

describe("binario compilado", () => {
  test("se compila", () => {
    expect(existsSync(binary)).toBe(true);
  });

  test("`--help` responde sin bun en el PATH", async () => {
    const { code, output } = await runWithoutRuntime(["--help"]);
    expect(code).toBe(0);
    for (const command of ["generate", "check", "list", "stats", "validate"]) {
      expect(output).toContain(command);
    }
  });

  // Es el fallo exacto que tenía antes de importar los comandos.
  test("no busca ficheros del repo en tiempo de ejecución", async () => {
    const { output } = await runWithoutRuntime(["generate", "--project-root", project]);
    expect(output).not.toContain("Module not found");
  });

  test("genera la colección sin runtime de JavaScript", async () => {
    const { code } = await runWithoutRuntime(["generate", "--project-root", project]);
    expect(code).toBe(0);

    const files = await readdir(join(project, OUTPUT_DIR_NAME));
    const collectionFile = files.find((f) => f.endsWith(".postman_collection.json"));
    expect(collectionFile).toBeDefined();

    const collection = JSON.parse(
      await readFile(join(project, OUTPUT_DIR_NAME, collectionFile!), "utf8"),
    ) as { info: { schema: string }; item: Array<Record<string, unknown>> };

    expect(collection.info.schema).toContain("2.1.0");
    expect(countRequests(collection.item)).toBe(9);
  });

  test("rechaza un comando desconocido con exit code 1", async () => {
    const { code, output } = await runWithoutRuntime(["comando-inventado"]);
    expect(code).toBe(1);
    expect(output).toContain("Unknown command");
  });
}, 120_000);

function countRequests(items: ReadonlyArray<Record<string, any>>): number {
  return items.reduce(
    (total, item) => total + (item["item"] ? countRequests(item["item"]) : 1),
    0,
  );
}
