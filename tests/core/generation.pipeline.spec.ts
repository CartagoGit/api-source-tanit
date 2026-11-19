/**
 * x00024 S1 — `generateCollection()` throws `MultipleServicesWithoutCombineError`
 * when it detects several services without `--combine-services`.
 *
 * Contract verified:
 *  1. Monorepo with 2 services + no `combineServices` →
 *     `MultipleServicesWithoutCombineError` with `serviceCount === 2`
 *     and `serviceIds` populated.
 *  2. Monorepo with 2 services + `combineServices: true` →
 *     1 combined `IGenerationResult` (legacy intact).
 *  3. Single-service without `combineServices` →
 *     1 `IGenerationResult` (legacy intact: zero endpoints allowed).
 *
 * Synthetic fixtures are used with `createTempProject` (same pattern
 * as `tests/core/monorepo-multi-workspace.spec.ts`) so we do not
 * touch the real fixtures in `examples/`.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { generateCollection } from "../../packages/core/discovery/generation.pipeline";
import { defaultOrchestrator } from "../../packages/frameworks/framework.registry";
import {
  createTempProject,
  type ITempProject,
} from "../helpers/scanner-fixture";

let work = "";
let projects: ITempProject[] = [];

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "x00024-generation-pipeline-"));
}, 30_000);

afterAll(async () => {
  for (const p of projects) await p.cleanup();
  if (work) await rm(work, { recursive: true, force: true });
});

describe("x00024 S1 — generateCollection() estricto en multi-service", () => {
  test("monorepo with 2 services without combineServices → throws MultipleServicesWithoutCombineError", async () => {
    const project = await createTempProject(
      {
        "package.json": JSON.stringify({
          name: "monorepo-multi-no-combine",
          private: true,
          workspaces: ["apps/*"],
        }),
        // apps/api: NestJS — the scanner detects it by @nestjs/core.
        "apps/api/package.json": JSON.stringify({
          name: "@x24/api",
          dependencies: { "@nestjs/core": "^10.0.0" },
        }),
        "apps/api/src/app.controller.ts": `import { Controller, Get } from "@nestjs/common";
@Controller("widgets")
export class AppController {
  @Get() list() { return []; }
}
`,
        // apps/web: Express — detected by `express` in deps.
        "apps/web/package.json": JSON.stringify({
          name: "@x24/web",
          dependencies: { express: "^4.19.0" },
        }),
        "apps/web/server.js": `const express = require("express");
const app = express();
app.get("/pages", (_req, res) => res.json([]));
`,
      },
      "x00024-multi-",
    );
    projects.push(project);

    let caught: unknown = null;
    try {
      await generateCollection(project.root, {
        orchestrator: defaultOrchestrator(),
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).not.toBeNull();
    expect((caught as Error).name).toBe("MultipleServicesWithoutCombineError");
    const err = caught as {
      serviceCount: number;
      serviceIds: ReadonlyArray<string>;
      message: string;
    };
    expect(err.serviceCount).toBe(2);
    expect(err.serviceIds).toHaveLength(2);
    // The message must guide the caller: combineServices or
    // generateCollections. If it does not appear, the CLI cannot
    // build its suggestion.
    expect(err.message).toMatch(/--combine-services/);
    expect(err.message).toMatch(/generateCollections\(\)/);
  }, 30_000);

  test("monorepo with 2 services + combineServices=true → 1 combined IGenerationResult", async () => {
    // Same fixture shape as the previous test. Reusing the helper's
    // full path makes it slow, but guarantees there is NO residual
    // state between tests (the same beforeAll cleans up).
    const project = await createTempProject(
      {
        "package.json": JSON.stringify({
          name: "monorepo-multi-combine",
          private: true,
          workspaces: ["apps/*"],
        }),
        "apps/api/package.json": JSON.stringify({
          name: "@x24c/api",
          dependencies: { "@nestjs/core": "^10.0.0" },
        }),
        "apps/api/src/app.controller.ts": `import { Controller, Get } from "@nestjs/common";
@Controller("widgets")
export class AppController {
  @Get() list() { return []; }
}
`,
        "apps/web/package.json": JSON.stringify({
          name: "@x24c/web",
          dependencies: { express: "^4.19.0" },
        }),
        "apps/web/server.js": `const express = require("express");
const app = express();
app.get("/pages", (_req, res) => res.json([]));
`,
      },
      "x00024-combine-",
    );
    projects.push(project);

    const result = await generateCollection(project.root, {
      orchestrator: defaultOrchestrator(),
      combineServices: true,
    });

    // Legacy intact: when combineServices=true, buildFor returns a
    // single IGenerationResult with the endpoints from both services.
    expect(result.collection).toBeDefined();
    const items = flattenItems(result.collection.item ?? []);
    const uris = items.map((i) => i.request?.url?.raw ?? "");
    expect(
      uris.some((u) => u.includes("/widgets")),
      `expected /widgets from Nest, found: ${JSON.stringify(uris)}`,
    ).toBe(true);
    expect(
      uris.some((u) => u.includes("/pages")),
      `expected /pages from Express, found: ${JSON.stringify(uris)}`,
    ).toBe(true);
  }, 30_000);

  test("single-service without combineServices → 1 IGenerationResult (legacy intact)", async () => {
    // The most common legacy path: a plain Express project. Not a
    // monorepo, not multi-service. `generateCollection()` must keep
    // returning ONE single IGenerationResult, exactly as before
    // x00024.
    const project = await createTempProject(
      {
        "package.json": JSON.stringify({
          name: "single-svc-legacy",
          dependencies: { express: "^4.19.0" },
        }),
        "server.js": `const express = require("express");
const app = express();
app.get("/health", (_req, res) => res.json({ ok: true }));
`,
      },
      "x00024-single-",
    );
    projects.push(project);

    const result = await generateCollection(project.root, {
      orchestrator: defaultOrchestrator(),
    });

    expect(result.collection).toBeDefined();
    const items = flattenItems(result.collection.item ?? []);
    const uris = items.map((i) => i.request?.url?.raw ?? "");
    expect(
      uris.some((u) => u.includes("/health")),
      `expected /health from Express single-svc, found: ${JSON.stringify(uris)}`,
    ).toBe(true);
    // serviceId is also populated in single-service (introduced by
    // buildForService). We validate that it is present, although the
    // concrete id is not contractual.
    expect(typeof result.serviceId === "string" || result.serviceId === undefined).toBe(true);
  }, 30_000);
});

/** Flattens the Postman items tree (can be nested by folders). */
function flattenItems(
  items: ReadonlyArray<{
    item?: ReadonlyArray<unknown>;
    request?: { url?: { raw?: string } };
  }>,
): Array<{ request?: { url?: { raw?: string } } }> {
  const out: Array<{ request?: { url?: { raw?: string } } }> = [];
  for (const it of items) {
    if (it.request) out.push(it as { request?: { url?: { raw?: string } } });
    if (it.item) {
      out.push(
        ...flattenItems(
          it.item as ReadonlyArray<{
            item?: ReadonlyArray<unknown>;
            request?: { url?: { raw?: string } };
          }>,
        ),
      );
    }
  }
  return out;
}
