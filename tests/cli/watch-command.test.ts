/**
 * The `watch` command, not its engine.
 *
 * `watcher.service.spec.ts` covers the pure pieces and
 * `tests/e2e/watch.test.ts` checks that `fs.watch` fires and that
 * writing the collection does not trigger itself. What nobody covered
 * was **the command**: its flags, its exit codes and its messages.
 *
 * It was the last of the six the audit found unexercised, and of the
 * other five three were broken.
 *
 * `--once` is used —generate one pass and exit— because it is what
 * lets us test the command without managing a long-lived process. That
 * the actual watch mode works is already proven by the e2e.
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
  test("generates the collection and exits", { timeout: 120_000 }, async () => {
    const root = await proyecto("once-basico");
    const { code, output } = await watch(["--project-root", root, "--once"]);
    expect(code, output).toBe(0);

    const salida = await readdir(join(root, "export-to-postman"));
    expect(salida.some((f) => f.endsWith(".postman_collection.json"))).toBe(true);
  });

  test("what it writes is a valid collection", { timeout: 120_000 }, async () => {
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

  test("`--format` outputs the other formats too", { timeout: 120_000 }, async () => {
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

describe("watch rejects what it cannot do", () => {
  /**
   * Without `--project-root`, `projectRoot()` **does not fail**: it
   * falls back to the current directory. That leaves the "could not
   * determine the root" branch the command has written dead, and
   * makes running it from the wrong place walk that whole tree.
   *
   * It was measured: `watch --once` from `/tmp` found a stray
   * project among the temporaries and generated its collection
   * without saying a word. From `$HOME` it would walk the home.
   *
   * The fallback stays —it is convenient and some people use it—,
   * but it now says what it is watching. An implicit behavior stops
   * being a trap as soon as it is said out loud.
   */
  test("without `--project-root` it says which directory it will watch", { timeout: 120_000 }, async () => {
    const root = await proyecto("sin-flag");
    const { output } = await runProcess("bun", [WATCH, "--once"], {
      cwd: root,
      timeoutMs: 90_000,
    });
    expect(output).toContain("No --project-root");
    expect(output).toContain(root);
  });

  test("a non-numeric `--debounce` is rejected", { timeout: 60_000 }, async () => {
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

  test("a made-up `--format` is rejected before writing anything", { timeout: 120_000 }, async () => {
    const root = await proyecto("formato-malo");
    const { code, output } = await watch([
      "--project-root",
      root,
      "--once",
      "--format",
      "inventado",
    ]);
    expect(code).toBe(1);
    // And it has not left a half-written output folder.
    await expect(readdir(join(root, OUTPUT_DIR_NAME))).rejects.toThrow();
    expect(output).not.toMatch(/at <anonymous>/);
  });
});
