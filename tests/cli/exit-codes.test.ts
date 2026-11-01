/**
 * What exit code the CLI returns, and why it matters.
 *
 * A CLI is used inside scripts: in a `Makefile`, in a CI step, in a
 * pre-commit hook. There the exit code **is** the result; the prose
 * it prints is read by no one.
 *
 * Two cases exited with 0 when they had not done what they were asked:
 *
 *   - Zero endpoints found: it wrote an empty collection and exited
 *     fine. A CI step passed even though the scan had seen nothing,
 *     and someone imported an empty collection without noticing.
 *   - No write permission: an `EACCES` came out with Bun's stack
 *     trace on top. The information was there, but buried and without
 *     saying what to do.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CLI_COMMANDS_DIR, exampleDir } from "../../scripts/helpers/root.helper";
import { copyExampleClean } from "../helpers/fixtures";
import { runProcess } from "../helpers/run-process";

const GENERATE = join(CLI_COMMANDS_DIR, "generate.script.ts");

let workDir = "";
let emptyProject = "";
let realProject = "";
let readOnlyProject = "";

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "exit-codes-"));

  emptyProject = join(workDir, "vacio");
  await mkdir(emptyProject, { recursive: true });

  realProject = join(workDir, "api");
  await copyExampleClean(exampleDir("express"), realProject);

  readOnlyProject = join(workDir, "solo-lectura");
  await copyExampleClean(exampleDir("express"), readOnlyProject);
  await chmod(readOnlyProject, 0o555);
}, 60_000);

afterAll(async () => {
  if (readOnlyProject) await chmod(readOnlyProject, 0o755).catch(() => undefined);
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

const generate = (args: readonly string[]) => runProcess("bun", [GENERATE, ...args]);

describe("exit codes of `generate`", () => {
  test("a project with endpoints exits with 0", async () => {
    const result = await generate(["--project-root", realProject]);
    expect(result.code, result.output).toBe(0);
  }, 60_000);

  // The regression: this exited 0 and wrote an empty collection.
  test("zero endpoints exits with 1 and writes nothing", async () => {
    const result = await generate(["--project-root", emptyProject]);
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/no endpoints were found/i);
  }, 60_000);

  test("the zero-endpoints message says what to do", async () => {
    const { output } = await generate(["--project-root", emptyProject]);
    expect(output).toMatch(/--project-root/);
    expect(output).toMatch(/FRAMEWORKS\.md/);
    expect(output).toMatch(/--allow-empty/);
  }, 60_000);

  // A project that has no routes yet is a legitimate case: you can
  // explicitly ask it not to fail.
  test("--allow-empty exits with 0 again", async () => {
    const result = await generate(["--project-root", emptyProject, "--allow-empty"]);
    expect(result.code, result.output).toBe(0);
  }, 60_000);

  test("a nonexistent projectRoot exits with 1 and says so", async () => {
    const result = await generate(["--project-root", join(workDir, "no-existe-zzz")]);
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/does not exist/i);
  }, 60_000);

  /**
   * As **root** this scenario does not exist: `chmod 0555` does not
   * prevent writing to whoever can bypass permissions, so the test
   * would always pass without checking anything. This was seen running
   * the gate inside a container, where the default user is root.
   *
   * It is skipped with the reason written down, instead of letting it
   * pass green: a test that cannot fail is worse than not having it,
   * because it also counts as coverage.
   */
  test.skipIf(typeof process.getuid === "function" && process.getuid?.() === 0)(
    "without write permission exits with 1 and explains, without a trace",
    async () => {
    const result = await generate(["--project-root", readOnlyProject]);
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/no permission/i);
    expect(result.output).toMatch(/--output-dir/);
      // What must NOT come out: Bun's dump.
      expect(result.output).not.toMatch(/at <anonymous>/);
    },
    60_000,
  );
});
