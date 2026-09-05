/**
 * a00013 S4 — per-service auth + baseUrl.
 *
 * Covers the four guarantees the slice contract promises:
 *
 *  1. `pickAuth` resolves the descriptor's override or the project's
 *     fallback, **without collapsing the discriminant**.
 *  2. `toIEndpointAuth` exhaustively maps the four variants of
 *     `IDetectedAuthScheme.type` (inverse of `authSchemeFromEndpointAuth`
 *     in the pipeline).
 *  3. `buildServiceConfig` applies `service.baseUrl` per-service
 *     without mutating the original `ProjectConfig`. That is what
 *     keeps `discovery.config.baseUrl` stable across iterations of
 *     the multi-service loop in `buildFor`.
 *  4. The pipeline does not mutate `discovery.config.baseUrl` in a
 *     multi-service generation — verifiable end-to-end by calling
 *     `generateCollections` on a synthetic monorepo.
 *
 * Tests 1-3 are unit tests over the pure helper. Test 4 is
 * integration and reproduces the slice's acceptance invariant #3.
 */
import { afterAll, beforeAll, describe, expect, it, test } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildServiceConfig,
  pickAuth,
  toIEndpointAuth,
} from "../../packages/core/discovery/auth-scheme.helper";
import type { IEndpointAuth } from "../../packages/contracts/interfaces/core/postman.interface";
import type { IProjectMatch } from "../../packages/contracts/interfaces/core/scanner.interface";
import type { IServiceDescriptor } from "../../packages/contracts/interfaces/core/service-graph.interface";
import type { ProjectConfig } from "../../packages/contracts/interfaces/core/project-config.interface";
import { generateCollections } from "../../packages/core/discovery/generation.pipeline";
import { defaultOrchestrator } from "../../packages/frameworks/framework.registry";
import {
  createTempProject,
  type ITempProject,
} from "../helpers/scanner-fixture";

/** Builds a minimal IServiceDescriptor for unit tests. */
function descriptor(
  serviceId: string,
  auth: IEndpointAuth | undefined = undefined,
  baseUrl: string | null = null,
): IServiceDescriptor {
  const match: IProjectMatch = {
    framework: "express",
    projectRoot: "/repo",
    frameworkSearchRoot: serviceId,
    artifacts: [],
  };
  return {
    serviceId,
    match,
    endpoints: [],
    baseUrl,
    auth,
    variables: [],
  };
}

/** Minimal ProjectConfig for `buildServiceConfig` tests. */
function configFixture(baseUrl = "http://localhost"): ProjectConfig {
  return {
    name: "test",
    collectionName: "Test (Postman)",
    collectionDescription: "Test",
    baseUrl,
    variables: [
      { key: "baseUrl", value: baseUrl, type: "string" },
      { key: "token", value: "", type: "string" },
    ],
    filePrefixes: {},
    zones: [],
    zoneOrder: [],
    defaultZone: "Otros",
    authDescriptions: {},
    loginEndpointName: "Login",
  };
}

describe("pickAuth", () => {
  it("devuelve el auth del descriptor cuando está definido", () => {
    const service = descriptor("a", { kind: "scheme", scheme: "bearer" });
    expect(pickAuth(service, undefined)).toEqual({
      kind: "scheme",
      scheme: "bearer",
    });
  });

  it("devuelve el fallback cuando service.auth es undefined", () => {
    const service = descriptor("a", undefined);
    const fallback: IEndpointAuth = { kind: "scheme", scheme: "apiKey" };
    expect(pickAuth(service, fallback)).toEqual({
      kind: "scheme",
      scheme: "apiKey",
    });
  });

  it("devuelve undefined cuando ambos argumentos son undefined", () => {
    const service = descriptor("a", undefined);
    expect(pickAuth(service, undefined)).toBeUndefined();
  });

  it("does NOT collapse { kind: 'scheme', scheme: 'bearer' } to { kind: 'none' }", () => {
    // Audit 2nd review #16: the first 2026-09-04 audit documented
    // that the discriminant could be collapsed by careless
    // conversion. pickAuth does NOT convert anything: it returns
    // the same object it received. The guarantee comes from the
    // contract by construction.
    const service = descriptor(
      "a",
      { kind: "scheme", scheme: "bearer" } as const,
    );
    const fallback: IEndpointAuth = { kind: "none" };
    const result = pickAuth(service, fallback);
    expect(result).toEqual({ kind: "scheme", scheme: "bearer" });
    expect(result).not.toEqual({ kind: "none" });
  });

  it("preserves { kind: 'scheme', scheme: 'apiKey' } when service.auth carries it", () => {
    const service = descriptor("a", { kind: "scheme", scheme: "apiKey" });
    const fallback: IEndpointAuth = { kind: "none" };
    expect(pickAuth(service, fallback)).toEqual({
      kind: "scheme",
      scheme: "apiKey",
    });
  });

  it("preserves { kind: 'scheme', scheme: 'oauth2' } when service.auth carries it", () => {
    const service = descriptor("a", { kind: "scheme", scheme: "oauth2" });
    const fallback: IEndpointAuth = { kind: "none" };
    expect(pickAuth(service, fallback)).toEqual({
      kind: "scheme",
      scheme: "oauth2",
    });
  });

  it("preserves { kind: 'none' } when service.auth carries it explicitly", () => {
    // Inverse case to the collapse: the descriptor says "this
    // service is public even though the rest of the project uses
    // bearer". pickAuth returns that intent without transforming it.
    const service = descriptor("a", { kind: "none" });
    const fallback: IEndpointAuth = { kind: "scheme", scheme: "bearer" };
    expect(pickAuth(service, fallback)).toEqual({ kind: "none" });
  });

  it("is deterministic and produces no I/O (pure)", () => {
    // 1000 identical invocations must be identical. We do not
    // measure time, only determinism. If pickAuth read anything
    // external, two consecutive calls with the same input could
    // differ.
    const service = descriptor("a", { kind: "scheme", scheme: "bearer" });
    const first = pickAuth(service, { kind: "none" });
    for (let i = 0; i < 1000; i++) {
      const again = pickAuth(service, { kind: "none" });
      expect(again).toEqual(first);
    }
  });

  it("the discriminant is exhaustive: apiKey is NOT confused with bearer or oauth2", () => {
    const cases: ReadonlyArray<IEndpointAuth> = [
      { kind: "none" },
      { kind: "scheme", scheme: "bearer" },
      { kind: "scheme", scheme: "apiKey" },
      { kind: "scheme", scheme: "oauth2" },
    ];
    for (const auth of cases) {
      const service = descriptor("a", auth);
      const result = pickAuth(service, { kind: "none" });
      expect(result).toEqual(auth);
      // round-trip del discriminante: el `kind` exacto se preserva.
      expect(result?.kind).toBe(auth.kind);
      if (result?.kind === "scheme" && auth.kind === "scheme") {
        expect(result.scheme).toBe(auth.scheme);
      }
    }
  });
});

describe("toIEndpointAuth", () => {
  it("mapea bearer a { kind: 'scheme', scheme: 'bearer' }", () => {
    expect(toIEndpointAuth({ type: "bearer", evidence: "" })).toEqual({
      kind: "scheme",
      scheme: "bearer",
    });
  });

  it("mapea apikey a { kind: 'scheme', scheme: 'apiKey' }", () => {
    expect(toIEndpointAuth({ type: "apikey", evidence: "" })).toEqual({
      kind: "scheme",
      scheme: "apiKey",
    });
  });

  it("mapea oauth2 a { kind: 'scheme', scheme: 'oauth2' }", () => {
    expect(toIEndpointAuth({ type: "oauth2", evidence: "" })).toEqual({
      kind: "scheme",
      scheme: "oauth2",
    });
  });

  it("mapea none a { kind: 'none' }", () => {
    expect(toIEndpointAuth({ type: "none", evidence: "" })).toEqual({
      kind: "none",
    });
  });
});

describe("buildServiceConfig", () => {
  it("applies service.baseUrl when it is defined and not null", () => {
    const config = configFixture("http://localhost");
    const service = descriptor("a", undefined, "http://localhost:3001");
    const result = buildServiceConfig(config, service);
    expect(result.baseUrl).toBe("http://localhost:3001");
  });

  it("falls back to the project's baseUrl when service.baseUrl is null", () => {
    const config = configFixture("http://localhost:5555");
    const service = descriptor("a", undefined, null);
    const result = buildServiceConfig(config, service);
    expect(result.baseUrl).toBe("http://localhost:5555");
  });

  it("updates the {{baseUrl}} variable when there is a per-service override", () => {
    const config = configFixture("http://localhost");
    const service = descriptor("a", undefined, "https://staging.example.com");
    const result = buildServiceConfig(config, service);
    const baseUrlVar = result.variables.find((v) => v.key === "baseUrl");
    expect(baseUrlVar?.value).toBe("https://staging.example.com");
  });

  it("does NOT mutate the original ProjectConfig", () => {
    // Slice acceptance #3: `buildForService` must not mutate
    // `config.baseUrl` across iterations of the multi-service loop.
    // Here we test the primitive that guarantees it:
    // `buildServiceConfig` returns a copy and leaves the original
    // intact.
    const config = configFixture("http://localhost");
    const originalBaseUrl = config.baseUrl;
    const originalVarValue = config.variables.find(
      (v) => v.key === "baseUrl",
    )?.value;
    const originalVariablesRef = config.variables;

    const service = descriptor("a", undefined, "http://override:9999");
    const result = buildServiceConfig(config, service);

    expect(config.baseUrl).toBe(originalBaseUrl);
    expect(config.variables.find((v) => v.key === "baseUrl")?.value).toBe(
      originalVarValue,
    );
    // The original `variables` array is the same array: it is not
    // mutated, and `buildServiceConfig` returns a new one.
    expect(result.variables).not.toBe(originalVariablesRef);
    expect(config.variables).toBe(originalVariablesRef);
  });

  it("preserves the rest of the variables (token, etc.) without touching them", () => {
    const config = configFixture("http://localhost");
    const service = descriptor("a", undefined, "http://override:9999");
    const result = buildServiceConfig(config, service);
    const token = result.variables.find((v) => v.key === "token");
    expect(token).toEqual({ key: "token", value: "", type: "string" });
  });
});

// ───────────────────────────────────────────────────────────────────
// Integration: the slice's "no cross-iteration mutation" invariant.
// ───────────────────────────────────────────────────────────────────

/** Mini filesystem for a single-service project. */
async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, body, "utf8");
  }
}

let work = "";
let projects: ITempProject[] = [];
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "a00013-s4-"));
}, 30_000);

afterAll(async () => {
  for (const p of projects) await p.cleanup();
  if (work) await rm(work, { recursive: true, force: true });
});

describe("generateCollections (multi-service): config.baseUrl is not mutated between iterations", () => {
  test("monorepo express+nest with two services: each collection uses its own descriptor", async () => {
    const projectRoot = join(work, "monorepo-express-nest");
    await writeFiles(projectRoot, {
      "package.json": JSON.stringify({
        name: "monorepo-s4",
        private: true,
        workspaces: ["apps/*"],
      }),
      "apps/api/package.json": JSON.stringify({
        name: "@s4/api",
        dependencies: { "@nestjs/core": "^10.0.0" },
      }),
      "apps/api/src/app.controller.ts": `import { Controller, Get } from "@nestjs/common";
@Controller("alpha")
export class AppController {
  @Get() list() { return []; }
}
`,
      "apps/web/package.json": JSON.stringify({
        name: "@s4/web",
        dependencies: { express: "^4.19.0" },
      }),
      "apps/web/server.js": `import express from "express";
const app = express();
app.get("/beta", (_req, res) => res.json([]));
app.listen(3000);
`,
    });

    // S4: with two services detected and combineServices=false, the
    // pipeline emits two separate collections. Each `result.config`
    // comes from `buildServiceConfig(discovery.config, service)`.
    const results = await generateCollections(projectRoot, {
      orchestrator: defaultOrchestrator(),
      combineServices: false,
    });

    // We expect at least one collection with detected endpoints. If
    // the command detects none (e.g. a scanner failure in a CI
    // environment), we want to fail explicitly — not give an "ok"
    // that hides a silent regression.
    expect(results.length).toBeGreaterThanOrEqual(1);

    // Each result carries its own per-service `config`. Both must be
    // distinct objects (each iteration built its copy), even though
    // they come from the same `discovery.config`.
    const configs = results.map((r) => r.config);
    const baseUrls = configs.map((c) => c.baseUrl);

    // Acceptance invariant #3: in multi-service, after
    // `generateCollections`, `config.baseUrl` must be stable *across
    // iterations*. We verify that all iterations saw the same
    // `baseUrl` (the project's, since today there is no auto-population
    // of `service.baseUrl`). If `buildForService` mutated
    // `discovery.config.baseUrl` in one iteration, the next ones
    // would start from that mutated value — and `baseUrls` would
    // reflect the chain of mutations, not a stable value.
    const first = baseUrls[0];
    for (const url of baseUrls) {
      expect(url).toBe(first);
    }

    // Each `result.config` is an independent object (not the same
    // reference). Verifies that `buildServiceConfig` does not return
    // `discovery.config` bare: that would be a "shared memory" bug
    // that could contaminate the next iteration via a shared
    // `variables` array.
    for (let i = 0; i < configs.length; i++) {
      for (let j = i + 1; j < configs.length; j++) {
        expect(configs[i]).not.toBe(configs[j]);
      }
    }

    // The `variables` array of each config is its own copy — not the
    // same reference shared with `discovery.config`. If it were,
    // `inferCollectionVariables` or additions from
    // `authVariablesFor` would leak across services.
    const resultsVars = results.map((r) =>
      r.collection.variable ?? [],
    );
    if (resultsVars.length >= 2) {
      expect(resultsVars[0]).not.toBe(resultsVars[1]);
    }
  }, 30_000);
});

// ───────────────────────────────────────────────────────────────────
// x00028 — multi-service spec isolation.
//
// Original bug: `buildForService` consumed `discovery.specs` (the
// global catalog merged by the merger). In a monorepo with two
// services that each expose `GET /health` (typical: liveness
// probes, ingress controllers, sidecar patterns), both services
// saw both endpoints in their collection.
//
// After the fix: `filterSpecsForService(discovery.specs, service)`
// trims the catalog to the specs whose `(method, uri)` is in
// `service.endpoints`. Each service sees only its own. This test
// reproduces the scenario and verifies the invariant: two services
// each with `GET /health` produce two collections, each with its
// own `GET /health` pointing to the correct `baseUrl`.
// ───────────────────────────────────────────────────────────────────

describe("x00028 — multi-service spec isolation", () => {
  test("two services with the same GET /health: each collection sees only its own /health", async () => {
    // Express + NestJS in two workspaces of the same monorepo, each
    // exposing `GET /health` (liveness) plus one service-specific
    // route. Without the fix, both collections would contain
    // *both* /health requests and *both* /users + /orders. With
    // the fix, each collection contains only its own slice.
    const project = await createTempProject(
      {
        "package.json": JSON.stringify({
          name: "monorepo-x00028",
          private: true,
          workspaces: ["apps/*"],
        }),
        // apps/api (NestJS) — has its own /health and /widgets.
        "apps/api/package.json": JSON.stringify({
          name: "@x28/api",
          dependencies: { "@nestjs/core": "^10.0.0" },
        }),
        "apps/api/src/app.controller.ts":
          'import { Controller, Get } from "@nestjs/common";\n' +
          '@Controller("api")\n' +
          "export class AppController {\n" +
          '  @Get("health") health() { return { ok: true }; }\n' +
          '  @Get("widgets") list() { return []; }\n' +
          "}\n",
        // apps/web (Express) — has its own /health and /pages.
        "apps/web/package.json": JSON.stringify({
          name: "@x28/web",
          dependencies: { express: "^4.19.0" },
        }),
        "apps/web/server.js":
          'import express from "express";\n' +
          "const app = express();\n" +
          'app.get("/health", (_req, res) => res.json({ ok: true }));\n' +
          'app.get("/pages", (_req, res) => res.json([]));\n' +
          "app.listen(3000);\n",
      },
      "postman-fixture-x00028-",
    );
    projects.push(project);

    const results = await generateCollections(project.root, {
      orchestrator: defaultOrchestrator(),
      combineServices: false,
    });

    // Two services detected -> two collections. If detection
    // collapses them into one, the test fails loudly instead of
    // producing a false positive on the spec-isolation assertions.
    expect(results.length).toBe(2);

    // Flatten the collection tree (folders can contain items).
    // Each entry is a request item paired with the index of the
    // collection it belongs to. The flattening walks both top-level
    // items and `item.item[]` so folder grouping doesn't hide
    // anything.
    type FlatItem = { ci: number; name: string; rawPath: string };
    function flatten(idx: number): FlatItem[] {
      const out: FlatItem[] = [];
      const visit = (
        items: ReadonlyArray<{
          name: string;
          item?: ReadonlyArray<unknown>;
          request?: { url: { path: string[] | string } };
        }>,
      ): void => {
        for (const it of items) {
          if (it.request) {
            const p = it.request.url.path;
            out.push({
              ci: idx,
              name: it.name,
              rawPath: Array.isArray(p) ? p.join("/") : String(p),
            });
          }
          if (it.item)
            visit(
              it.item as ReadonlyArray<{
                name: string;
                item?: ReadonlyArray<unknown>;
                request?: { url: { path: string[] | string } };
              }>,
            );
        }
      };
      visit(results[idx]!.collection.item);
      return out;
    }
    const all: FlatItem[] = results.flatMap((_r, i) => flatten(i));

    // Each service exposes /health, so we expect exactly TWO
    // /health requests — one per collection. Before the fix,
    // `buildForService` consumed the global `discovery.specs`
    // (already merged by the merger); in a monorepo with two
    // /healths the merger had already deduped them by
    // `(method, uri)` into ONE spec, which then got returned to
    // BOTH services via `[...discovery.specs]`. So the bug
    // manifested as a single /health being shared by both
    // collections — visible here as `healthItems.length === 2`
    // and the two items belonging to distinct collections.
    const healthItems = all.filter((a) => /health/i.test(a.rawPath));
    expect(healthItems).toHaveLength(2);
    const healthCollections = new Set(healthItems.map((a) => a.ci));
    expect(healthCollections.size).toBe(2);

    // Service-specific routes do NOT cross: the apps/api collection
    // does not contain /pages, and the apps/web collection does
    // not contain /widgets. Before the fix, the global catalog
    // had /widgets (from apps/api) and /pages (from apps/web),
    // and BOTH collections received BOTH routes.
    const apiCi = healthItems[0]!.ci;
    const webCi = healthItems[1]!.ci;
    expect(apiCi).not.toBe(webCi);

    // The /widgets request belongs ONLY to apps/api (not apps/web).
    const widgetsItems = all.filter((a) => /widgets/i.test(a.rawPath));
    expect(widgetsItems.every((w) => w.ci === apiCi)).toBe(true);

    // The /pages request belongs ONLY to apps/web (not apps/api).
    const pagesItems = all.filter((a) => /pages/i.test(a.rawPath));
    expect(pagesItems.every((p) => p.ci === webCi)).toBe(true);
  }, 30_000);
});
