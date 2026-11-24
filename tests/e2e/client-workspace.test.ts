import { cp, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { run } from "../../packages/cli/cli.script";
import type { ClientProjectCandidates, IClientProjectLinksInput } from "../../packages/contracts/interfaces/core/client-consumption.interface";
import { analyzeClientProjectLinks, inspectClientProjectCandidates } from "../../packages/core/discovery/client-usage.service";
import { defaultOrchestrator } from "../../packages/frameworks/framework.registry";
import { CLI_ENTRYPOINT, smokeFixtureDir } from "../../scripts/helpers/root.helper";
import { runProcess } from "../helpers/run-process";
import { createTempProject, type ITempProject } from "../helpers/scanner-fixture";

let fixture: ITempProject;
let root: string;
let frontendWorkspace: string;
let admin: string;
let storefront: string;
let backend: string;
let cwd: string;
let planPath: string;
let backendCandidates: Extract<ClientProjectCandidates, { role: "backend" }>;
let canonicalPlan: IClientProjectLinksInput;
const orchestrator = defaultOrchestrator();

beforeAll(async () => {
  fixture = await createTempProject({
    "workspace/package.json": JSON.stringify({ name: "clients", private: true, workspaces: ["apps/*"] }),
    "workspace/apps/admin/package.json": JSON.stringify({ name: "admin" }),
    "workspace/apps/admin/client.ts": 'import http from "./transport";\nhttp.get("/api/users");\nfetch("/missing");',
    "workspace/apps/storefront/package.json": JSON.stringify({ name: "storefront" }),
    "workspace/apps/storefront/page.ts": 'fetch("/api/users");\nfetch(runtimeUrl());',
    "elsewhere/README.txt": "A directory independent of the plan.",
    "plans/malformed.json": '{ "frontends": [',
    "plans/invalid.json": JSON.stringify({
      frontends: [{ root: "../workspace/apps/admin", aliases: [{ receiver: "http", module: "./transport" }] }],
      links: [],
    }),
  }, "tanit-cli-client-workspace-");
  root = await realpath(fixture.root);
  frontendWorkspace = join(root, "workspace");
  admin = join(frontendWorkspace, "apps", "admin");
  storefront = join(frontendWorkspace, "apps", "storefront");
  backend = join(root, "backend");
  cwd = join(root, "elsewhere");
  planPath = join(root, "plans", "selection.json");
  await cp(smokeFixtureDir("openapi"), backend, { recursive: true });
  const inspection = await inspectClientProjectCandidates(backend, "backend", orchestrator);
  if (inspection.role !== "backend" || !inspection.services[0]) throw new Error("Missing OpenAPI backend service");
  backendCandidates = inspection;
  const { serviceId } = inspection.services[0];
  const aliases = [{ receiver: "http", source: "./transport" }];
  const relativeAdmin = "../workspace/apps/admin";
  await writeFile(planPath, "\uFEFF" + JSON.stringify({
    frontends: [{ root: relativeAdmin, aliases }, { root: storefront }],
    links: [{ frontendRoot: relativeAdmin, backendRoot: "../backend", serviceId }],
  }));
  canonicalPlan = {
    frontends: [{ root: admin, aliases }, { root: storefront }],
    links: [{ frontendRoot: admin, backendRoot: backend, serviceId }],
  };
});

afterAll(async () => fixture?.cleanup());

function cli(command: string, ...args: string[]) {
  return runProcess("bun", [CLI_ENTRYPOINT, command, ...args], {
    cwd,
    env: { TANIT_PROJECT_ROOT: cwd, TANIT_OUTPUT_DIR: join(root, "artifacts") },
  });
}

describe("workspace client analysis CLI", () => {
  test("lists canonical frontend roots and backend service IDs without selecting them", async () => {
    const [front, back] = await Promise.all([
      cli("client-candidates", "--project-root", "../workspace", "--role", "frontend"),
      cli("client-candidates", "--project-root=../backend", "--role=backend"),
    ]);
    expect(front.code, front.stderr).toBe(0);
    expect(back.code, back.stderr).toBe(0);
    expect(front.stderr).toBe("");
    expect(JSON.parse(front.stdout)).toEqual({
      role: "frontend",
      root: frontendWorkspace,
      projects: expect.arrayContaining([
        { root: admin, relativePath: "apps/admin" },
        { root: storefront, relativePath: "apps/storefront" },
      ]),
    });
    expect(JSON.parse(back.stdout)).toEqual(backendCandidates);
    expect(backendCandidates.services).toEqual([expect.objectContaining({
      serviceId: expect.any(String), framework: "openapi", httpOperationCount: 4,
    })]);
  });

  test("anchors roots to the plan directory, preserves explicit links and leaves the workspace unchanged", async () => {
    const files = [planPath, join(admin, "client.ts"), join(storefront, "page.ts"), join(backend, "openapi.yaml")];
    const readInputs = () => Promise.all(files.map((file) => readFile(file, "utf8")));
    const [beforeFiles, beforeInputs] = await Promise.all([
      readdir(root, { recursive: true }),
      readInputs(),
    ]);
    const expected = await analyzeClientProjectLinks(canonicalPlan, orchestrator);
    const { code, stdout, stderr } = await cli("client-links", "--plan", "../plans/selection.json");

    expect(code, stderr).toBe(0);
    const report: unknown = JSON.parse(stdout);
    expect(report).toEqual(JSON.parse(JSON.stringify(expected)));
    expect(report).toMatchObject({
      frontends: [
        {
          root: admin,
          calls: [
            { status: "matched", usage: { evidence: { recognizer: "configured-alias" } } },
            { status: "missing" },
          ],
          backends: [{ root: backend, serviceId: backendCandidates.services[0]?.serviceId }],
        },
        { root: storefront, calls: [{ status: "unknown" }, { status: "unknown" }], backends: [] },
      ],
    });
    expect((await readdir(root, { recursive: true })).sort()).toEqual(beforeFiles.sort());
    expect(await readInputs()).toEqual(beforeInputs);
  });

  test("rejects malformed JSON and an invalid plan schema on stderr", async () => {
    const [malformed, invalid] = await Promise.all([
      cli("client-links", "--plan", "../plans/malformed.json"),
      cli("client-links", "--plan", "../plans/invalid.json"),
    ]);
    for (const result of [malformed, invalid]) {
      expect(result.code).not.toBe(0);
      expect(result.stdout).toBe("");
    }
    expect(malformed.stderr).toContain("valid JSON");
    expect(invalid.stderr).toContain("Invalid plan");
    expect(invalid.stderr).toContain("module");
  });

  test("documents its usage and rejects missing or unsupported options", async () => {
    const [candidatesHelp, linksHelp, noRoot, invalidRole, noPlan, extraOption] = await Promise.all([
      cli("client-candidates", "--help"),
      cli("client-links", "-h"),
      cli("client-candidates", "--role", "frontend"),
      cli("client-candidates", "--project-root", "../workspace", "--role", "anything"),
      cli("client-links"),
      cli("client-links", "--plan", "../plans/selection.json", "--format", "json"),
    ]);
    expect(candidatesHelp).toMatchObject({ code: 0, stdout: expect.stringContaining("--project-root <folder> --role frontend|backend") });
    expect(linksHelp).toMatchObject({ code: 0, stdout: expect.stringContaining("--plan <file>") });
    for (const [result, flag] of [
      [noRoot, "--project-root"], [invalidRole, "--role"], [noPlan, "--plan"], [extraOption, "--format"],
    ] as const) {
      expect(result.code).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(flag);
    }
  });

  test("supports in-process dispatch for successful reports and rejects invalid caller inputs", async () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await run(["client-candidates", "--project-root", backend, "--role", "backend"])).toBe(0);
      expect(await run(["client-links", "--plan", planPath])).toBe(0);
      expect(stdout).toHaveBeenCalledTimes(2);
      expect(stderr).not.toHaveBeenCalled();
      stdout.mockClear();

      expect(await run(["client-candidates", "-h"])).toBe(0);
      expect(await run(["client-links", "--help"])).toBe(0);
      stdout.mockClear();
      expect(await run(["client-candidates", "--role", "frontend"])).not.toBe(0);
      expect(await run(["client-candidates", "--project-root", root, "--role", "invalid"])).not.toBe(0);
      expect(await run(["client-links"])).not.toBe(0);
      expect(await run(["client-links", "--plan", join(root, "plans", "malformed.json")])).not.toBe(0);
      expect(await run(["client-links", "--plan", join(root, "plans", "invalid.json")])).not.toBe(0);
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalledTimes(5);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
});
