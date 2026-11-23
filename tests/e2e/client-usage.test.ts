import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { run } from "../../packages/cli/cli.script";
import { CLI_ENTRYPOINT } from "../../scripts/helpers/root.helper";
import { runProcess } from "../helpers/run-process";

let workspace = "";

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "tanit-client-usage-"));
  const frontend = join(workspace, "frontend");
  const backend = join(workspace, "backend");
  await Promise.all([mkdir(frontend), mkdir(backend)]);
  await Promise.all([
    writeFile(join(frontend, "client.ts"), [
      'import http from "./transport";',
      'fetch("/items");',
      'fetch(runtimeUrl());',
      'http.post("/outside-catalog");',
      'client.get("/items");',
    ].join("\n")),
    writeFile(join(frontend, "View.vue"), '<template><button @click="loadUsers">Load users</button></template>'),
    writeFile(join(backend, "openapi.json"), JSON.stringify({
      openapi: "3.0.0",
      info: { title: "Inventory", version: "1.0.0" },
      paths: {
        "/items": { get: { responses: { "200": { description: "OK" } } } },
        "/unused": { get: { responses: { "200": { description: "OK" } } } },
      },
    })),
  ]);
});

afterAll(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

function runClientUsage(args: string[]) {
  return runProcess("bun", [CLI_ENTRYPOINT, "client-usage", ...args], {
    cwd: workspace,
    env: { TANIT_PROJECT_ROOT: "frontend", TANIT_OUTPUT_DIR: join(workspace, "generated") },
  });
}

describe("apisrc client-usage", () => {
  test("reports static and unresolved calls as JSON without requiring a backend", async () => {
    const { code, stdout, stderr } = await runClientUsage(["--format", "json"]);
    expect(code, stderr).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      usages: [
        expect.objectContaining({
          method: "GET",
          path: "/items",
          location: expect.objectContaining({ file: "client.ts", line: 2 }),
        }),
        expect.objectContaining({ unresolvedReason: "dynamic-url" }),
      ],
      diagnostics: [{ file: "View.vue", reason: "unsupported-template" }],
      counts: { resolved: 1, unresolved: 1, matched: 0, missing: 0, ambiguous: 0 },
    });
  });

  test("compares with a scanned backend catalog without writing project artifacts", async () => {
    const { code, stdout, stderr } = await runClientUsage([
      "--project-root", "frontend",
      "--backend-root", "backend",
      "--format=json",
      "--client-alias", "http=./transport",
      "--client-alias=client",
    ]);

    expect(code, stderr).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      usages: [
        { method: "GET", path: "/items", correlation: { status: "matched", candidates: [{ method: "GET", uri: "/items" }] } },
        { unresolvedReason: "dynamic-url", correlation: { status: "unknown", candidates: [] } },
        {
          method: "POST", path: "/outside-catalog",
          evidence: { recognizer: "configured-alias" }, correlation: { status: "missing" },
        },
        { method: "GET", path: "/items", evidence: { recognizer: "configured-alias" }, correlation: { status: "matched" } },
      ],
      counts: { resolved: 3, unresolved: 1, matched: 2, missing: 1, ambiguous: 0 },
      operationsWithoutConfirmedConsumer: [{ method: "GET", uri: "/unused" }],
    });
    expect((await readdir(workspace)).sort()).toEqual(["backend", "frontend"]);
    expect((await readdir(join(workspace, "frontend"))).sort()).toEqual(["View.vue", "client.ts"]);
    expect(await readdir(join(workspace, "backend"))).toEqual(["openapi.json"]);
  });

  test("prints source locations, unresolved reasons and backend comparison by default", async () => {
    const { code, stdout, stderr } = await runClientUsage(["--backend-root=backend"]);
    expect(code, stderr).toBe(0);
    expect(stdout).toContain("Client usage: 1 resolved, 1 unresolved");
    expect(stdout).toContain("Backend comparison: 1 matched, 0 missing, 0 ambiguous");
    expect(stdout).toContain("client.ts:2:1 fetch GET /items (matched)");
    expect(stdout).toContain("client.ts:3:1 fetch (dynamic-url, unknown)");
    expect(stdout).toContain("View.vue: unsupported-template");
    expect(stdout).toContain("Backend operations without a confirmed consumer:\n  GET /unused");
  });

  test("dispatches in-process and reports input errors without printing a report", async () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await run(["client-usage", "--help"])).toBe(0);
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining("--client-alias"));
      stdout.mockClear();

      expect(await run(["client-usage", "--format", "xml"])).toBe(1);
      expect(await run(["client-usage", "--client-alias", "=./transport"])).toBe(1);
      expect(await run(["client-usage", "--project-root="])).toBe(1);
      expect(await run(["client-usage", "--backend-root", join(workspace, "absent")])).toBe(1);
      expect(stderr).toHaveBeenCalledTimes(4);
      expect(stdout).not.toHaveBeenCalled();

      expect(await run([
        "client-usage", "--project-root", join(workspace, "frontend"),
        "--backend-root", join(workspace, "backend"), "--client-alias", "http=./transport",
      ])).toBe(0);
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining("Backend comparison: 1 matched, 1 missing"));
      expect(await run([
        "client-usage", "--project-root", join(workspace, "frontend"),
        "--format", "json", "--client-alias", "client",
      ])).toBe(0);
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"resolved":2'));
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  test.each([
    ["--project-root", "absent-frontend"],
    ["--backend-root", "frontend/client.ts"],
  ])("rejects an invalid %s on stderr", async (flag, path) => {
    const { code, stdout, stderr } = await runClientUsage([flag, path, "--format", "json"]);
    expect(code).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("Client usage failed:");
  });
});
