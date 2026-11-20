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
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join, } from "node:path";
import { tmpdir } from "node:os";
import { runProcess } from "../helpers/run-process";
import { BIN_NAME, OUTPUT_DIR_NAME } from "../../packages/contracts/constants/core/postman.constant";
import { CLI_ENTRYPOINT, REPO_ROOT, exampleDir } from "../../scripts/helpers/root.helper";

const ENTRYPOINT = CLI_ENTRYPOINT;
const SAMPLE_PROJECT = exampleDir("express");

let workDir = "";
let binary = "";
let project = "";

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "apisrc-binary-"));
  binary = join(workDir, BIN_NAME);
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
    expect(output).toContain("o----/");
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

  test("serves the built-in UI and an explicit static directory outside the repository", async () => {
    const staticDir = join(workDir, "static");
    await mkdir(staticDir);
    await writeFile(join(staticDir, "index.html"), "<h1>compiled fixture</h1>");
    for (const [args, expected] of [
      [[], "Serving the built-in interface."],
      [["--static-dir", staticDir], "compiled fixture"],
    ] as const) {
      const port = await freePort();
      const child = spawn(binary, ["ui", "--no-open", "--port", String(port), ...args], {
        cwd: workDir,
        env: { PATH: "/usr/bin:/bin", HOME: workDir },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      let stopped = false;
      let spawnError: Error | undefined;
      const closed = new Promise<void>((resolve) => {
        child.on("close", () => { stopped = true; resolve(); });
        child.on("error", (error) => { spawnError = error; stopped = true; resolve(); });
      });
      child.stdout?.on("data", (data: Uint8Array) => { output += Buffer.from(data).toString(); });
      child.stderr?.on("data", (data: Uint8Array) => { output += Buffer.from(data).toString(); });
      try {
        let url: string | undefined;
        for (let attempt = 0; attempt < 100 && !url; attempt++) {
          if (stopped) throw spawnError ?? new Error(`UI exited: ${output}`);
          url = output.match(/Interface at (https?:\/\/\S+)/)?.[1];
          if (!url) await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(url, output).toBeDefined();
        const response = await fetch(url!);
        expect(response.status, output).toBe(200);
        const html = await response.text();
        expect(args.length ? html : output).toContain(expected);
        if (!args.length) {
          expect(html).toContain('rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,');
          expect(response.headers.get("content-security-policy")).toContain("img-src data:");
        }
      } finally {
        if (!stopped) child.kill("SIGTERM");
        await closed;
      }
    }
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

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No TCP port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}
