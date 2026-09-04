/**
 * Los lanzadores de `bin/`.
 *
 * Su contrato es corto y hay que defenderlo: **resuelven el motor y le
 * pasan los argumentos, y nada más**. La versión anterior de esto
 * (`runtime/`, retirada en p00021) reimplementaba el generador en Node,
 * Python y PHP; las tres copias divergieron del original y ninguna
 * tenía un solo test. Cuando el proyecto se hizo agnóstico, las tres
 * seguían siendo solo-Laravel y nadie se enteró.
 *
 * Por eso lo que se comprueba aquí no es tanto que funcionen —eso
 * depende de la plataforma— como que **sigan siendo finos**: si alguno
 * empieza a hablar de rutas, frameworks o colecciones, está mal.
 */
import { describe, expect, test } from "vitest";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { REPO_ROOT, fromRoot } from "../../scripts/helpers/root.helper";
import { runProcess } from "../helpers/run-process";

const BIN_DIR = fromRoot("bin");
const WRAPPERS_DIR = join(BIN_DIR, "wrappers");

/** Palabras que delatan lógica de dominio dentro de un lanzador. */
const DOMAIN_WORDS = [
  "postman_collection",
  "laravel",
  "scanner",
  "endpoint",
  "framework",
  "_postman_id",
];

/**
 * Los lanzadores, solo ficheros.
 *
 * Filtrar por tipo y no por nombre importa: el test de sintaxis de
 * Python dejaba un `__pycache__/` dentro de `wrappers/` y el siguiente
 * test intentaba leerlo como fichero (EISDIR).
 */
async function launcherFiles(): Promise<string[]> {
  const candidates: string[] = [];
  for (const [dir, names] of [
    [BIN_DIR, await readdir(BIN_DIR)],
    [WRAPPERS_DIR, await readdir(WRAPPERS_DIR)],
  ] as Array<[string, string[]]>) {
    for (const name of names) {
      const full = join(dir, name);
      if ((await stat(full)).isFile()) candidates.push(full);
    }
  }
  return candidates;
}

describe("los lanzadores son finos", () => {
  test("hay un lanzador POSIX y uno de Windows", async () => {
    const names = await readdir(BIN_DIR);
    // El nombre canónico vive en `BIN_NAME` (contratos) y lo pinza el
    // test de abajo contra el `bin` del package.json; aquí solo se
    // comprueba que los dos lanzadores existen con ese nombre.
    expect(names).toContain("apisrc");
    expect(names).toContain("apisrc.ps1");
  });

  test("ninguno pasa de 100 líneas", async () => {
    for (const file of await launcherFiles()) {
      const lines = (await readFile(file, "utf8")).split("\n").length;
      expect(lines, file).toBeLessThan(100);
    }
  });

  // El test que de verdad importa: que no vuelva a aparecer una
  // reimplementación disfrazada de wrapper.
  test("ninguno contiene lógica de dominio", async () => {
    for (const file of await launcherFiles()) {
      const source = (await readFile(file, "utf8")).toLowerCase();
      // Las menciones en comentarios explican justo esto, así que se
      // miran solo las líneas de código.
      const code = source
        .split("\n")
        .filter((line) => !/^\s*(#|\/\/|\*|<!--)/.test(line))
        .join("\n");
      for (const word of DOMAIN_WORDS) {
        expect(code.includes(word), `${file} menciona "${word}"`).toBe(false);
      }
    }
  });

  test("el lanzador POSIX es ejecutable", async () => {
    const mode = (await stat(join(BIN_DIR, "apisrc"))).mode;
    // eslint-disable-next-line no-bitwise
    expect(mode & 0o111).toBeGreaterThan(0);
  });

  test("el lanzador POSIX es sintácticamente válido", async () => {
    const result = await runProcess("sh", ["-n", join(BIN_DIR, "apisrc")]);
    expect(result.code, result.output).toBe(0);
  });

  // `py_compile` escribiría un `__pycache__/` dentro de `wrappers/`.
  // `compile()` hace la misma comprobación sin dejar rastro.
  test("el wrapper de Python es sintácticamente válido", async () => {
    const path = join(WRAPPERS_DIR, "apisrc.py");
    const result = await runProcess("python3", [
      "-c",
      `compile(open(${JSON.stringify(path)}).read(), ${JSON.stringify(path)}, "exec")`,
    ]);
    expect(result.code, result.output).toBe(0);
  });

  test("todos apuntan al mismo nombre canónico", async () => {
    for (const file of await launcherFiles()) {
      const source = await readFile(file, "utf8");
      expect(source, file).toMatch(/apisrc/);
      // El nombre viejo no puede quedar en un lanzador nuevo.
      expect(source, file).not.toMatch(/postman-from-routes/);
    }
  });
});

/**
 * El nombre del ejecutable, en un solo sitio.
 *
 * Estaba escrito a mano en el script de compilación y se quedó en
 * `postman-from-routes` —el nombre viejo— cuando el producto se
 * renombró. Los binarios de las releases salían con un nombre que no
 * existe en ninguna otra parte del proyecto, y el workflow que los
 * publica buscaba ese patrón: los dos coincidían **en estar mal**, así
 * que nada fallaba.
 */
describe("el nombre del binario", () => {
  test("es el mismo que el `bin` del package.json", async () => {
    const { BIN_NAME } = await import("../../packages/contracts/constants/core/postman.constant");
    const pkg = JSON.parse(
      await readFile(join(REPO_ROOT, "package.json"), "utf8"),
    ) as { bin?: Record<string, string> };
    expect(Object.keys(pkg.bin ?? {})).toContain(BIN_NAME);
  });

  test("el workflow de releases publica ese patrón, no otro", async () => {
    const { BIN_NAME } = await import("../../packages/contracts/constants/core/postman.constant");
    const workflow = await readFile(
      join(REPO_ROOT, ".github", "workflows", "release-binaries.yml"),
      "utf8",
    );
    expect(workflow).toContain(`dist/${BIN_NAME}-`);
    // Publicar un patrón que ya no se genera dejaría la release vacía.
    expect(workflow).not.toMatch(/postman-from-routes/);
  });

  test("el script de compilación no lo escribe a mano", async () => {
    const source = await readFile(
      join(REPO_ROOT, "scripts", "build", "build-binary.script.ts"),
      "utf8",
    );
    expect(source).toContain("BIN_NAME");
    expect(source).not.toMatch(/["'`]postman-from-routes/);
  });
});
