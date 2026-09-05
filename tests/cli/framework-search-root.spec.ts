/**
 * `--framework-search-root` — f00011 S3.
 *
 * Cubre el lado CLI del flag:
 *
 *   1. `--help` lo documenta en la sección COMMON FLAGS.
 *   2. Pasarlo a `generate` propaga el valor al `match.frameworkSearchRoot`
 *      y el pipeline lo ve (se imprime en `--inspect`).
 *   3. Sin pasarlo, un proyecto monorepo con un solo workspace ve cómo
 *      el orquestador auto-rellena el subdir y avisa al usuario.
 *   4. Con varios workspaces, el orquestador NO rellena `frameworkSearchRoot`.
 *   5. Un valor absoluto o con `..` se rechaza con error claro.
 *   6. El flag también pasa por `push` y `watch`.
 *
 * No cubre el camino del plugin (eso es `tests/plugin/plugin-options.
 * spec.ts`) ni los scanners (eso está en `tests/frameworks/*`, fuera
 * del dominio de S3).
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runProcess } from "../helpers/run-process";
import { CLI_ENTRYPOINT, REPO_ROOT, exampleDir } from "../../scripts/helpers/root.helper";

const CLI = CLI_ENTRYPOINT;

async function runCli(args: string[]): Promise<{ code: number; output: string }> {
  return runProcess("bun", [CLI, ...args], { cwd: REPO_ROOT });
}

let work = "";

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "framework-search-root-cli-"));
});

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

/**
 * Crea un monorepo falso con el fixture de Express dentro del primer
 * workspace. Es la forma más barata de tener un proyecto que un
 * scanner reconozca Y una estructura de monorepo encima: así el
 * orquestador puede auto-detectar el subdir y la búsqueda del
 * framework no falla por falta de código.
 *
 * El truco está en la raíz: el `package.json` raíz declara `express`
 * en `dependencies`, además de los `workspaces`. Sin esa pista, el
 * orquestador no detecta nada (los scanners miran la raíz, no el
 * subdir), y `frameworkSearchRoot` solo tiene sentido si hay un
 * scanner que ya matcheó. Es exactamente el caso de uso real: en un
 * monorepo real, la raíz a menudo re-exporta las dependencias del
 * framework para que las herramientas las vean.
 */
async function makeMonorepoWithExpress(
  rel: string,
  workspaces: ReadonlyArray<string>,
): Promise<{ root: string; frameworkSearchRoot: string }> {
  const dir = join(work, rel);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: rel,
        workspaces,
        // Pista para el orquestador: la raíz declara la dependencia
        // del framework. Sin esto, ningún scanner matchea y el caso
        // de uso de `frameworkSearchRoot` nunca se da.
        dependencies: { express: "^4.0.0" },
      },
      null,
      2,
    ),
    "utf8",
  );
  const first = workspaces[0];
  if (!first) throw new Error("workspaces vacío");
  const subdir = join(dir, first);
  await cp(exampleDir("express"), subdir, { recursive: true });
  // Materializar el resto de workspaces como carpetas vacías: la
  // detección necesita verlas en disco para contar varios y decidir
  // NO auto-rellenar `frameworkSearchRoot`. Sin esto, solo el primero
  // existe y el helper cree que es el único.
  for (const w of workspaces.slice(1)) {
    await mkdir(join(dir, w), { recursive: true });
  }
  return { root: dir, frameworkSearchRoot: first };
}

describe("--help documenta el flag", () => {
  test("`--help` menciona --framework-search-root", async () => {
    const { output } = await runCli(["--help"]);
    expect(output).toContain("--framework-search-root");
  });
});

describe("--framework-search-root en `generate`", () => {
  test("valor inválido (absoluto) → error claro", async () => {
    const { code, output } = await runCli([
      "generate",
      "--project-root",
      REPO_ROOT,
      "--framework-search-root",
      "/abs/path",
    ]);
    expect(code).not.toBe(0);
    expect(output).toContain("--framework-search-root");
    expect(output).toContain("subdirectory relative to projectRoot");
  });

  test("valor inválido (con `..`) → error claro", async () => {
    const { code, output } = await runCli([
      "generate",
      "--project-root",
      REPO_ROOT,
      "--framework-search-root",
      "../etc",
    ]);
    expect(code).not.toBe(0);
    expect(output).toContain("--framework-search-root");
  });

  test("valor válido aparece en `--inspect`", async () => {
    // El paquete `examples/example-express` no es un monorepo, así que
    // pasar `--framework-search-root <algo>` no rompe nada y el subdir
    // aparece en la salida `--inspect`.
    const { code, output } = await runCli([
      "generate",
      "--project-root",
      exampleDir("express"),
      "--framework-search-root",
      "apps/api",
      "--inspect",
    ]);
    expect(code).toBe(0);
    expect(output).toContain("Search root:");
    expect(output).toContain("apps/api");
    expect(output).toContain("--framework-search-root");
  });
});

describe("auto-detección de monorepo en `generate`", () => {
  test("monorepo con un solo workspace → auto-rellena y avisa", async () => {
    // El orquestador detecta el monorepo, mira el único workspace
    // (donde está el fixture de Express), y rellena `frameworkSearchRoot`
    // por su cuenta. La salida `--inspect` debe mostrarlo con la
    // marca "(auto-detected)".
    const { root } = await makeMonorepoWithExpress("monorepo-single", [
      "apps/api",
    ]);
    const { code, output } = await runCli([
      "generate",
      "--project-root",
      root,
      "--inspect",
    ]);
    expect(code).toBe(0);
    expect(output).toContain("Search root:");
    expect(output).toContain("apps/api");
    expect(output).toContain("(auto-detected)");
  });

  test("monorepo con varios workspaces → NO rellena frameworkSearchRoot", async () => {
    // El helper marca `frameworkSearchRoot` como `null` cuando hay más
    // de un workspace. Con uno de los dos copiando el fixture, el
    // escaneo del primero debería seguir funcionando, pero la línea
    // `Search root:` no aparece en `--inspect` (el orquestador no
    // rellenó el subdir).
    const { root } = await makeMonorepoWithExpress("monorepo-multi", [
      "apps/api",
      "apps/web",
    ]);
    const { output } = await runCli([
      "generate",
      "--project-root",
      root,
      "--inspect",
    ]);
    expect(output).not.toMatch(/Search root:/);
  });
});

describe("--framework-search-root en otros comandos", () => {
  test("`push` lo acepta (no falla al parsear)", async () => {
    // Sin API key el comando falla por eso, no por el flag.
    const { code, output } = await runCli([
      "push",
      "--project-root",
      exampleDir("express"),
      "--framework-search-root",
      "apps/api",
    ]);
    expect(code).not.toBe(0);
    expect(output).toContain("Missing Postman API key");
  });

  test("`watch --once` lo acepta y genera una vez", async () => {
    // `--once` hace que `watch` corra una sola generación y salga. Es
    // la forma barata de probar que el flag llega al pipeline sin
    // dejar un proceso a largo plazo en el test.
    const { code } = await runCli([
      "watch",
      "--project-root",
      exampleDir("express"),
      "--framework-search-root",
      "apps/api",
      "--once",
    ]);
    // El código 0 es lo que se persigue: `--once` ejecuta una generación
    // y termina sin error.
    expect(code).toBe(0);
  });
});