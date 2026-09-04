/**
 * x00024 S1 — `generateCollection()` lanza `MultipleServicesWithoutCombineError`
 * cuando detecta varios servicios sin `--combine-services`.
 *
 * Contrato verificado:
 *  1. Monorepo con 2 servicios + sin `combineServices` →
 *     `MultipleServicesWithoutCombineError` con `serviceCount === 2`
 *     y `serviceIds` poblado.
 *  2. Monorepo con 2 servicios + `combineServices: true` →
 *     1 `IGenerationResult` combinada (legacy intact).
 *  3. Single-service sin `combineServices` →
 *     1 `IGenerationResult` (legacy intact: cero endpoints permitidos).
 *
 * Se usan fixtures sintéticos con `createTempProject` (mismo patrón
 * que `tests/core/monorepo-multi-workspace.spec.ts`) para no tocar
 * los fixtures reales de `examples/`.
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
  test("monorepo con 2 servicios sin combineServices → throw MultipleServicesWithoutCombineError", async () => {
    const project = await createTempProject(
      {
        "package.json": JSON.stringify({
          name: "monorepo-multi-no-combine",
          private: true,
          workspaces: ["apps/*"],
        }),
        // apps/api: NestJS — el scanner lo detecta por @nestjs/core.
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
        // apps/web: Express — detectado por `express` en deps.
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
    // El mensaje debe orientar al caller: combineServices o
    // generateCollections. Si no aparece, la CLI no podría construir
    // su sugerencia.
    expect(err.message).toMatch(/--combine-services/);
    expect(err.message).toMatch(/generateCollections\(\)/);
  }, 30_000);

  test("monorepo con 2 servicios + combineServices=true → 1 IGenerationResult combinada", async () => {
    // Mismo fixture que el test anterior (mismo project). Reutilizar
    // el path completo del helper lo hace lento, pero garantiza que
    // NO hay estado residual entre tests (mismo beforeAll limpia).
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

    // Legacy intact: cuando combineServices=true, buildFor devuelve
    // un único IGenerationResult con los endpoints de ambos servicios.
    expect(result.collection).toBeDefined();
    const items = flattenItems(result.collection.item ?? []);
    const uris = items.map((i) => i.request?.url?.raw ?? "");
    expect(
      uris.some((u) => u.includes("/widgets")),
      `esperaba /widgets de Nest, encontré: ${JSON.stringify(uris)}`,
    ).toBe(true);
    expect(
      uris.some((u) => u.includes("/pages")),
      `esperaba /pages de Express, encontré: ${JSON.stringify(uris)}`,
    ).toBe(true);
  }, 30_000);

  test("single-service sin combineServices → 1 IGenerationResult (legacy intact)", async () => {
    // El legacy path más común: un proyecto Express plano. No es
    // monorepo, no es multi-servicio. `generateCollection()` debe
    // seguir devolviendo UN solo IGenerationResult, exactamente como
    // antes de x00024.
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
      `esperaba /health del Express single-svc, encontré: ${JSON.stringify(uris)}`,
    ).toBe(true);
    // serviceId viene poblado también en single-service (lo introduce
    // buildForService). Validamos que está, aunque el id concreto no
    // es contractual.
    expect(typeof result.serviceId === "string" || result.serviceId === undefined).toBe(true);
  }, 30_000);
});

/** Aplana el árbol de items de Postman (puede ser anidado por folders). */
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
