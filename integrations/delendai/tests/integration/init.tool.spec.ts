/**
 * The `init` tool, and the only question that matters about it:
 * **is what it writes usable?**
 *
 * A scaffolder that produces a syntactically correct file that the
 * pipeline cannot load, or that makes the result worse, is worse than
 * no scaffolder at all: it leaves the project in a state that looks
 * configured.
 *
 * And it is not hypothetical. `init` **used to make the project
 * worse**: it only read `composer.json` for the name — a leftover
 * from when this was a Laravel tool — and if it could not find one
 * it kept the directory name. On `example-express`, `summary` would
 * say `sample-express` before running it and the folder name after,
 * because the generated config overrode the good detection.
 *
 * That is why the central test does not inspect the file: it
 * **generates with it and without it, and compares**.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildInitToolRegistration } from "../../src/lib/tools/init.tool";
import { captureTool, makeContext, workspaceRoot } from "../helpers/plugin-context";

const RAIZ = workspaceRoot(import.meta.url);

let work = "";
let conInit = "";
let sinInit = "";

/** The real CLI, returning its output. */
function cli(args: readonly string[]): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(
      "bun",
      ["run", join(RAIZ, "packages/cli/cli.script.ts"), ...args],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let salida = "";
    child.stdout?.on("data", (d: Buffer) => (salida += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (salida += d.toString()));
    child.on("close", () => resolve(salida));
    child.on("error", () => resolve(salida));
  });
}

async function copiaLimpia(destino: string): Promise<void> {
  await cp(join(RAIZ, "examples/example-express"), destino, { recursive: true });
  await rm(join(destino, "tanit"), { recursive: true, force: true });
}

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "init-tool-"));
  conInit = join(work, "con-init");
  sinInit = join(work, "sin-init");
  await Promise.all([copiaLimpia(conInit), copiaLimpia(sinInit)]);
}, 240_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

async function invocar(input: Record<string, unknown>) {
  const tool = await captureTool(
    buildInitToolRegistration(makeContext({ workspaceRoot: RAIZ })),
  );
  const resultado = await tool.handler(input);
  return {
    resultado,
    salida: JSON.parse(resultado.content[0]?.text ?? "{}") as Record<string, unknown>,
  };
}

describe("lo que init detecta", () => {
  test("devuelve el nombre real del proyecto, no el de la carpeta", {
    timeout: 120_000,
  }, async () => {
    const { salida } = await invocar({ projectRoot: conInit });
    // The folder is named `con-init`; the manifest says `sample-express`.
    expect(salida["projectName"]).toBe("sample-express");
    expect(salida["projectName"]).not.toBe("con-init");
  });

  test("dice dónde ha escrito las dos cosas", { timeout: 120_000 }, async () => {
    const { salida } = await invocar({ projectRoot: conInit });
    expect(String(salida["configPath"])).toContain("config.constant.ts");
    expect(String(salida["endpointsPath"])).toContain("endpoints.constant.ts");
    // And inside the project it was given, not somewhere else.
    expect(String(salida["configPath"]).startsWith(conInit)).toBe(true);
  });

  test("los ficheros existen de verdad en disco", { timeout: 120_000 }, async () => {
    const { salida } = await invocar({ projectRoot: conInit });
    const config = await readFile(String(salida["configPath"]), "utf8");
    expect(config).toContain("export const config");
    expect(config).toContain("sample-express");
  });

  /**
   * The `// TODO`s are not noise: they are the contract with whoever
   * reads them. Without them, a generated config file looks like a
   * decision made instead of a starting point.
   */
  test("señala qué hay que personalizar", { timeout: 120_000 }, async () => {
    const { salida } = await invocar({ projectRoot: conInit });
    const config = await readFile(String(salida["configPath"]), "utf8");
    expect(config).toContain("TODO");
  });
});

describe("and above all: what it writes does not break anything", () => {
  /**
   * THE test. We generate in both projects — one with `init`'s
   * config, one without anything — and the endpoints must come out
   * identical.
   *
   * If `init` degraded detection, different numbers would come out
   * here, which is exactly what was happening with the project
   * name.
   */
  test("generar con la config de init da lo mismo que sin ella", {
    timeout: 240_000,
  }, async () => {
    await invocar({ projectRoot: conInit });

    const [salidaCon, salidaSin] = await Promise.all([
      cli(["generate", "--project-root", conInit]),
      cli(["generate", "--project-root", sinInit]),
    ]);

    const requests = (texto: string): string =>
      /(\d+) requests in (\d+) folders/.exec(texto)?.[0] ?? "no figures";

    expect(requests(salidaCon), salidaCon).toBe(requests(salidaSin));
    expect(requests(salidaCon)).not.toBe("no figures");
  });

  /**
   * The collection name comes from the project, not the directory.
   * It is the concrete regression we had: with the generated config
   * overriding detection, the collection ended up named after the
   * folder.
   *
   * We check the **written** file, not the trace. Writing this test
   * uncovered that the pre-scan trace announced
   * `<folder>.postman_collection.json` while the CLI wrote
   * `<project>.postman_collection.json` — already fixed in
   * `describeDiscoveredPaths`, with its own test in core.
   */
  test("la colección sigue llamándose como el proyecto", {
    timeout: 240_000,
  }, async () => {
    await invocar({ projectRoot: conInit });
    const salida = await cli(["generate", "--project-root", conInit]);
    const escrita = /Collection written to (\S+)/.exec(salida)?.[1] ?? "";
    expect(escrita).toContain("sample-express.postman_collection.json");
  });
});

describe("lo que no puede hacer, lo dice", () => {
  test("un projectRoot que no existe da error con salida", async () => {
    const { resultado } = await invocar({ projectRoot: "/no/existe/zzz" });
    expect(resultado.isError).toBe(true);
    expect(resultado.content[0]?.text ?? "").toContain("no existe");
  });
});
