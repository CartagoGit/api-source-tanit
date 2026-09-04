/**
 * El comando `watch`, no su motor.
 *
 * `watcher.service.spec.ts` cubre las piezas puras y
 * `tests/e2e/watch.test.ts` comprueba que `fs.watch` llega y que
 * escribir la colección no se dispara a sí misma. Lo que no cubría nadie
 * era **el comando**: sus flags, sus códigos de salida y sus mensajes.
 *
 * Era el último de los seis que la auditoría encontró sin ejecutar, y de
 * los otros cinco tres estaban rotos.
 *
 * Se usa `--once` —genera una pasada y sale— porque es lo que permite
 * probar el comando sin gestionar un proceso de vida larga. Que el modo
 * vigilante de verdad funcione ya lo prueba el e2e.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CLI_COMMANDS_DIR, exampleDir } from "../../scripts/helpers/root.helper";
import { OUTPUT_DIR_NAME } from "../../packages/contracts/constants/core/postman.constant";
import { copyExampleClean } from "../helpers/fixtures";
import { runProcess } from "../helpers/run-process";

const WATCH = join(CLI_COMMANDS_DIR, "watch.script.ts");

let work = "";

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "watch-cmd-"));
}, 60_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

async function proyecto(nombre: string): Promise<string> {
  const root = join(work, nombre);
  await copyExampleClean(exampleDir("express"), root);
  return root;
}

function watch(args: readonly string[]): Promise<{ code: number; output: string }> {
  return runProcess("bun", [WATCH, ...args], { timeoutMs: 90_000 });
}

describe("watch --once", () => {
  test("genera la colección y termina", { timeout: 120_000 }, async () => {
    const root = await proyecto("once-basico");
    const { code, output } = await watch(["--project-root", root, "--once"]);
    expect(code, output).toBe(0);

    const salida = await readdir(join(root, "export-to-postman"));
    expect(salida.some((f) => f.endsWith(".postman_collection.json"))).toBe(true);
  });

  test("lo que escribe es una colección válida", { timeout: 120_000 }, async () => {
    const root = await proyecto("once-valida");
    await watch(["--project-root", root, "--once"]);
    const dir = join(root, OUTPUT_DIR_NAME);
    const fichero = (await readdir(dir)).find((f) => f.endsWith(".postman_collection.json"));
    const doc = JSON.parse(await readFile(join(dir, fichero ?? ""), "utf8")) as {
      info?: { schema?: string };
      item?: unknown[];
    };
    expect(doc.info?.schema).toContain("v2.1.0");
    expect(doc.item?.length ?? 0).toBeGreaterThan(0);
  });

  test("`--format` saca también los otros formatos", { timeout: 120_000 }, async () => {
    const root = await proyecto("once-formatos");
    const { code, output } = await watch([
      "--project-root",
      root,
      "--once",
      "--format",
      "postman,openapi",
    ]);
    expect(code, output).toBe(0);
    const salida = await readdir(join(root, OUTPUT_DIR_NAME));
    expect(salida.some((f) => f.endsWith(".openapi.yaml"))).toBe(true);
  });
});

describe("watch rechaza lo que no puede hacer", () => {
  /**
   * Sin `--project-root`, `projectRoot()` **no falla**: cae al
   * directorio actual. Eso deja muerta la rama «no se pudo determinar la
   * raíz» que el comando tiene escrita, y hace que lanzarlo desde el
   * sitio equivocado recorra ese árbol entero.
   *
   * Se midió: `watch --once` desde `/tmp` encontró un proyecto suelto
   * entre los temporales y generó su colección, sin decir una palabra.
   * Desde `$HOME` recorrería la casa.
   *
   * El fallback se queda —es cómodo y hay quien lo usa—, pero ahora dice
   * qué está mirando. Un comportamiento implícito deja de ser una trampa
   * en cuanto se dice en voz alta.
   */
  test("sin `--project-root` dice qué directorio va a vigilar", { timeout: 120_000 }, async () => {
    const root = await proyecto("sin-flag");
    const { output } = await runProcess("bun", [WATCH, "--once"], {
      cwd: root,
      timeoutMs: 90_000,
    });
    expect(output).toContain("No --project-root");
    expect(output).toContain(root);
  });

  test("un `--debounce` que no es número se rechaza", { timeout: 60_000 }, async () => {
    const root = await proyecto("debounce-malo");
    const { code, output } = await watch([
      "--project-root",
      root,
      "--once",
      "--debounce",
      "muchos",
    ]);
    expect(code).toBe(1);
    expect(output).toContain("--debounce");
  });

  test("un `--format` inventado se rechaza antes de escribir nada", { timeout: 120_000 }, async () => {
    const root = await proyecto("formato-malo");
    const { code, output } = await watch([
      "--project-root",
      root,
      "--once",
      "--format",
      "inventado",
    ]);
    expect(code).toBe(1);
    // Y no ha dejado una carpeta de salida a medias.
    await expect(readdir(join(root, OUTPUT_DIR_NAME))).rejects.toThrow();
    expect(output).not.toMatch(/at <anonymous>/);
  });
});
