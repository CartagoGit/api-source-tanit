import { copyFile, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { ZodObject } from "zod";

import { analyzeClientProjects } from "../../../../packages/core/discovery/client-usage.service";
import { defaultOrchestrator } from "../../../../packages/frameworks/index";
import { buildClientUsageToolRegistration } from "../../src/lib/tools/client-usage.tool";
import { captureTool, makeContext, workspaceRoot } from "../helpers/plugin-context";

let temporaryRoot: string;
let workspace: string;
let frontend: string;
let backend: string;

beforeAll(async () => {
  temporaryRoot = await mkdtemp(join(await realpath(tmpdir()), "tanit-client-usage-"));
  workspace = join(temporaryRoot, "workspace");
  frontend = join(workspace, "frontend");
  backend = join(workspace, "backend");
  await mkdir(frontend, { recursive: true });
  await mkdir(backend);
  await writeFile(join(frontend, "client.ts"), [
    'fetch("/api/users");',
    'http.get("/api/unknown");',
    "fetch(dynamicUrl);",
  ].join("\n"));
  await writeFile(join(frontend, "app.vue"), '<template><button @click="loadItems">Load</button></template>');
  await copyFile(
    join(workspaceRoot(import.meta.url), "tests/smoke-fixtures/openapi-mini/openapi.yaml"),
    join(backend, "openapi.yaml"),
  );
  await symlink(temporaryRoot, join(workspace, "outside"), "junction");
  await symlink(frontend, join(workspace, "inside"), "junction");
});

afterAll(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

function makeTool(options?: Record<string, unknown>) {
  return captureTool(buildClientUsageToolRegistration(makeContext({ workspaceRoot: workspace, options })));
}

test("publishes the shared structured result and a strict schema with a backend selected", async () => {
  const tool = await makeTool({ defaultProjectRoot: "inside" });
  expect(tool.name).toBe("tanit_client_usage");

  const aliases = [{ receiver: "http" }];
  const response = await tool.handler({ backendRoot: "backend", aliases });
  const expected = await analyzeClientProjects({
    projectRoot: frontend, backendRoot: backend, aliases,
  }, defaultOrchestrator());

  expect(response.isError).toBeUndefined();
  expect(response).toHaveProperty("structuredContent", expected);
  expect(JSON.parse(response.content[0]?.text ?? "")).toEqual(expected);
  expect(expected.counts).toEqual({ resolved: 2, unresolved: 1, matched: 1, missing: 1, ambiguous: 0 });
  expect(expected.diagnostics).toEqual([{ file: "app.vue", reason: "unsupported-template" }]);
  expect(expected.operationsWithoutConfirmedConsumer).toHaveLength(3);

  const schema = tool.outputSchema;
  if (!(schema instanceof ZodObject)) throw new Error("Expected a registered Zod object");
  expect(schema.parse(expected)).toEqual(expected);
  expect(schema.safeParse({ ...expected, ok: true }).success).toBe(false);
  expect(schema.safeParse({
    ...expected,
    usages: expected.usages.map((usage) => ({ ...usage, evidence: { ...usage.evidence, extra: true } })),
  }).success).toBe(false);
});

test("supports the workspace fallback and an explicit absolute root", async () => {
  const expectedWorkspace = await analyzeClientProjects({ projectRoot: workspace }, defaultOrchestrator());
  const fromWorkspace = await (await makeTool()).handler({});
  expect(fromWorkspace).toHaveProperty("structuredContent", expectedWorkspace);

  const expectedFrontend = await analyzeClientProjects({ projectRoot: frontend }, defaultOrchestrator());
  const overriddenDefault = await (await makeTool({ defaultProjectRoot: ".." })).handler({ projectRoot: frontend });
  expect(overriddenDefault).toHaveProperty("structuredContent", expectedFrontend);
});

test.for(["projectRoot", "backendRoot"])("rejects outside, symlinked, and missing %s paths", async (field) => {
  const tool = await makeTool();
  for (const path of ["..", temporaryRoot, "outside", "does-not-exist"]) {
    const response = await tool.handler({ projectRoot: "frontend", [field]: path });
    expect(response).toMatchObject({
      isError: true,
      structuredContent: { ok: false, error: { reason: expect.stringContaining(field) } },
    });
  }
});

test("rejects a configured project root outside the workspace and malformed aliases", async () => {
  const tool = await makeTool({ defaultProjectRoot: "outside" });
  expect(await tool.handler({})).toMatchObject({
    isError: true,
    structuredContent: { ok: false, error: { reason: expect.stringContaining("projectRoot") } },
  });
  expect(await tool.handler({ aliases: [{ receiver: "http", extra: true }] })).toMatchObject({
    isError: true,
    structuredContent: { ok: false, error: { reason: expect.stringContaining("extra") } },
  });
});

test("returns an explicit diagnostic for a Vue external script", async () => {
  const component = join(workspace, "external-component");
  await mkdir(component);
  await writeFile(join(component, "external.vue"), '<script src="./client.js"></script>');
  const response = await (await makeTool()).handler({ projectRoot: "external-component" });
  expect(response.isError).toBeUndefined();
  expect(response).toHaveProperty("structuredContent.diagnostics", [
    { file: "external.vue", reason: "unsupported-script" },
  ]);
  expect(response).toHaveProperty("structuredContent.usages", []);
});

test("publishes Angular HttpClient evidence under its own recognizer", async () => {
  const angular = join(workspace, "angular-client");
  await mkdir(angular);
  await writeFile(join(angular, "items.ts"), [
    'import { HttpClient } from "@angular/common/http";',
    'class Items {',
    '  constructor(private readonly api: HttpClient) {}',
    '  load() { return this.api.get("/api/users"); }',
    '}',
  ].join("\n"));
  const tool = await makeTool();
  const response = await tool.handler({ projectRoot: "angular-client", backendRoot: "backend" });
  const expected = await analyzeClientProjects({ projectRoot: angular, backendRoot: backend }, defaultOrchestrator());
  expect(response.isError).toBeUndefined();
  expect(response).toHaveProperty("structuredContent", expected);
  expect(expected.usages).toMatchObject([{
    method: "GET", path: "/api/users",
    evidence: { recognizer: "angular-http-client", callee: "this.api.get" },
    correlation: { status: "matched" },
  }]);
  const schema = tool.outputSchema;
  if (!(schema instanceof ZodObject)) throw new Error("Expected a registered Zod object");
  expect(schema.parse(expected)).toEqual(expected);
});
