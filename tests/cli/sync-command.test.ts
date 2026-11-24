/**
 * `apisrc sync` — the alias of `generate`.
 *
 * The command had **no test at all**, and it only survived the
 * `lint:command-coverage` gate because an unrelated app test happened
 * to mention the word `"sync"` in a string. That is how a command
 * disappears: not by failing, but by nobody running it.
 *
 * Two things are worth pinning down here, because they are what the
 * alias is for:
 *
 *   · `sync --dry-run` must answer with the discovery **and write
 *     nothing** — it is the "what would happen" of the generation, and
 *     the flag name is the only promise the user has.
 *   · `sync` without `--dry-run` must produce the same artifacts as
 *     `generate`, in the same place. An alias that writes somewhere
 *     else is not an alias.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CLI_COMMANDS_DIR, exampleDir } from "../../scripts/helpers/root.helper";
import { copyExampleClean } from "../helpers/fixtures";
import { runProcess } from "../helpers/run-process";

/** Where `generate` writes when nobody says otherwise. */
const OUTPUT_DIR_NAME = "tanit";

let work = "";

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "sync-cmd-"));
}, 60_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

/** A clean project per test, because this command writes. */
async function proyecto(nombre: string, framework = "express"): Promise<string> {
  const root = join(work, nombre);
  await copyExampleClean(exampleDir(framework), root);
  return root;
}

function run(
  comando: string,
  args: readonly string[],
): Promise<{ code: number; output: string; stdout: string }> {
  return runProcess("bun", [join(CLI_COMMANDS_DIR, `${comando}.script.ts`), ...args]);
}

describe("sync", () => {
  test(
    "--dry-run answers with the discovery and writes nothing",
    { timeout: 120_000 },
    async () => {
      const root = await proyecto("dry-run");
      const { code, output } = await run("sync", ["--dry-run", "--project-root", root]);

      expect(code, output).toBe(0);
      expect(output).toContain("--inspect mode (no files written)");
      // The promise of the flag: nothing on disk.
      expect(existsSync(join(root, OUTPUT_DIR_NAME))).toBe(false);
    },
  );

  test(
    "writes the same artifacts as generate",
    { timeout: 120_000 },
    async () => {
      const rootSync = await proyecto("escribe-sync");
      const rootGenerate = await proyecto("escribe-generate");

      const sync = await run("sync", ["--project-root", rootSync]);
      const generate = await run("generate", ["--project-root", rootGenerate]);

      expect(sync.code, sync.output).toBe(0);
      expect(generate.code, generate.output).toBe(0);

      const enSync = existsSync(join(rootSync, OUTPUT_DIR_NAME))
        ? (await readdir(join(rootSync, OUTPUT_DIR_NAME))).sort()
        : [];
      const enGenerate = existsSync(join(rootGenerate, OUTPUT_DIR_NAME))
        ? (await readdir(join(rootGenerate, OUTPUT_DIR_NAME))).sort()
        : [];

      expect(enSync.length).toBeGreaterThan(0);
      expect(enSync).toEqual(enGenerate);
    },
  );
});
