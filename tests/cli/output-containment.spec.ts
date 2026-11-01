/**
 * The output does not escape, when the one choosing it is an agent.
 *
 * `--output-dir` was accepted as-is. Run by hand that is fine: if
 * someone writes `--output-dir /tmp/x`, it is because they want to
 * write there. But the MCP plugin spawns this same CLI with arguments
 * coming from an agent, and then a `../` ends up writing outside the
 * project.
 *
 * Containment is not global on purpose: it is enforced by
 * `POSTMAN_CONTAIN_ROOT`, which the plugin sets at launch. Whoever uses
 * the terminal does not see it.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CLI_COMMANDS_DIR, exampleDir } from "../../scripts/helpers/root.helper";
import { copyExampleClean } from "../helpers/fixtures";
import { runProcess } from "../helpers/run-process";

const GENERATE = join(CLI_COMMANDS_DIR, "generate.script.ts");

let base = "";
let proyecto = "";

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "contain-cli-")));
  proyecto = join(base, "api");
  await copyExampleClean(exampleDir("express"), proyecto);
}, 120_000);

afterAll(async () => {
  if (base) await rm(base, { recursive: true, force: true });
});

function generate(
  args: readonly string[],
  env?: Record<string, string>,
): Promise<{ code: number; output: string }> {
  return runProcess("bun", [GENERATE, ...args], env ? { env } : {});
}

describe("without containment — whoever runs it by hand is in charge", () => {
  test("an output folder outside the project works", { timeout: 120_000 }, async () => {
    const fuera = join(base, "salida-elegida");
    const r = await generate(["--project-root", proyecto, "--output-dir", fuera]);
    expect(r.code, r.output).toBe(0);
  });
});

describe("with containment — whoever chooses it is an agent", () => {
  const conRaiz = (raiz: string): Record<string, string> => ({
    POSTMAN_CONTAIN_ROOT: raiz,
  });

  // THE test: without the check, this wrote outside and exited 0.
  test("a path that escapes is rejected", { timeout: 120_000 }, async () => {
    const fuera = join(base, "no-deberia-existir");
    const r = await generate(
      ["--project-root", proyecto, "--output-dir", fuera],
      conRaiz(proyecto),
    );
    expect(r.code).toBe(1);
  });

  test("says why and who enforces it, without a trace", { timeout: 120_000 }, async () => {
    const r = await generate(
      ["--project-root", proyecto, "--output-dir", join(base, "fuera")],
      conRaiz(proyecto),
    );
    // The lint:output-language gate forces the surface in English,
    // and the `reason` from the containment helper already comes in English
    // ("is outside"); what the CLI adds around it is pinned here.
    expect(r.output).toMatch(/is outside/);
    expect(r.output).toContain("POSTMAN_CONTAIN_ROOT");
    expect(r.output).toContain("POSTMAN_CONTAIN_ROOT");
    expect(r.output).not.toMatch(/at <anonymous>/);
  });

  test("a `../` does not slip through either", { timeout: 120_000 }, async () => {
    const r = await generate(
      ["--project-root", proyecto, "--output-dir", join(proyecto, "..", "escapada")],
      conRaiz(proyecto),
    );
    expect(r.code).toBe(1);
  });

  test("inside the root still works the same", { timeout: 120_000 }, async () => {
    const dentro = join(proyecto, "salida-propia");
    const r = await generate(
      ["--project-root", proyecto, "--output-dir", dentro],
      conRaiz(proyecto),
    );
    expect(r.code, r.output).toBe(0);
  });
});
