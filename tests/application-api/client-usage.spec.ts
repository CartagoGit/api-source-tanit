import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { ClientUsageOutput } from "../../packages/contracts/interfaces/core/application-api.interface.js";
import { dispatch } from "../../packages/core/application-api/dispatcher.js";
import { buildRegistry } from "../../packages/core/application-api/handlers.js";
import { analyzeClientProjects } from "../../packages/core/discovery/client-usage.service.js";
import { getSession } from "../../packages/core/session/project-session.service.js";
import { defaultOrchestrator } from "../../packages/frameworks/framework.registry.js";
import { smokeFixtureDir } from "../../scripts/helpers/root.helper.js";

let root = "";
let projectRoot = "";
let backendRoot = "";
const registry = buildRegistry();
const orchestrator = defaultOrchestrator();

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "tanit-app-client-usage-"));
  projectRoot = join(root, "frontend");
  backendRoot = join(root, "backend");
  await Promise.all([
    mkdir(projectRoot),
    cp(smokeFixtureDir("openapi"), backendRoot, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(projectRoot, "client.ts"), [
      'import http from "./transport";',
      'http.get("/api/users");',
      'fetch(runtimeUrl());',
    ].join("\n")),
    writeFile(join(projectRoot, "Users.vue"), [
      '<template><button>Load users</button></template>',
      '<script setup lang="ts">fetch("/api/users", { method: "POST" });</script>',
    ].join("\n")),
  ]);
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("client-usage Application API", () => {
  test("returns the shared report for separately selected roots without opening or modifying projects", async () => {
    const input = {
      projectRoot,
      backendRoot,
      aliases: [{ receiver: "http", source: "./transport" }],
    };
    const before = (await readdir(root, { recursive: true })).sort();
    const sourceFiles = ["frontend/client.ts", "frontend/Users.vue", "backend/openapi.yaml"];
    const readSources = () => Promise.all(sourceFiles.map((file) => readFile(join(root, file), "utf8")));
    const sourceBefore = await readSources();

    const result = await dispatch<ClientUsageOutput>(registry, "client-usage", input, {
      caller: "desktop",
      orchestrator,
    });

    expect(result).toStrictEqual({
      ok: true,
      value: await analyzeClientProjects(input, orchestrator),
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        counts: { resolved: 2, unresolved: 1, matched: 2, missing: 0, ambiguous: 0 },
        diagnostics: [{ file: "Users.vue", reason: "unsupported-template" }],
      },
    });
    expect(getSession(projectRoot)).toBeNull();
    expect(getSession(backendRoot)).toBeNull();
    expect((await readdir(root, { recursive: true })).sort()).toEqual(before);
    expect(await readSources()).toEqual(sourceBefore);
  });

  test("scans a frontend by itself without comparing it to a backend", async () => {
    const result = await dispatch<ClientUsageOutput>(registry, "client-usage", { projectRoot }, {
      caller: "browser",
      orchestrator,
    });
    expect(result).toStrictEqual({
      ok: true,
      value: await analyzeClientProjects({ projectRoot }, orchestrator),
    });
    expect(result.ok && result.value.operationsWithoutConfirmedConsumer).toBeUndefined();
  });

  test.each([
    ["missing frontend root", () => ({})],
    ["relative frontend root", () => ({ projectRoot: "frontend" })],
    ["relative backend root", () => ({ projectRoot, backendRoot: "backend" })],
    ["malformed alias", () => ({ projectRoot, aliases: [{ receiver: 42 }] })],
  ])("rejects %s", async (_description, rawInput) => {
    const result = await dispatch(registry, "client-usage", rawInput(), {
      caller: "browser",
      orchestrator,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });

  test("reports an execution error when the caller omits the orchestrator", async () => {
    const result = await dispatch(registry, "client-usage", { projectRoot }, { caller: "cli" });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "EXECUTION_FAILED", message: "client-usage requires ctx.orchestrator" },
    });
  });
});
