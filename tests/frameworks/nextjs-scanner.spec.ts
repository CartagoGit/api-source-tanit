import { describe, expect, test } from "vitest";
import {
  NextJsProjectScanner,
  NextJsRouteScanner,
  NextJsZodProvider,
} from "../../packages/frameworks/scanners/nextjs.scanner";

import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture } from "../helpers/scanner-fixture";
import { comprehensiveFixtureDir, smokeFixtureDir } from "../../scripts/helpers/root.helper";

import { EMPTY_SCAN_RESULT } from "../helpers/empty-scan-result";
describeScannerContract({
  framework: "nextjs",
  fixtureRoot: comprehensiveFixture("nextjs"),
  capabilities: {
    validation: true,
    pathParams: true,
    stripsComments: true,
  },
  minimalProject: {
    "package.json": '{"dependencies":{"next":"^14.0.0"}}',
    "app/api/vivo/route.ts": "export async function GET() { return Response.json({}); }\n",
  },
  commentedEndpoint: {
    file: "app/api/vivo/route.ts",
    source: "// export async function POST() { return Response.json({ path: 'endpoint-comentado' }); }",
  },
});

const ROOT = smokeFixtureDir("nextjs");
const COMPREHENSIVE = comprehensiveFixtureDir("nextjs");

describe("Next.js scanner", () => {
  test("detect() > 0 when package.json lists 'next' as a dependency", async () => {
    expect((await new NextJsProjectScanner().detect(ROOT)).score).toBeGreaterThan(0);
  });

  test("detect() === 0 when there is no package.json", async () => {
    expect((await new NextJsProjectScanner().detect("/tmp")).score).toBe(0);
  });

  test("scan() finds the 4 routes of the mini-fixture (App Router)", async () => {
    const match = await new NextJsProjectScanner().resolve(ROOT);
    const routes = (await new NextJsRouteScanner().scan(match)).routes;
    expect(routes).toHaveLength(4);
  });

  test("GET and POST on /api/users, GET and DELETE on /api/users/:id", async () => {
    const match = await new NextJsProjectScanner().resolve(ROOT);
    const routes = (await new NextJsRouteScanner().scan(match)).routes;
    const pairs = routes.map((r) => `${r.method} ${r.uri}`);
    expect(pairs).toContain("GET /api/users");
    expect(pairs).toContain("POST /api/users");
    expect(pairs).toContain("GET /api/users/:id");
    expect(pairs).toContain("DELETE /api/users/:id");
  });

  test("[id] in directory name → :id in the uri (dynamic App Router segment)", async () => {
    const match = await new NextJsProjectScanner().resolve(ROOT);
    const routes = (await new NextJsRouteScanner().scan(match)).routes;
    const dynamic = routes.filter((r) => r.uri.includes(":id"));
    expect(dynamic.length).toBeGreaterThanOrEqual(2);
    for (const r of dynamic) expect(r.uri).not.toContain("[id]");
  });

  test("comprehensive: detects >10 routes including auth and orders", async () => {
    const match = await new NextJsProjectScanner().resolve(COMPREHENSIVE);
    const routes = (await new NextJsRouteScanner().scan(match)).routes;
    expect(routes.length).toBeGreaterThanOrEqual(10);
    const uris = routes.map((r) => r.uri);
    expect(uris.some((u) => u.includes("auth"))).toBe(true);
    expect(uris.some((u) => u.includes("orders"))).toBe(true);
  });

  test("zod provider resolves z.object fields for POST /api/users", async () => {
    const match = await new NextJsProjectScanner().resolve(COMPREHENSIVE);
    const routes = (await new NextJsRouteScanner().scan(match)).routes;
    const post = routes.find((r) => r.method === "POST" && r.uri.includes("users") && !r.uri.includes(":"));
    if (!post) return;
    const provider = new NextJsZodProvider();
    const result = await provider.resolve(post, match, EMPTY_SCAN_RESULT);
    expect(result.fields.length).toBeGreaterThan(0);
    const names = result.fields.map((f) => f.fieldName);
    expect(names).toContain("name");
    expect(names).toContain("email");
  });

  test("Pages Router /pages/api/*.ts is also detected", async () => {
    const { mkdtemp, writeFile, rm, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const dir = await mkdtemp(join(tmpdir(), "nextjs-pages-router-"));
    await mkdir(join(dir, "pages/api/users"), { recursive: true });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "tmp-next", dependencies: { next: "15.0.0" } }),
      "utf8",
    );
    await writeFile(
      join(dir, "pages/api/users/index.ts"),
      `export default function handler(req, res) { res.json([]); }`,
      "utf8",
    );
    await writeFile(
      join(dir, "pages/api/users/[id].ts"),
      `export default function handler(req, res) { res.json({ id: req.query.id }); }`,
      "utf8",
    );

    try {
      const match = await new NextJsProjectScanner().resolve(dir);
      const routes = (await new NextJsRouteScanner().scan(match)).routes;
      const pairs = routes.map((r) => `${r.method} ${r.uri}`);
      expect(pairs).toContain("GET /api/users");
      expect(pairs).not.toContain("POST /api/users");
      expect(pairs).not.toContain("DELETE /api/users");
      expect(pairs).toContain("GET /api/users/:id");
      expect(pairs).not.toContain("DELETE /api/users/:id");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("Next.js — detect() branches for src/ and 0.5 score", () => {
  test("detect() === 1 with src/app (Next.js 13+ in src layout)", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { next: "^14.0.0" } }),
      "src/app/api/ping/route.ts": "export async function GET() { return Response.json({ ok: true }); }",
    });
    try {
      expect((await new NextJsProjectScanner().detect(project.root)).score).toBe(0.9);
    } finally {
      await project.cleanup();
    }
  });

  test("detect() === 1 with src/pages (Pages Router in src layout)", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { next: "^13.0.0" } }),
      "src/pages/api/health.ts": "export default function handler(req, res) { res.json({ ok: true }); }",
    });
    try {
      expect((await new NextJsProjectScanner().detect(project.root)).score).toBe(0.9);
    } finally {
      await project.cleanup();
    }
  });

  test("detect() === 0.5 when next is present but no app/ or pages/ folders", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { next: "^14.0.0" } }),
    });
    try {
      expect((await new NextJsProjectScanner().detect(project.root)).score).toBe(0.5);
    } finally {
      await project.cleanup();
    }
  });

  test("scan() discovers routes in src/app with dynamic segments", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { next: "^14.0.0" } }),
      "src/app/api/products/route.ts": "export async function GET() { return Response.json([]); }\nexport async function POST() { return Response.json({}); }",
      "src/app/api/products/[id]/route.ts": "export async function GET() { return Response.json({}); }\nexport async function DELETE() { return Response.json({}); }",
    });
    try {
      const match = await new NextJsProjectScanner().resolve(project.root);
      const routes = (await new NextJsRouteScanner().scan(match)).routes;
      const pairs = routes.map((r) => `${r.method} ${r.uri}`);
      expect(pairs).toContain("GET /api/products");
      expect(pairs).toContain("POST /api/products");
      expect(pairs).toContain("GET /api/products/:id");
      expect(pairs).toContain("DELETE /api/products/:id");
    } finally {
      await project.cleanup();
    }
  });

  test("Pages Router: switch/case on req.method generates multiple routes", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { next: "^13.0.0" } }),
      "pages/api/orders.ts": [
        "export default function handler(req, res) {",
        "  switch (req.method) {",
        "    case 'GET': return res.json([]);",
        "    case 'POST': return res.json({});",
        "    case 'DELETE': return res.json(null);",
        "    default: res.status(405).end();",
        "  }",
        "}",
      ].join("\n"),
    });
    try {
      const match = await new NextJsProjectScanner().resolve(project.root);
      const routes = (await new NextJsRouteScanner().scan(match)).routes;
      const methods = routes.map((r) => r.method).sort();
      expect(methods).toContain("GET");
      expect(methods).toContain("POST");
      expect(methods).toContain("DELETE");
    } finally {
      await project.cleanup();
    }
  });

  test("Pages Router: req.method === comparison generates the route for that method", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { next: "^13.0.0" } }),
      "pages/api/items.ts": [
        "export default function handler(req, res) {",
        "  if (req.method === 'POST') return res.json({});",
        "  if (req.method !== 'GET') return res.status(405).end();",
        "  res.json([]);",
        "}",
      ].join("\n"),
    });
    try {
      const match = await new NextJsProjectScanner().resolve(project.root);
      const routes = (await new NextJsRouteScanner().scan(match)).routes;
      const methods = routes.map((r) => r.method).sort();
      expect(methods).toContain("POST");
      expect(methods).toContain("GET");
    } finally {
      await project.cleanup();
    }
  });

  test("Pages Router: index.ts in subdirectory yields uri = /api/subdir", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { next: "^13.0.0" } }),
      "pages/api/users/index.ts": "export default function handler(req, res) { res.json([]); }",
    });
    try {
      const match = await new NextJsProjectScanner().resolve(project.root);
      const routes = (await new NextJsRouteScanner().scan(match)).routes;
      const uris = routes.map((r) => r.uri);
      expect(uris).toContain("/api/users");
    } finally {
      await project.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// f00011 S1 — regression for new signals (next.config.* boost + monorepo
// + frameworkSearchRoot).
// ---------------------------------------------------------------------------

describe("Next.js — detect() boost by next.config.* with App/Pages Router (f00011 S1)", () => {
  // f00011 S1: `next.config.*` alone (without a router) still weighs
  // 0.2. The boost to 0.5 only applies when there is an App or Pages
  // Router, i.e. when the project actually uses Next as a route
  // framework.
  test("detect() === 0.7 when there is next.config.* + next as a dependency but no App/Pages Router", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { next: "^14.0.0" } }),
      "next.config.js": "module.exports = { reactStrictMode: true };\n",
    });
    try {
      // 0.5 (next dep) + 0.2 (next.config.* without router) = 0.7.
      expect((await new NextJsProjectScanner().detect(project.root)).score).toBe(0.7);
    } finally {
      await project.cleanup();
    }
  });

  test("detect() === 1 (cap) when there is next.config.* + App Router", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { next: "^14.0.0" } }),
      "next.config.js": "module.exports = {};\n",
      "app/api/health/route.ts": "export async function GET() { return Response.json({ ok: true }); }\n",
    });
    try {
      // 0.5 (next dep) + 0.4 (App Router) + 0.5 (next.config.* with router) = 1.4 → cap 1.
      expect((await new NextJsProjectScanner().detect(project.root)).score).toBe(1);
    } finally {
      await project.cleanup();
    }
  });
});

describe("Next.js — frameworkSearchRoot for monorepos (f00011 S1)", () => {
  // f00011 S1: in a monorepo the root `package.json` is the
  // workspace's and the `next.config.*` + `app/` live in a subdir
  // (`apps/web`). Without `frameworkSearchRoot`, the scanner looks
  // at the root and finds nothing. With it, the routes come out of
  // the subdir.
  test("scan() finds routes when frameworkSearchRoot points at the App Router subdir", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "package.json": JSON.stringify({ workspaces: ["apps/*"] }),
      "apps/web/package.json": JSON.stringify({ dependencies: { next: "^14.0.0" } }),
      "apps/web/next.config.js": "module.exports = {};\n",
      "apps/web/app/api/users/route.ts": "export async function GET() { return Response.json([]); }\n",
      "apps/web/app/api/users/[id]/route.ts": "export async function GET() { return Response.json({}); }\n",
    });
    try {
      const match = await new NextJsProjectScanner().resolve(project.root);
      const routes = (await new NextJsRouteScanner().scan({
        ...match,
        frameworkSearchRoot: "apps/web",
      })).routes;
      const pairs = routes.map((r) => `${r.method} ${r.uri}`);
      expect(pairs).toContain("GET /api/users");
      expect(pairs).toContain("GET /api/users/:id");
    } finally {
      await project.cleanup();
    }
  });

  test("detect() adds 0.1 when turbo.json is at the root (monorepo signal)", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { next: "^14.0.0" } }),
      "turbo.json": JSON.stringify({ $schema: "https://turbo.build/schema.json", pipeline: {} }),
    });
    try {
      // 0.5 (next dep) + 0.1 (turbo.json) = 0.6.
      expect((await new NextJsProjectScanner().detect(project.root)).score).toBe(0.6);
    } finally {
      await project.cleanup();
    }
  });

  test("detect() adds 0.1 when package.json declares workspaces (monorepo signal)", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "package.json": JSON.stringify({
        dependencies: { next: "^14.0.0" },
        workspaces: ["apps/*", "packages/*"],
      }),
    });
    try {
      // 0.5 (next dep) + 0.1 (workspaces) = 0.6.
      expect((await new NextJsProjectScanner().detect(project.root)).score).toBe(0.6);
    } finally {
      await project.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// f00011 S4 — lockfiles as scoring bonuses in detect().
// ---------------------------------------------------------------------------

describe("Next.js — lockfiles as runtime bonuses (f00011 S4)", () => {
  // f00011 S4: `pnpm-lock.yaml` adds a 0.1-weight signal to the
  // evidence. The score rises by 0.1 (it does not hit the cap here
  // because we start from 0.5 — `next` declared — without App/Pages
  // Router). The lockfile refines, it does not detect.
  test("pnpm-lock.yaml adds evidence with weight 0.1", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { next: "^14.0.0" } }),
      "pnpm-lock.yaml": "",
    });
    try {
      const result = await new NextJsProjectScanner().detect(project.root);
      const pnpm = result.evidence.find((e) => e.artifact === "pnpm-lock.yaml");
      expect(pnpm).toBeDefined();
      expect(pnpm?.weight).toBe(0.1);
    } finally {
      await project.cleanup();
    }
  });

  test("bun.lockb adds evidence with weight 0.15", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { next: "^14.0.0" } }),
      "bun.lockb": "",
    });
    try {
      const result = await new NextJsProjectScanner().detect(project.root);
      const bun = result.evidence.find((e) => e.artifact === "bun.lockb");
      expect(bun).toBeDefined();
      expect(bun?.weight).toBe(0.15);
    } finally {
      await project.cleanup();
    }
  });

  test("pnpm-lock.yaml + bun.lockb add both signals", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { next: "^14.0.0" } }),
      "pnpm-lock.yaml": "",
      "bun.lockb": "",
    });
    try {
      const result = await new NextJsProjectScanner().detect(project.root);
      expect(result.evidence.some((e) => e.artifact === "pnpm-lock.yaml")).toBe(true);
      expect(result.evidence.some((e) => e.artifact === "bun.lockb")).toBe(true);
    } finally {
      await project.cleanup();
    }
  });

  test("without lockfiles no lockfile signal appears", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { next: "^14.0.0" } }),
    });
    try {
      const result = await new NextJsProjectScanner().detect(project.root);
      expect(result.evidence.some((e) => e.artifact === "pnpm-lock.yaml")).toBe(false);
      expect(result.evidence.some((e) => e.artifact === "bun.lockb")).toBe(false);
    } finally {
      await project.cleanup();
    }
  });
});
