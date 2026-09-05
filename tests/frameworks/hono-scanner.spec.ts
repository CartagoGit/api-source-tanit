/**
 * Hono scanner.
 *
 * Hono is the edge-runtimes framework (Workers, Deno, Bun). It
 * resembles Express, but two things break a scanner written for
 * Express:
 *
 *   - **It chains**: `app.get("/a", h).get("/b", h)` is one expression
 *     and two routes, and the second `.get` has no identifier in
 *     front of it.
 *   - **It mounts sub-apps** with `app.route("/api", sub)`, which is
 *     how it sets a prefix.
 */
import { describe, expect, test } from "vitest";

import {
  HonoProjectScanner,
  HonoRouteScanner,
  HonoZodValidatorProvider,
} from "../../packages/frameworks/scanners/hono.scanner";
import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture, createTempProject } from "../helpers/scanner-fixture";
import { comprehensiveFixtureDir } from "../../scripts/helpers/root.helper";

describeScannerContract({
  framework: "hono",
  fixtureRoot: comprehensiveFixture("hono"),
  capabilities: { validation: true, pathParams: true, stripsComments: true },
  minimalProject: {
    "package.json": '{"name":"mini","type":"module","dependencies":{"hono":"^4.6.0"}}',
    "index.ts":
      'import { Hono } from "hono";\nconst app = new Hono();\napp.get("/vivo", (c) => c.json({}));\nexport default app;\n',
  },
  commentedEndpoint: {
    file: "index.ts",
    source: '// app.get("/endpoint-comentado", (c) => c.json({}));',
  },
});

const FIXTURE = comprehensiveFixtureDir("hono");

async function scanFixture() {
  const match = await new HonoProjectScanner().resolve(FIXTURE);
  const scanner = new HonoRouteScanner();
  const result = await scanner.scan(match);
  return { match, scanner, result, routes: result.routes };
}

describe("detection", () => {
  test("a project with `hono` scores 1", async () => {
    expect((await new HonoProjectScanner().detect(FIXTURE)).score).toBe(1);
  });

  test("a project without hono scores 0", async () => {
    expect((await new HonoProjectScanner().detect(comprehensiveFixtureDir("gin"))).score).toBe(0);
  });
});

describe("Hono-specific shapes", () => {
  // The reason to have its own scanner: the Express one looks for
  // `<ident>.method(`, and on a chain the second `.get` does not
  // have one.
  test("chained routes are all counted", async () => {
    const { routes } = await scanFixture();
    for (const uri of ["/api/health", "/api/status", "/api/version"]) {
      expect(routes.some((r) => r.uri === uri), uri).toBe(true);
    }
  });

  test("the `route()` prefix is applied", async () => {
    const { routes } = await scanFixture();
    expect(routes.every((r) => r.uri.startsWith("/api/"))).toBe(true);
  });

  test("path params are preserved", async () => {
    const { routes } = await scanFixture();
    expect(routes.some((r) => r.uri.includes(":id"))).toBe(true);
  });

  test("no route is repeated", async () => {
    const { routes } = await scanFixture();
    const keys = routes.map((r) => `${r.method} ${r.uri}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("validation with @hono/zod-validator", () => {
  test("resolves the schema of a POST", async () => {
    const { match, result, routes } = await scanFixture();
    const provider = new HonoZodValidatorProvider();
    const post = routes.find((r) => r.method === "POST" && r.uri === "/api/users")!;

    const { fields } = await provider.resolve(post, match, result);
    const byName = new Map(fields.map((f) => [f.fieldName, f]));
    expect([...byName.keys()].sort()).toEqual(["age", "email", "name", "role"]);
    expect(byName.get("email")?.required).toBe(true);
    expect(byName.get("age")?.required).toBe(false);
  });

  // `zValidator("query", …)` does not validate the body: its
  // fields are query.
  test("the validator's target decides where fields go", async () => {
    const { match, result, routes } = await scanFixture();
    const provider = new HonoZodValidatorProvider();
    const get = routes.find((r) => r.method === "GET" && r.uri === "/api/users")!;

    const { fields } = await provider.resolve(get, match, result);
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.every((f) => f.location === "query")).toBe(true);
  });

  // The regression: with a fixed character window, a route without
  // a validator ended up with the next one's and came out with rules
  // that weren't its own.
  test("a route without a validator does not inherit another route's", async () => {
    const { match, result, routes } = await scanFixture();
    const provider = new HonoZodValidatorProvider();
    const health = routes.find((r) => r.uri === "/api/health")!;
    expect(await provider.supports(health, match, result)).toBe(false);
  });

  test("two concurrent scans do not mix validators", async () => {
    const projects = await Promise.all([
      createTempProject({
        "package.json": '{"dependencies":{"hono":"^4.6.0"}}',
        "index.ts": 'import { Hono } from "hono";\nconst app = new Hono();\napp.post("/a", zValidator("json", tag_a));\n',
      }, "hono-concurrent-a-"),
      createTempProject({
        "package.json": '{"dependencies":{"hono":"^4.6.0"}}',
        "index.ts": 'import { Hono } from "hono";\nconst app = new Hono();\napp.post("/b", zValidator("json", tag_b));\n',
      }, "hono-concurrent-b-"),
    ]);
    try {
      const results = await Promise.all(projects.map(async (project) => {
        const match = await new HonoProjectScanner().resolve(project.root);
        return new HonoRouteScanner().scan(match);
      }));
      expect(results[0]?.validators?.get("POST /a")?.name).toBe("tag_a");
      expect(results[0]?.validators?.has("POST /b")).toBe(false);
      expect(results[1]?.validators?.get("POST /b")?.name).toBe("tag_b");
      expect(results[1]?.validators?.has("POST /a")).toBe(false);
    } finally {
      await Promise.all(projects.map((project) => project.cleanup()));
    }
  });
});

// ---------------------------------------------------------------------------
// f00011 S1 — regression for new signals (wrangler.toml +
// frameworkSearchRoot).
// ---------------------------------------------------------------------------

describe("Hono — detect() por wrangler.toml (f00011 S1)", () => {
  // f00011 S1: `wrangler.toml` at the root is the canonical signal
  // of a Cloudflare Workers project (the main use of Hono).
  // Weight 0.6 — high, but not as high as the direct dependency
  // (1.0) because `wrangler.toml` is also used by projects that
  // are not hono.
  test("detect() === 1 (cap) when there is wrangler.toml + hono as a dependency", async () => {
    const project = await createTempProject({
      "package.json": '{"dependencies":{"hono":"^4.6.0"}}',
      "wrangler.toml": 'name = "demo"\nmain = "src/index.ts"\n',
    });
    try {
      // 1.0 (hono dep) + 0.6 (wrangler.toml) = 1.6 → cap 1.
      expect((await new HonoProjectScanner().detect(project.root)).score).toBe(1);
    } finally {
      await project.cleanup();
    }
  });

  test("detect() === 0 when only wrangler.toml is present (no hono declared) — audit 2026-09-04 P2 #8", async () => {
    // Previously this case scored 0.6 and classified itty-router /
    // vanilla Workers / Remix on Cloudflare projects as Hono. Now
    // wrangler.toml alone is NOT framework evidence; it stays as a
    // runtime bonus when `hono` is already declared.
    const project = await createTempProject({
      "package.json": '{"name":"demo"}',
      "wrangler.toml": 'name = "demo"\nmain = "src/index.ts"\n',
    });
    try {
      expect((await new HonoProjectScanner().detect(project.root)).score).toBe(0);
    } finally {
      await project.cleanup();
    }
  });

  test("evidence includes 'wrangler.toml present' when applicable", async () => {
    const project = await createTempProject({
      "package.json": '{"dependencies":{"hono":"^4.6.0"}}',
      "wrangler.toml": 'name = "demo"\n',
    });
    try {
      const result = await new HonoProjectScanner().detect(project.root);
      const wranglerEvidence = result.evidence.find((e) =>
        e.signal.includes("wrangler.toml"),
      );
      expect(wranglerEvidence).toBeDefined();
      expect(wranglerEvidence?.weight).toBe(0.6);
    } finally {
      await project.cleanup();
    }
  });
});

describe("Hono — frameworkSearchRoot para monorepos (f00011 S1)", () => {
  // f00011 S1: in a monorepo `apps/api/` has the `index.ts` with
  // the Hono routes. Without `frameworkSearchRoot` the scanner
  // walks the root and finds nothing; with it, the subdir scan
  // comes out.
  test("scan() finds routes when frameworkSearchRoot points at the index.ts subdir", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ workspaces: ["apps/*"] }),
      "apps/api/package.json": '{"dependencies":{"hono":"^4.6.0"}}',
      "apps/api/wrangler.toml": 'name = "demo"\n',
      "apps/api/index.ts":
        'import { Hono } from "hono";\nconst app = new Hono();\napp.get("/health", (c) => c.json({}));\nexport default app;\n',
    });
    try {
      const match = await new HonoProjectScanner().resolve(project.root);
      const routes = (await new HonoRouteScanner().scan({
        ...match,
        frameworkSearchRoot: "apps/api",
      })).routes;
      const pairs = routes.map((r) => `${r.method} ${r.uri}`);
      expect(pairs).toContain("GET /health");
    } finally {
      await project.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// f00011 S4 — lockfiles como bonus de scoring en detect().
// ---------------------------------------------------------------------------

describe("Hono — lockfiles as runtime bonuses (f00011 S4)", () => {
  // f00011 S4: `pnpm-lock.yaml` and `bun.lockb` sharpen the
  // detector's confidence without being detection. Small weights:
  // +0.1 (pnpm), +0.15 (bun). The `withEvidence` cap of 1 already
  // absorbs the case of a Hono project with `hono` declared; the
  // bonus stays in `evidence` even though it does not change the
  // visible score. Bun is especially relevant here — Hono is
  // first-class in Bun.
  test("pnpm-lock.yaml adds evidence with weight 0.1", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { hono: "^4.6.0" } }),
      "pnpm-lock.yaml": "",
    });
    try {
      const result = await new HonoProjectScanner().detect(project.root);
      const pnpm = result.evidence.find((e) => e.artifact === "pnpm-lock.yaml");
      expect(pnpm).toBeDefined();
      expect(pnpm?.weight).toBe(0.1);
    } finally {
      await project.cleanup();
    }
  });

  test("bun.lockb adds evidence with weight 0.15", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { hono: "^4.6.0" } }),
      "bun.lockb": "",
    });
    try {
      const result = await new HonoProjectScanner().detect(project.root);
      const bun = result.evidence.find((e) => e.artifact === "bun.lockb");
      expect(bun).toBeDefined();
      expect(bun?.weight).toBe(0.15);
    } finally {
      await project.cleanup();
    }
  });

  test("pnpm-lock.yaml + bun.lockb add both signals", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { hono: "^4.6.0" } }),
      "pnpm-lock.yaml": "",
      "bun.lockb": "",
    });
    try {
      const result = await new HonoProjectScanner().detect(project.root);
      expect(result.evidence.some((e) => e.artifact === "pnpm-lock.yaml")).toBe(true);
      expect(result.evidence.some((e) => e.artifact === "bun.lockb")).toBe(true);
    } finally {
      await project.cleanup();
    }
  });

  test("without lockfiles no lockfile signal appears", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { hono: "^4.6.0" } }),
    });
    try {
      const result = await new HonoProjectScanner().detect(project.root);
      expect(result.evidence.some((e) => e.artifact === "pnpm-lock.yaml")).toBe(false);
      expect(result.evidence.some((e) => e.artifact === "bun.lockb")).toBe(false);
    } finally {
      await project.cleanup();
    }
  });
});

describe("Hono — bun.lock (texto, Bun ≥ 1.2) detection (x00035)", () => {
  // x00035 S2: Hono es el framework más Bun-first; la ausencia de test
  // para el formato moderno era especialmente visible.
  test("bun.lock (text) adds evidence with weight 0.15", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { hono: "^4.6.0" } }),
      "bun.lock": "",
    });
    try {
      const result = await new HonoProjectScanner().detect(project.root);
      const bun = result.evidence.find((e) => e.artifact === "bun.lock");
      expect(bun).toBeDefined();
      expect(bun?.weight).toBe(0.15);
      expect(result.evidence.some((e) => e.artifact === "bun.lockb")).toBe(false);
    } finally {
      await project.cleanup();
    }
  });

  test("when both bun.lock and bun.lockb exist, bun.lock wins and bun.lockb is ignored", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { hono: "^4.6.0" } }),
      "bun.lock": "",
      "bun.lockb": "",
    });
    try {
      const result = await new HonoProjectScanner().detect(project.root);
      expect(result.evidence.some((e) => e.artifact === "bun.lock")).toBe(true);
      expect(result.evidence.some((e) => e.artifact === "bun.lockb")).toBe(false);
    } finally {
      await project.cleanup();
    }
  });
});
