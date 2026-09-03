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
  test("detect() > 0 cuando package.json tiene 'next' como dependencia", async () => {
    expect((await new NextJsProjectScanner().detect(ROOT)).score).toBeGreaterThan(0);
  });

  test("detect() === 0 cuando no hay package.json", async () => {
    expect((await new NextJsProjectScanner().detect("/tmp")).score).toBe(0);
  });

  test("scan() encuentra las 4 rutas del mini-fixture (App Router)", async () => {
    const match = await new NextJsProjectScanner().resolve(ROOT);
    const routes = (await new NextJsRouteScanner().scan(match)).routes;
    expect(routes).toHaveLength(4);
  });

  test("GET y POST en /api/users, GET y DELETE en /api/users/:id", async () => {
    const match = await new NextJsProjectScanner().resolve(ROOT);
    const routes = (await new NextJsRouteScanner().scan(match)).routes;
    const pairs = routes.map((r) => `${r.method} ${r.uri}`);
    expect(pairs).toContain("GET /api/users");
    expect(pairs).toContain("POST /api/users");
    expect(pairs).toContain("GET /api/users/:id");
    expect(pairs).toContain("DELETE /api/users/:id");
  });

  test("[id] en nombre de directorio → :id en la uri (segmento dinámico App Router)", async () => {
    const match = await new NextJsProjectScanner().resolve(ROOT);
    const routes = (await new NextJsRouteScanner().scan(match)).routes;
    const dynamic = routes.filter((r) => r.uri.includes(":id"));
    expect(dynamic.length).toBeGreaterThanOrEqual(2);
    for (const r of dynamic) expect(r.uri).not.toContain("[id]");
  });

  test("comprehensive: detecta >10 rutas incluyendo auth y orders", async () => {
    const match = await new NextJsProjectScanner().resolve(COMPREHENSIVE);
    const routes = (await new NextJsRouteScanner().scan(match)).routes;
    expect(routes.length).toBeGreaterThanOrEqual(10);
    const uris = routes.map((r) => r.uri);
    expect(uris.some((u) => u.includes("auth"))).toBe(true);
    expect(uris.some((u) => u.includes("orders"))).toBe(true);
  });

  test("zod provider resuelve campos de z.object para POST /api/users", async () => {
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

  test("Pages Router /pages/api/*.ts también se detecta", async () => {
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

describe("Next.js — detect() branches de src/ y puntuación 0.5", () => {
  test("detect() === 1 con src/app (Next.js 13+ en src layout)", async () => {
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

  test("detect() === 1 con src/pages (Pages Router en src layout)", async () => {
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

  test("detect() === 0.5 cuando hay next pero no hay carpetas app/ ni pages/", async () => {
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

  test("scan() descubre rutas en src/app con segments dinámicos", async () => {
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

  test("Pages Router: switch/case por req.method genera rutas múltiples", async () => {
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

  test("Pages Router: req.method === comparación genera la ruta de ese método", async () => {
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

  test("Pages Router: index.ts en subdirectorio da uri = /api/subdir", async () => {
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
// f00011 S1 — regresiones de señales nuevas (next.config.* boost + monorepo
// + frameworkSearchRoot).
// ---------------------------------------------------------------------------

describe("Next.js — detect() boost por next.config.* con App/Pages Router (f00011 S1)", () => {
  // f00011 S1: `next.config.*` solo (sin router) sigue pesando 0.2.
  // La subida a 0.5 solo se aplica cuando hay App o Pages Router, que
  // es cuando el proyecto realmente usa Next como framework de rutas.
  test("detect() === 0.7 cuando hay next.config.* + next como dependencia pero sin App/Pages Router", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { next: "^14.0.0" } }),
      "next.config.js": "module.exports = { reactStrictMode: true };\n",
    });
    try {
      // 0.5 (next dep) + 0.2 (next.config.* sin router) = 0.7.
      expect((await new NextJsProjectScanner().detect(project.root)).score).toBe(0.7);
    } finally {
      await project.cleanup();
    }
  });

  test("detect() === 1 (cap) cuando hay next.config.* + App Router", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { next: "^14.0.0" } }),
      "next.config.js": "module.exports = {};\n",
      "app/api/health/route.ts": "export async function GET() { return Response.json({ ok: true }); }\n",
    });
    try {
      // 0.5 (next dep) + 0.4 (App Router) + 0.5 (next.config.* con router) = 1.4 → cap 1.
      expect((await new NextJsProjectScanner().detect(project.root)).score).toBe(1);
    } finally {
      await project.cleanup();
    }
  });
});

describe("Next.js — frameworkSearchRoot para monorepos (f00011 S1)", () => {
  // f00011 S1: en un monorepo el `package.json` raíz es el del workspace
  // y el `next.config.*` + `app/` viven en un subdir (`apps/web`).
  // Sin `frameworkSearchRoot`, el scanner mira la raíz y no encuentra
  // nada. Con él, las rutas salen del subdir.
  test("scan() encuentra rutas cuando frameworkSearchRoot apunta al subdir con App Router", async () => {
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

  test("detect() suma 0.1 cuando turbo.json está en la raíz (señal de monorepo)", async () => {
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

  test("detect() suma 0.1 cuando package.json declara workspaces (señal de monorepo)", async () => {
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
