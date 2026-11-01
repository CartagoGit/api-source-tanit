/**
 * The compiled binary runs without a JavaScript runtime.
 *
 * `bun build --compile` produces a self-contained executable, but only
 * if all the code is inlined. While the CLI spawned `bun run <script>`,
 * the binary compiled without errors and then failed at runtime with
 * `Module not found "/scripts/generate.script.ts"`: inside the
 * executable there are no files to resolve.
 *
 * These tests truly compile and run the result with a PATH without
 * `bun`, which is the only way to verify there is no hidden runtime
 * dependency left over.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, } from "node:path";
import { tmpdir } from "node:os";
import { runProcess } from "../helpers/run-process";
import { OUTPUT_DIR_NAME } from "../../packages/contracts/constants/core/postman.constant";
import { CLI_ENTRYPOINT, REPO_ROOT, exampleDir } from "../../scripts/helpers/root.helper";

const ENTRYPOINT = CLI_ENTRYPOINT;
const SAMPLE_PROJECT = exampleDir("express");

let workDir = "";
let binary = "";
let project = "";

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "postman-binary-"));
  binary = join(workDir, "export-to-postman");
  project = join(workDir, "mi-api");
  await cp(SAMPLE_PROJECT, project, { recursive: true });

  await runProcess("bun", ["build", "--compile", ENTRYPOINT, "--outfile", binary], {
    cwd: REPO_ROOT,
  });
}, 120_000);

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

/** Runs the binary with a PATH that does NOT contain bun or node. */
async function runWithoutRuntime(
  args: string[],
): Promise<{ code: number; output: string }> {
  return runProcess(binary, args, {
    cwd: workDir,
    // The trimmed PATH is the heart of the test: if the binary needed
    // a bun or node installed, here it cannot find them and fails. It
    // must be `exactEnv`, not `env`: inheriting the real PATH the test
    // would always pass without checking anything.
    exactEnv: { PATH: "/usr/bin:/bin", HOME: workDir },
  });
}

describe("compiled binary", () => {
  test("compiles", () => {
    expect(existsSync(binary)).toBe(true);
  });

  test("`--help` responds without bun on the PATH", async () => {
    const { code, output } = await runWithoutRuntime(["--help"]);
    expect(code).toBe(0);
    for (const command of ["generate", "check", "list", "stats", "validate"]) {
      expect(output).toContain(command);
    }
  });

  // It is the exact failure that happened before importing the commands.
  test("does not look for repo files at runtime", async () => {
    const { output } = await runWithoutRuntime(["generate", "--project-root", project]);
    expect(output).not.toContain("Module not found");
  });

  test("generates the collection without a JavaScript runtime", async () => {
    const { code } = await runWithoutRuntime(["generate", "--project-root", project]);
    expect(code).toBe(0);

    const files = await readdir(join(project, OUTPUT_DIR_NAME));
    const collectionFile = files.find((f) => f.endsWith(".postman_collection.json"));
    expect(collectionFile).toBeDefined();

    const collection = JSON.parse(
      await readFile(join(project, OUTPUT_DIR_NAME, collectionFile!), "utf8"),
    ) as { info: { schema: string }; item: Array<Record<string, unknown>> };

    expect(collection.info.schema).toContain("2.1.0");
    expect(countRequests(collection.item)).toBe(9);
  });

  test("rejects an unknown command with exit code 1", async () => {
    const { code, output } = await runWithoutRuntime(["comando-inventado"]);
    expect(code).toBe(1);
    expect(output).toContain("Unknown command");
  });
}, 120_000);

function countRequests(items: ReadonlyArray<Record<string, any>>): number {
  return items.reduce(
    (total, item) => total + (item["item"] ? countRequests(item["item"]) : 1),
    0,
  );
}
