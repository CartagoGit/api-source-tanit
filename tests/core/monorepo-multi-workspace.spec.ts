/**
 * Detección expandida en monorepos multi-workspace — audit 2026-09-04 P1 #1.
 *
 * Antes, `discoverSpecs()` corría `detectAll(projectRoot)` **una sola
 * vez** contra la raíz. En un monorepo con varios workspaces
 * materializados (`apps/api`, `apps/web`, `packages/auth`),
 * `frameworkSearchRoot` quedaba en `null` (porque hay varios) y los
 * scanners miraban la raíz del repo, no el workspace donde vive cada
 * framework.
 *
 * Resultado: NestJS en `apps/api` no se detectaba, porque su
 * `package.json` está en `apps/api`, no en la raíz. La colección salía
 * vacía sin aviso.
 *
 * El fix (`expandMonorepoDetection` en `generation.pipeline.ts`)
 * mantiene la detección raíz para casos simples, y **expande** la
 * detección contra cada workspace cuando hay ≥2 y no hay override.
 *
 * Este test verifica:
 *   1. Un monorepo `apps/api` (Nest) + `apps/web` (Express) genera
 *      specs de ambos, cada uno con su `frameworkSearchRoot` correcto.
 *   2. El comportamiento monorepo single-workspace no cambia: la
 *      detección ampliada no se dispara (la auto-fill del helper
 *      basta).
 *   3. El override `--framework-search-root` sigue siendo autoritativo:
 *      con override, NO se expande.
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

describe("monorepo multi-workspace: detección expandida (audit P1 #1)", () => {
  test("NestJS en apps/api + Express en apps/web → detecta ambos", async () => {
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
    });

    // La verificación fuerte: ambos frameworks están en `result.collection`
    // con al menos un endpoint cada uno. Sin la expansión, los endpoints
    // de NestJS no aparecerían porque la raíz del monorepo no tiene
    // `src/app.controller.ts` ni `@nestjs/core` en su package.json raíz.
    const items = flattenItems(result.collection.item ?? []);
    const uris = items.map((i) => i.request?.url?.raw ?? "");

    expect(
      uris.some((u) => u.includes("/widgets")),
      `Esperaba al menos un endpoint /widgets de NestJS, encontré: ${JSON.stringify(uris)}`,
    ).toBe(true);
    expect(
      uris.some((u) => u.includes("/pages")),
      `Esperaba al menos un endpoint /pages de Express, encontré: ${JSON.stringify(uris)}`,
    ).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(2);
  }, 30_000);

  test("monorepo con un único workspace: comportamiento legacy (sin expansión)", async () => {
    // Si solo hay UN workspace materializado, el camino legacy (auto-fill
    // de frameworkSearchRoot por monorepo-detector) sigue siendo válido.
    // `expandMonorepoDetection` no debe duplicar ni romper nada.
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
    // La advertencia del monorepo single-workspace sí debe estar.
    expect(
      result.warnings.some((w) =>
        w.includes("Monorepo detectado") && w.includes("apps/api"),
      ),
    ).toBe(true);
  }, 30_000);

  test("override --framework-search-root sigue siendo autoritativo (no se expande)", async () => {
    // Si el usuario pasa `frameworkSearchRoot` explícito, la detección
    // ampliada no debe dispararse. Solo se escanea el workspace que el
    // usuario pidió, sin inventar candidatos adicionales.
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
    // Override a apps/api → solo Nest. /beta (Express) NO debe aparecer.
    expect(uris.some((u) => u.includes("/alpha"))).toBe(true);
    expect(uris.some((u) => u.includes("/beta"))).toBe(false);
  }, 30_000);
});

/** Aplana el árbol de items de Postman (puede ser anidado por folders). */
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
