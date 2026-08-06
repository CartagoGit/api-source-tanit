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

import { fromRoot } from "../../scripts/helpers/root.helper";
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
    expect(names).toContain("expostman");
    expect(names).toContain("expostman.ps1");
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
    const mode = (await stat(join(BIN_DIR, "expostman"))).mode;
    // eslint-disable-next-line no-bitwise
    expect(mode & 0o111).toBeGreaterThan(0);
  });

  test("el lanzador POSIX es sintácticamente válido", async () => {
    const result = await runProcess("sh", ["-n", join(BIN_DIR, "expostman")]);
    expect(result.code, result.output).toBe(0);
  });

  // `py_compile` escribiría un `__pycache__/` dentro de `wrappers/`.
  // `compile()` hace la misma comprobación sin dejar rastro.
  test("el wrapper de Python es sintácticamente válido", async () => {
    const path = join(WRAPPERS_DIR, "expostman.py");
    const result = await runProcess("python3", [
      "-c",
      `compile(open(${JSON.stringify(path)}).read(), ${JSON.stringify(path)}, "exec")`,
    ]);
    expect(result.code, result.output).toBe(0);
  });

  test("todos apuntan al mismo nombre canónico", async () => {
    for (const file of await launcherFiles()) {
      const source = await readFile(file, "utf8");
      expect(source, file).toMatch(/expostman/);
      // El nombre viejo no puede quedar en un lanzador nuevo.
      expect(source, file).not.toMatch(/postman-from-routes/);
    }
  });
});
