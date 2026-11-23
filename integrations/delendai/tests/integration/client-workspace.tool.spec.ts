import { copyFile, mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { ZodType } from "zod";

import {
  ClientProjectCandidatesInputSchema,
  ClientProjectLinksInputSchema,
} from "../../../../packages/contracts/constants/core/client-consumption.constant";
import {
  analyzeClientProjectLinks,
  inspectClientProjectCandidates,
} from "../../../../packages/core/discovery/client-usage.service";
import { defaultOrchestrator } from "../../../../packages/frameworks/index";
import plugin from "../../src/index";
import { captureTool, makeContext, registeredTools, workspaceRoot } from "../helpers/plugin-context";

let temporaryRoot: string;
let workspace: string;
let frontend: string;
let backend: string;
let outside: string;

beforeAll(async () => {
  temporaryRoot = await mkdtemp(join(await realpath(tmpdir()), "tanit-client-workspace-mcp-"));
  workspace = join(temporaryRoot, "workspace");
  frontend = join(workspace, "apps", "frontend");
  backend = join(workspace, "backend");
  outside = join(temporaryRoot, "outside");
  await Promise.all([
    mkdir(frontend, { recursive: true }),
    mkdir(backend, { recursive: true }),
    mkdir(outside),
  ]);
  await Promise.all([
    writeFile(join(workspace, "package.json"), JSON.stringify({ private: true, workspaces: ["apps/*"] })),
    writeFile(join(frontend, "client.ts"), 'http.get("/api/users");\nfetch(runtimeUrl());'),
    copyFile(
      join(workspaceRoot(import.meta.url), "tests/smoke-fixtures/openapi-mini/openapi.yaml"),
      join(backend, "openapi.yaml"),
    ),
    symlink(outside, join(workspace, "outside-link"), "junction"),
    symlink(frontend, join(workspace, "frontend-link"), "junction"),
  ]);
});

afterAll(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

async function capture(id: "client_candidates" | "client_links") {
  const registrations = await registeredTools(plugin, makeContext({ workspaceRoot: workspace }));
  const registration = registrations.find((tool) => tool.id === id);
  if (!registration) throw new Error(`Missing registration for ${id}`);
  expect(registration.effects).toEqual([]);
  const tool = await captureTool(registration);
  expect(tool.name).toBe(`tanit_${id}`);
  return tool;
}

function expectExactOutput(outputSchema: unknown, expected: unknown) {
  if (!(outputSchema instanceof ZodType)) throw new Error("Expected a registered Zod output schema");
  expect(outputSchema.parse(expected)).toEqual(expected);
}

test("client_candidates registers the shared input and returns the shared inventories", async () => {
  const tool = await capture("client_candidates");
  const orchestrator = defaultOrchestrator();
  expect(tool.inputSchema).toBe(ClientProjectCandidatesInputSchema);

  for (const [request, projectRoot, role] of [
    [".", workspace, "frontend"],
    [backend, backend, "backend"],
  ] as const) {
    const expected = await inspectClientProjectCandidates(projectRoot, role, orchestrator);
    const response = await tool.handler({ projectRoot: request, role });
    expect(response.isError).toBeUndefined();
    expect(response).toHaveProperty("structuredContent", expected);
    expect(JSON.parse(response.content[0]?.text ?? "")).toEqual(expected);
    expectExactOutput(tool.outputSchema, expected);
    if (expected.role === "frontend") {
      expect(expected.projects.map(({ relativePath }) => relativePath)).toEqual(["", "apps/frontend"]);
    } else {
      expect(expected.services).toMatchObject([{ framework: "openapi", httpOperationCount: 4 }]);
    }
  }
});

test("client_links returns the shared canonical report and leaves project files untouched", async () => {
  const tool = await capture("client_links");
  const orchestrator = defaultOrchestrator();
  expect(tool.inputSchema).toBe(ClientProjectLinksInputSchema);
  const inventory = await inspectClientProjectCandidates(backend, "backend", orchestrator);
  if (inventory.role !== "backend" || !inventory.services[0]) throw new Error("Expected an OpenAPI service");
  const { serviceId } = inventory.services[0];
  const aliases = [{ receiver: "http" }];
  const before = (await readdir(workspace, { recursive: true })).sort();

  const response = await tool.handler({
    frontends: [{ root: "frontend-link", aliases }],
    links: [{ frontendRoot: frontend, backendRoot: "backend", serviceId }],
  });
  const expected = await analyzeClientProjectLinks({
    frontends: [{ root: frontend, aliases }],
    links: [{ frontendRoot: frontend, backendRoot: backend, serviceId }],
  }, orchestrator);

  expect(response.isError).toBeUndefined();
  expect(response).toHaveProperty("structuredContent", expected);
  expect(JSON.parse(response.content[0]?.text ?? "")).toEqual(expected);
  expectExactOutput(tool.outputSchema, expected);
  expect(expected.frontends[0]?.calls.map(({ status }) => status)).toEqual(["matched", "unknown"]);
  expect((await readdir(workspace, { recursive: true })).sort()).toEqual(before);
});

test("both tools reject traversal, absolute escapes, and junction escapes in every root field", async () => {
  const candidates = await capture("client_candidates");
  const links = await capture("client_links");
  const frontends = [{ root: "apps/frontend" }];
  const link = { frontendRoot: "apps/frontend", backendRoot: "backend", serviceId: "unused" };
  const containmentError = {
    isError: true,
    structuredContent: { ok: false, error: { reason: expect.stringMatching(/workspace/iu) } },
  };

  for (const path of ["../outside", outside, "outside-link"]) {
    expect(await candidates.handler({ projectRoot: path, role: "frontend" })).toMatchObject(containmentError);
    expect(await links.handler({ frontends: [{ root: path }], links: [] })).toMatchObject(containmentError);
    expect(await links.handler({ frontends, links: [{ ...link, frontendRoot: path }] })).toMatchObject(containmentError);
    expect(await links.handler({ frontends, links: [{ ...link, backendRoot: path }] })).toMatchObject(containmentError);
  }
});
