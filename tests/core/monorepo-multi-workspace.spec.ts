/**
 * Expanded detection in multi-workspace monorepos — audit 2026-09-04 P1 #1.
 *
 * Previously, `discoverSpecs()` ran `detectAll(projectRoot)` **once**
 * against the root. In a monorepo with several materialized
 * workspaces (`apps/api`, `apps/web`, `packages/auth`),
 * `frameworkSearchRoot` stayed `null` (because there are several) and
 * the scanners looked at the repo root, not the workspace where each
 * framework lives.
 *
 * Result: NestJS in `apps/api` was not detected, because its
 * `package.json` is at `apps/api`, not at the root. The collection
 * came out empty without warning.
 *
 * The fix (`expandMonorepoDetection` in `generation.pipeline.ts`)
 * keeps root detection for simple cases, and **expands** detection
 * against each workspace when there are ≥2 and no override.
 *
 * This test verifies:
 *   1. A monorepo `apps/api` (Nest) + `apps/web` (Express) generates
 *      specs for both, each with its correct `frameworkSearchRoot`.
 *   2. Single-workspace monorepo behavior does not change: expanded
 *      detection does not fire (the helper's auto-fill is enough).
 *   3. The `--framework-search-root` override stays authoritative:
 *      with an override, it does NOT expand.
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
  work = await mkdtemp(join(tmpdir(), "monorepo-multi-workspace-"));
}, 30_000);

afterAll(async () => {
  for (const p of projects) await p.cleanup();
  if (work) await rm(work, { recursive: true, force: true });
});

describe("multi-workspace monorepo: expanded detection (audit P1 #1)", () => {
  test("NestJS in apps/api + Express in apps/web → detects both", async () => {
    const project = await createTempProject(
      {
        "package.json": JSON.stringify({
          name: "monorepo-mix",
          private: true,
          workspaces: ["apps/*"],
        }),
        // apps/api: NestJS
        "apps/api/package.json": JSON.stringify({
          name: "@mono/api",
          dependencies: { "@nestjs/core": "^10.0.0" },
        }),
        "apps/api/src/app.controller.ts": `import { Controller, Get } from "@nestjs/common";
@Controller("widgets")
export class AppController {
  @Get() list() { return []; }
}
`,
        // apps/web: Express
        "apps/web/package.json": JSON.stringify({
          name: "@mono/web",
          dependencies: { express: "^4.19.0" },
        }),
        "apps/web/server.js": `const express = require("express");
const app = express();
app.get("/pages", (_req, res) => res.json([]));
`,
      },
      "monorepo-multi-",
    );
    projects.push(project);

    const result = await generateCollection(project.root, {
      orchestrator: defaultOrchestrator(),
      // x00024: multi-service without --combine-services now throws
      // `MultipleServicesWithoutCombineError`. This test verifies the
      // EXPANSION of discovery, not the "one collection per service"
      // policy, so we request the legacy combination (a single
      // `IGenerationResult` with endpoints from both workspaces).
      combineServices: true,
    });

    // The strong verification: both frameworks are in
    // `result.collection` with at least one endpoint each. Without the
    // expansion, NestJS endpoints would not appear because the
    // monorepo root has no `src/app.controller.ts` and no
    // `@nestjs/core` in its root package.json.
    const items = flattenItems(result.collection.item ?? []);
    const uris = items.map((i) => i.request?.url?.raw ?? "");

    expect(
      uris.some((u) => u.includes("/widgets")),
      `Expected at least one /widgets endpoint from NestJS, found: ${JSON.stringify(uris)}`,
    ).toBe(true);
    expect(
      uris.some((u) => u.includes("/pages")),
      `Expected at least one /pages endpoint from Express, found: ${JSON.stringify(uris)}`,
    ).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(2);
  }, 30_000);

  test("monorepo with a single workspace: legacy behavior (no expansion)", async () => {
    // If there is only ONE materialized workspace, the legacy path
    // (auto-fill of frameworkSearchRoot by monorepo-detector) is still
    // valid. `expandMonorepoDetection` must not duplicate or break
    // anything.
    const project = await createTempProject(
      {
        "package.json": JSON.stringify({
          name: "monorepo-single",
          private: true,
          workspaces: ["apps/api"],
        }),
        "apps/api/package.json": JSON.stringify({
          name: "@mono/api",
          dependencies: { "@nestjs/core": "^10.0.0" },
        }),
        "apps/api/src/app.controller.ts": `import { Controller, Get } from "@nestjs/common";
@Controller("items")
export class AppController {
  @Get() list() { return []; }
}
`,
      },
      "monorepo-single-",
    );
    projects.push(project);

    const result = await generateCollection(project.root, {
      orchestrator: defaultOrchestrator(),
    });

    const items = flattenItems(result.collection.item ?? []);
    const uris = items.map((i) => i.request?.url?.raw ?? "");
    expect(uris.some((u) => u.includes("/items"))).toBe(true);
    // The single-workspace monorepo warning must still be present.
    expect(
      result.warnings.some((w) =>
        w.includes("Monorepo detectado") && w.includes("apps/api"),
      ),
    ).toBe(true);
  }, 30_000);

  test("override --framework-search-root stays authoritative (no expansion)", async () => {
    // If the user passes an explicit `frameworkSearchRoot`, expanded
    // detection must not fire. Only the workspace the user asked for
    // is scanned, without inventing additional candidates.
    const project = await createTempProject(
      {
        "package.json": JSON.stringify({
          name: "monorepo-override",
          private: true,
          workspaces: ["apps/api", "apps/web"],
        }),
        "apps/api/package.json": JSON.stringify({
          name: "@mono/api",
          dependencies: { "@nestjs/core": "^10.0.0" },
        }),
        "apps/api/src/app.controller.ts": `import { Controller, Get } from "@nestjs/common";
@Controller("alpha")
export class AppController {
  @Get() list() { return []; }
}
`,
        "apps/web/package.json": JSON.stringify({
          name: "@mono/web",
          dependencies: { express: "^4.19.0" },
        }),
        "apps/web/server.js": `const express = require("express");
const app = express();
app.get("/beta", (_req, res) => res.json([]));
`,
      },
      "monorepo-override-",
    );
    projects.push(project);

    const result = await generateCollection(project.root, {
      orchestrator: defaultOrchestrator(),
      frameworkSearchRoot: "apps/api",
    });

    const items = flattenItems(result.collection.item ?? []);
    const uris = items.map((i) => i.request?.url?.raw ?? "");
    // Override to apps/api → only Nest. /beta (Express) must NOT appear.
    expect(uris.some((u) => u.includes("/alpha"))).toBe(true);
    expect(uris.some((u) => u.includes("/beta"))).toBe(false);
  }, 30_000);
});

/** Flattens the Postman items tree (can be nested by folders). */
function flattenItems(
  items: ReadonlyArray<{ item?: ReadonlyArray<unknown>; request?: { url?: { raw?: string } } }>,
): Array<{ request?: { url?: { raw?: string } } }> {
  const out: Array<{ request?: { url?: { raw?: string } } }> = [];
  for (const it of items) {
    if (it.request) out.push(it as { request?: { url?: { raw?: string } } });
    if (it.item) {
      out.push(
        ...flattenItems(
          it.item as ReadonlyArray<{ item?: ReadonlyArray<unknown>; request?: { url?: { raw?: string } } }>,
        ),
      );
    }
  }
  return out;
}

describe("monorepo + --framework (audit 2nd-review #5)", () => {
  test("forceFramework + frameworkSearchRoot: respects the force even when the manifest does not detect", async () => {
    // Audit case: the user forces --framework nestjs + --framework-search-root apps/api
    // because the workspace manifest does not allow autodetect.
    // Previously `expandMonorepoDetection` called `detectAll(workspaceRoot)`
    // and lost the force.
    const project = await createTempProject(
      {
        "package.json": JSON.stringify({
          name: "monorepo-force",
          private: true,
          workspaces: ["apps/api"],
        }),
        // Without @nestjs/core in any manifest — the force must prevail.
        "apps/api/package.json": JSON.stringify({
          name: "@mono/api",
          dependencies: { express: "^4.19.0" }, // NOT nest
        }),
        "apps/api/src/app.controller.ts": `import { Controller, Get } from "@nestjs/common";
@Controller("forced")
export class AppController {
  @Get() list() { return []; }
}
`,
      },
      "monorepo-force-framework-",
    );
    projects.push(project);

    const result = await generateCollection(project.root, {
      orchestrator: defaultOrchestrator(),
      forceFramework: "nestjs",
      frameworkSearchRoot: "apps/api",
    });

    // There must be at least one nestjs endpoint in apps/api, even
    // though the manifest does not declare @nestjs/core (that is what
    // the force means: the user KNOWS it is Nest).
    const items = flattenItems(result.collection.item ?? []);
    const uris = items.map((i) => i.request?.url?.raw ?? "");
    expect(uris.some((u) => u.includes("/forced"))).toBe(true);
  });
});
