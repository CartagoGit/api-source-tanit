import { describe, expect, test } from "vitest";
import { resolve } from "node:path";
import {
  NextJsProjectScanner,
  NextJsRouteScanner,
  NextJsZodProvider,
} from "../../frameworks/scanners/nextjs.scanner";

import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture } from "../helpers/scanner-fixture";
import { moduleDir } from "../../helper/module-path.helper";

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

const ROOT = resolve(moduleDir(import.meta.url), "../../tests/smoke-fixtures/nextjs-mini");
const COMPREHENSIVE = resolve(moduleDir(import.meta.url), "../../tests/fixtures/nextjs-comprehensive");

describe("Next.js scanner", () => {
  test("detect() > 0 cuando package.json tiene 'next' como dependencia", async () => {
    expect(await new NextJsProjectScanner().detect(ROOT)).toBeGreaterThan(0);
  });

  test("detect() === 0 cuando no hay package.json", async () => {
    expect(await new NextJsProjectScanner().detect("/tmp")).toBe(0);
  });

  test("scan() encuentra las 4 rutas del mini-fixture (App Router)", async () => {
    const match = await new NextJsProjectScanner().resolve(ROOT);
    const routes = await new NextJsRouteScanner().scan(match);
    expect(routes).toHaveLength(4);
  });

  test("GET y POST en /api/users, GET y DELETE en /api/users/:id", async () => {
    const match = await new NextJsProjectScanner().resolve(ROOT);
    const routes = await new NextJsRouteScanner().scan(match);
    const pairs = routes.map((r) => `${r.method} ${r.uri}`);
    expect(pairs).toContain("GET /api/users");
    expect(pairs).toContain("POST /api/users");
    expect(pairs).toContain("GET /api/users/:id");
    expect(pairs).toContain("DELETE /api/users/:id");
  });

  test("[id] en nombre de directorio → :id en la uri (segmento dinámico App Router)", async () => {
    const match = await new NextJsProjectScanner().resolve(ROOT);
    const routes = await new NextJsRouteScanner().scan(match);
    const dynamic = routes.filter((r) => r.uri.includes(":id"));
    expect(dynamic.length).toBeGreaterThanOrEqual(2);
    for (const r of dynamic) expect(r.uri).not.toContain("[id]");
  });

  test("comprehensive: detecta >10 rutas incluyendo auth y orders", async () => {
    const match = await new NextJsProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new NextJsRouteScanner().scan(match);
    expect(routes.length).toBeGreaterThanOrEqual(10);
    const uris = routes.map((r) => r.uri);
    expect(uris.some((u) => u.includes("auth"))).toBe(true);
    expect(uris.some((u) => u.includes("orders"))).toBe(true);
  });

  test("zod provider resuelve campos de z.object para POST /api/users", async () => {
    const match = await new NextJsProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new NextJsRouteScanner().scan(match);
    const post = routes.find((r) => r.method === "POST" && r.uri.includes("users") && !r.uri.includes(":"));
    if (!post) return;
    const provider = new NextJsZodProvider();
    const result = await provider.resolve(post, match);
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
      const routes = await new NextJsRouteScanner().scan(match);
      const pairs = routes.map((r) => `${r.method} ${r.uri}`);
      expect(pairs).toContain("GET /api/users");
      expect(pairs).toContain("POST /api/users");
      expect(pairs).toContain("GET /api/users/:id");
      expect(pairs).toContain("DELETE /api/users/:id");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
