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
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const PACKAGE_ROOT = resolve(import.meta.dir, "../..");
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

  const build = Bun.spawn(
    ["bun", "build", "--compile", ENTRYPOINT, "--outfile", binary],
    { cwd: PACKAGE_ROOT, stdout: "pipe", stderr: "pipe" },
  );
  await build.exited;
}, 120_000);

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

/** Ejecuta el binario con un PATH que NO contiene bun ni node. */
async function runWithoutRuntime(
  args: string[],
): Promise<{ code: number; output: string }> {
  const proc = Bun.spawn([binary, ...args], {
    cwd: workDir,
    env: { PATH: "/usr/bin:/bin", HOME: workDir },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, output: stdout + stderr };
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

    const files = await readdir(join(project, "build"));
    const collectionFile = files.find((f) => f.endsWith(".postman_collection.json"));
    expect(collectionFile).toBeDefined();

    const collection = JSON.parse(
      await readFile(join(project, "build", collectionFile!), "utf8"),
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
