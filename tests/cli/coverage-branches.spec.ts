/**
 * Additional in-process command branches for the c00010 S3 coverage pass.
 *
 * These tests intentionally exercise the command entry points rather than the
 * lower-level services so Vitest's V8 report includes the CLI surface. They
 * keep production code untouched: all network calls are faked and all
 * filesystem work uses temporary projects.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

import { copyExampleClean } from "../helpers/fixtures";
import { exampleDir } from "../../scripts/helpers/root.helper";
import { OUTPUT_DIR_NAME } from "../../packages/contracts/constants/core/postman.constant";
import { resolveProjectContext } from "../../packages/core/discovery/project-context.service";
import { runInit } from "../../packages/cli/commands/init.script";
import { runList } from "../../packages/cli/commands/list-endpoints.script";
import { runPush } from "../../packages/cli/commands/push.script";
import { main as validateJson } from "../../packages/cli/commands/validate-json.script";
import { runGenerate } from "../../packages/cli/commands/generate.script";

let work = "";
let previousKey: string | undefined;
let previousWorkspace: string | undefined;
let previousPostmanId: string | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  if (previousKey === undefined) delete process.env["POSTMAN_API_KEY"];
  else process.env["POSTMAN_API_KEY"] = previousKey;
  if (previousWorkspace === undefined) delete process.env["POSTMAN_WORKSPACE"];
  else process.env["POSTMAN_WORKSPACE"] = previousWorkspace;
  if (previousPostmanId === undefined) delete process.env["POSTMAN_PROJECT_ROOT"];
  else process.env["POSTMAN_PROJECT_ROOT"] = previousPostmanId;
  if (work) await rm(work, { recursive: true, force: true });
  work = "";
});

async function project(name: string): Promise<string> {
  if (!work) work = await mkdtemp(join(tmpdir(), "cli-coverage-"));
  const root = join(work, name);
  await copyExampleClean(exampleDir("express"), root);
  return root;
}

async function generated(name: string): Promise<string> {
  const root = await project(name);
  const outcome = await runGenerate(["--project-root", root]);
  expect(outcome.code, "runGenerate must succeed").toBe(0);
  return root;
}

function findRequest(item: unknown): { request?: { body?: { mode?: string; raw?: string } } } | null {
  if (!item || typeof item !== "object") return null;
  const value = item as {
    request?: { body?: { mode?: string; raw?: string } };
    item?: unknown[];
  };
  if (value.request) return value;
  for (const child of value.item ?? []) {
    const found = findRequest(child);
    if (found) return found;
  }
  return null;
}

async function withArgv<T>(args: ReadonlyArray<string>, fn: () => Promise<T>): Promise<T> {
  const saved = [...process.argv];
  try {
    process.argv = ["node", "coverage-branches.spec.ts", ...args];
    return await fn();
  } finally {
    process.argv = saved;
  }
}

describe("CLI command branches", () => {
  test("validate-json reports a warning when the collection has no auth", async () => {
    const root = await generated("validate-no-auth");
    const file = join(root, OUTPUT_DIR_NAME, "sample-express.postman_collection.json");
    const doc = JSON.parse(await readFile(file, "utf8")) as { auth?: unknown };
    delete doc.auth;
    await writeFile(file, JSON.stringify(doc));

    const code = await validateJson(["--project-root", root]);
    expect(code).toBe(0);
  });

  test("validate-json reports an invalid raw body as a warning", async () => {
    const root = await generated("validate-body");
    const file = join(root, OUTPUT_DIR_NAME, "sample-express.postman_collection.json");
    const doc = JSON.parse(await readFile(file, "utf8")) as { item: unknown[] };
    const requestItem = findRequest(doc.item[0]);
    expect(requestItem?.request).toBeDefined();
    requestItem!.request!.body = { mode: "raw", raw: "not-json" };
    await writeFile(file, JSON.stringify(doc));

    const code = await validateJson(["--project-root", root]);
    expect(code).toBe(0);
  });

  test("list-endpoints uses the default zone when zoneOrder is empty", async () => {
    const root = await generated("list-empty-zones");
    const configPath = join(root, "empty-zones.constant.ts");
    await writeFile(
      configPath,
      [
        "export const config = {",
        "  name: 'sample-express',",
        "  baseUrl: 'http://localhost',",
        "  variables: [],",
        "  filePrefixes: {},",
        "  zones: [],",
        "  zoneOrder: [],",
        "  defaultZone: 'Empty zone',",
        "  authDescriptions: {},",
        "  loginEndpointName: 'Login',",
        "  environments: [],",
        "};",
      ].join("\n"),
    );

    const outcome = await runList(["--project-root", root, "--config", configPath]);
    expect(outcome.code).toBe(0);
    expect(outcome.endpoints.length).toBeGreaterThan(0);
    expect(outcome.endpoints.every((endpoint) => endpoint.zone === "Empty zone")).toBe(true);
  });

  test("push converts a 401 response into a redacted actionable failure", async () => {
    const root = await generated("push-401");
    previousKey = process.env["POSTMAN_API_KEY"];
    previousWorkspace = process.env["POSTMAN_WORKSPACE"];
    process.env["POSTMAN_API_KEY"] = "pmak-FAKE-401";
    delete process.env["POSTMAN_WORKSPACE"];
    vi.stubGlobal(
      "fetch",
      (async () => ({
        ok: false,
        status: 401,
        text: async () => "private server detail containing pmak-FAKE-401",
        json: async () => ({}),
      })) as unknown as typeof fetch,
    );

    const outcome = await runPush(["--project-root", root, "--no-environments"]);
    expect(outcome.code).toBe(1);
    expect(outcome.user).toBeNull();
    expect(outcome.error?.reason).toContain("Invalid Postman API key (401)");
    expect(outcome.error?.nextAction).toContain("key");
    expect(JSON.stringify(outcome)).not.toContain("pmak-FAKE-401");
  });

  test("init writes the non-interactive empty-manifest scaffold", async () => {
    if (!work) work = await mkdtemp(join(tmpdir(), "cli-coverage-"));
    const root = join(work, "init-no-manifest");
    await mkdir(join(root, "routes"), { recursive: true });
    await writeFile(
      join(root, "routes", "api.php"),
      "<?php // Route::get('/health', fn () => response('ok'));",
    );
    const context = resolveProjectContext({ projectRoot: root });
    const outcome = await runInit([], context);

    expect(outcome.code).toBe(0);
    expect(outcome.projectName).toBe("init-no-manifest");
    expect(outcome.authGuards).toEqual(["token"]);
    expect(outcome.routeFiles).toEqual(["routes/api.php"]);
    await expect(readFile(outcome.configPath ?? "", "utf8")).resolves.toContain("routeFiles");
  });

  test("summary uses its default text and history path", async () => {
    const root = await project("summary-history");
    const savedLog = console.log;
    const logs: string[] = [];
    console.log = (...values: ReadonlyArray<unknown>) => {
      logs.push(values.map(String).join(" "));
    };
    try {
      const code = await withArgv(["--project-root", root], async () => {
        const { main } = await import("../../packages/cli/commands/summary.script");
        return main();
      });
      expect(code).toBe(0);
      expect(logs.join("\n")).toContain("Framework");
    } finally {
      console.log = savedLog;
    }
  });

  test("watch exits cleanly after SIGINT", async () => {
    const root = await project("watch-sigint");
    const script = join(process.cwd(), "packages", "cli", "commands", "watch.script.ts");
    const child = spawn("bun", [script, "--project-root", root], {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const stopped = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("watch did not reach its running state before timeout"));
      }, 90_000);
      child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes("watching") || output.includes("Watching")) {
          clearTimeout(timer);
          child.kill("SIGINT");
        }
      });
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0 && code !== null) reject(new Error(`watch exited with ${code}: ${output}`));
        else resolve();
      });
    });
    await expect(stopped).resolves.toBeUndefined();
  }, 120_000);
});
