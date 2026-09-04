/**
 * El tool `init`, y la única pregunta que importa de él: **¿lo que
 * escribe sirve?**
 *
 * Un scaffolder que produce un fichero sintácticamente correcto pero que
 * el pipeline no puede cargar, o que empeora el resultado, es peor que
 * no tener scaffolder: deja el proyecto en un estado que parece
 * configurado.
 *
 * Y no es hipotético. `init` **empeoraba** el proyecto: leía solo
 * `composer.json` para el nombre —herencia de cuando esto era una
 * herramienta de Laravel— y si no lo encontraba se quedaba con el nombre
 * del directorio. Sobre `example-express`, `summary` decía
 * `sample-express` antes de ejecutarlo y el nombre de la carpeta
 * después, porque la config generada pisa la detección buena.
 *
 * Por eso el test central no mira el fichero: **genera con él y sin él,
 * y compara**.
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

/** El CLI de verdad, devolviendo su salida. */
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
    // La carpeta se llama `con-init`; el manifiesto dice `sample-express`.
    expect(salida["projectName"]).toBe("sample-express");
    expect(salida["projectName"]).not.toBe("con-init");
  });

  test("dice dónde ha escrito las dos cosas", { timeout: 120_000 }, async () => {
    const { salida } = await invocar({ projectRoot: conInit });
    expect(String(salida["configPath"])).toContain("config.constant.ts");
    expect(String(salida["endpointsPath"])).toContain("endpoints.constant.ts");
    // Y dentro del proyecto que se le pidió, no en otro sitio.
    expect(String(salida["configPath"]).startsWith(conInit)).toBe(true);
  });

  test("los ficheros existen de verdad en disco", { timeout: 120_000 }, async () => {
    const { salida } = await invocar({ projectRoot: conInit });
    const config = await readFile(String(salida["configPath"]), "utf8");
    expect(config).toContain("export const config");
    expect(config).toContain("sample-express");
  });

  /**
   * Los `// TODO` no son ruido: son el contrato con quien lo lee. Sin
   * ellos, un fichero de configuración generado parece una decisión
   * tomada en vez de un punto de partida.
   */
  test("señala qué hay que personalizar", { timeout: 120_000 }, async () => {
    const { salida } = await invocar({ projectRoot: conInit });
    const config = await readFile(String(salida["configPath"]), "utf8");
    expect(config).toContain("TODO");
  });
});

describe("y sobre todo: lo que escribe no estropea nada", () => {
  /**
   * EL test. Se genera en los dos proyectos —uno con la config de
   * `init`, otro sin nada— y tienen que salir los mismos endpoints.
   *
   * Si `init` degradara la detección, aquí saldrían cifras distintas, y
   * es exactamente lo que pasaba con el nombre del proyecto.
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
      /(\d+) requests in (\d+) folders/.exec(texto)?.[0] ?? "sin cifras";

    expect(requests(salidaCon), salidaCon).toBe(requests(salidaSin));
    expect(requests(salidaCon)).not.toBe("sin cifras");
  });

  /**
   * El nombre de la colección sale del proyecto, no del directorio. Es
   * la regresión concreta que hubo: con la config generada pisando la
   * detección, la colección pasaba a llamarse como la carpeta.
   *
   * Se mira el fichero **escrito**, no la traza. Escribir este test
   * destapó que la traza previa al escaneo anunciaba
   * `<carpeta>.postman_collection.json` mientras el CLI escribía
   * `<proyecto>.postman_collection.json` — ya arreglado en
   * `describeDiscoveredPaths`, con su propio test en core.
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
