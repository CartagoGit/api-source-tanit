import { cp, readFile, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type {
  ClientCandidatesOutput,
  ClientLinksInput,
  ClientLinksOutput,
} from "../../packages/contracts/interfaces/core/application-api.interface.js";
import { dispatch } from "../../packages/core/application-api/dispatcher.js";
import { buildRegistry } from "../../packages/core/application-api/handlers.js";
import { analyzeClientProjectLinks } from "../../packages/core/discovery/client-usage.service.js";
import { getSession } from "../../packages/core/session/project-session.service.js";
import { defaultOrchestrator } from "../../packages/frameworks/framework.registry.js";
import { smokeFixtureDir } from "../../scripts/helpers/root.helper.js";
import { createTempProject, type ITempProject } from "../helpers/scanner-fixture.js";

let fixture: ITempProject;
let root: string;
let admin: string;
let storefront: string;
let backend: string;
const registry = buildRegistry();
const ctx = { caller: "desktop", orchestrator: defaultOrchestrator() } as const;

beforeAll(async () => {
  fixture = await createTempProject({
    "package.json": JSON.stringify({ name: "clients", private: true, workspaces: ["apps/*"] }),
    "apps/admin/package.json": JSON.stringify({ name: "admin", dependencies: { react: "^19.0.0" } }),
    "apps/admin/client.ts": 'import http from "./transport";\nhttp.get("/api/users");',
    "apps/storefront/package.json": JSON.stringify({ name: "storefront", dependencies: { vue: "^3.5.0" } }),
    "apps/storefront/Users.vue": [
      "<template><button>Load users</button></template>",
      '<script setup lang="ts">fetch("/outside-catalog"); fetch(runtimeUrl());</script>',
    ].join("\n"),
  }, "tanit-app-client-links-");
  root = await realpath(fixture.root);
  admin = join(root, "apps", "admin");
  storefront = join(root, "apps", "storefront");
  backend = join(root, "backend");
  await cp(smokeFixtureDir("openapi"), backend, { recursive: true });
});

afterAll(async () => fixture?.cleanup());

describe("workspace client usage Application API", () => {
  test("discovers both candidate roles and uses their roots and service IDs for explicit links", async () => {
    const before = (await readdir(root, { recursive: true })).sort();
    const readInputs = () => Promise.all([
      readFile(join(admin, "client.ts"), "utf8"),
      readFile(join(storefront, "Users.vue"), "utf8"),
      readFile(join(backend, "openapi.yaml"), "utf8"),
    ]);
    const inputsBefore = await readInputs();
    const frontendReport = await dispatch<ClientCandidatesOutput>(registry, "client-candidates", {
      projectRoot: root, role: "frontend",
    }, ctx);
    expect(frontendReport).toMatchObject({
      ok: true,
      value: {
        role: "frontend",
        root,
        projects: expect.arrayContaining([
          expect.objectContaining({ root: admin }),
          expect.objectContaining({ root: storefront }),
        ]),
      },
    });
    if (!frontendReport.ok || frontendReport.value.role !== "frontend") {
      throw new Error("Frontend candidates were not returned");
    }
    const selectedAdmin = frontendReport.value.projects.find(({ root }) => root === admin);
    const selectedStorefront = frontendReport.value.projects.find(({ root }) => root === storefront);
    if (!selectedAdmin || !selectedStorefront) throw new Error("Expected both workspace candidates");

    const backendReport = await dispatch<ClientCandidatesOutput>(registry, "client-candidates", {
      projectRoot: backend, role: "backend",
    }, ctx);
    expect(backendReport).toMatchObject({
      ok: true,
      value: {
        role: "backend",
        root: backend,
        services: [{ serviceId: expect.any(String), framework: "openapi", httpOperationCount: 4 }],
      },
    });
    if (!backendReport.ok || backendReport.value.role !== "backend") {
      throw new Error("Backend candidates were not returned");
    }
    const { root: backendRoot, services: [service] } = backendReport.value;
    if (!service) throw new Error("Expected one OpenAPI service");
    const input: ClientLinksInput = {
      frontends: [
        { root: selectedAdmin.root, aliases: [{ receiver: "http", source: "./transport" }] },
        { root: selectedStorefront.root },
      ],
      links: [selectedAdmin, selectedStorefront].map(({ root: frontendRoot }) => ({
        frontendRoot, backendRoot, serviceId: service.serviceId,
      })),
    };
    const result = await dispatch<ClientLinksOutput>(registry, "client-links", input, ctx);
    expect(result).toStrictEqual({ ok: true, value: await analyzeClientProjectLinks(input, ctx.orchestrator) });
    expect(result).toMatchObject({
      ok: true,
      value: { frontends: [
        {
          root: admin,
          calls: [{ status: "matched", usage: { evidence: { recognizer: "configured-alias" } } }],
          backends: [{ root: backend, serviceId: service.serviceId }],
        },
        {
          root: storefront,
          calls: [{ status: "missing" }, { status: "unknown" }],
          diagnostics: [{ file: "Users.vue", reason: "unsupported-template" }],
          backends: [{ root: backend, serviceId: service.serviceId }],
        },
      ] },
    });

    for (const selected of [root, admin, storefront, backend]) expect(getSession(selected)).toBeNull();
    expect((await readdir(root, { recursive: true })).sort()).toEqual(before);
    expect(await readInputs()).toEqual(inputsBefore);
  });

  test.each([
    ["relative selected frontend", () => ({ frontends: [{ root: "apps/admin" }], links: [] })],
    ["relative link frontend", () => ({
      frontends: [{ root: admin }],
      links: [{ frontendRoot: "apps/admin", backendRoot: backend, serviceId: "api" }],
    })],
    ["relative link backend", () => ({
      frontends: [{ root: admin }],
      links: [{ frontendRoot: admin, backendRoot: "backend", serviceId: "api" }],
    })],
    ["unexpected link field", () => ({
      frontends: [{ root: admin }],
      links: [{ frontendRoot: admin, backendRoot: backend, serviceId: "api", operations: [] }],
    })],
    ["unexpected alias field", () => ({
      frontends: [{ root: admin, aliases: [{ receiver: "http", module: "./transport" }] }],
      links: [],
    })],
  ])("rejects %s in a client-links request", async (_scenario, input) => {
    expect(await dispatch(registry, "client-links", input(), ctx)).toMatchObject({
      ok: false, error: { code: "INVALID_INPUT" },
    });
  });

  test.each([
    ["relative root", () => ({ projectRoot: "apps/admin", role: "frontend" })],
    ["unknown role", () => ({ projectRoot: root, role: "other" })],
    ["unexpected field", () => ({ projectRoot: root, role: "frontend", scan: true })],
  ])("rejects %s in a client-candidates request", async (_scenario, input) => {
    expect(await dispatch(registry, "client-candidates", input(), ctx)).toMatchObject({
      ok: false, error: { code: "INVALID_INPUT" },
    });
  });

  test("returns execution errors without an orchestrator or when discovery fails", async () => {
    const noOrchestrator = { caller: "cli" } as const;
    const role = "backend";
    const projectRoot = join(root, "unknown-directory");
    const errors = await Promise.all([
      dispatch(registry, "client-links", { frontends: [], links: [] }, noOrchestrator),
      dispatch(registry, "client-candidates", { projectRoot, role }, noOrchestrator),
      dispatch(registry, "client-candidates", { projectRoot, role }, ctx),
    ]);
    expect(errors).toMatchObject([
      { ok: false, error: { code: "EXECUTION_FAILED", message: "client-links requires ctx.orchestrator" } },
      { ok: false, error: { code: "EXECUTION_FAILED", message: "client-candidates requires ctx.orchestrator" } },
      { ok: false, error: { code: "EXECUTION_FAILED", message: expect.stringContaining("Backend directory unavailable") } },
    ]);
  });
});
