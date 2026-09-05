/**
 * Zero-config without a global `/api` when no framework declares it.
 *
 * Before a00012 S4, the default `baseUrl` was `http://localhost/api`
 * and `/api` was automatically appended to `APP_URL` when read from
 * the `.env`. An Express/Flask/Gin/FastAPI project without a global
 * prefix ended up with all its URIs as `http://localhost/api/<rest>`,
 * even though the actual router mounted the routes at `/<rest>`.
 *
 * This slice closes that bug by verifying, across four frameworks
 * without a global prefix and a Laravel with and without
 * `RouteServiceProvider`, that the generated collection does **not**
 * add `/api` when there is no evidence the prefix exists.
 *
 * The five documented sources that do contribute it:
 *   1. explicit route (routePrefix matched by a scanner);
 *   2. framework (Laravel/Express/... → router prefix);
 *   3. explicit config (`delendai.config.json#basePath`,
 *      `.expostmanrc.json#basePath`);
 *   4. OpenAPI `servers[]`;
 *   5. `POSTMAN_BASE_PATH` environment variable.
 *
 * For Express/Flask/Gin/FastAPI **without** explicit config, none of
 * the five is active, so the collection must come out without `/api`.
 * For Laravel without `RouteServiceProvider`, the `routes/*.php`
 * receive `["api"]` as a logical prefix (that part of the behavior
 * is preserved) —and therefore the `baseUrl` also carries it, because
 * that is the framework's documented convention. On the other hand,
 * a Laravel without any `routes/*.php` must come out without `/api`.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { generateCollection } from "../../packages/core/discovery/generation.pipeline";
import { defaultOrchestrator } from "../../packages/frameworks/framework.registry";
import {
  buildZeroConfig,
  loadProject,
} from "../../packages/core/discovery/project-loader.service";
import { resolveProjectContext } from "../../packages/core/discovery/project-context.service";
import { createTempProject, type ITempProject } from "../helpers/scanner-fixture";
import type { IProjectContext } from "../../packages/contracts/interfaces/core/project-context.interface";

let work = "";
let projects: ITempProject[] = [];

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "zero-config-no-api-"));
}, 30_000);

afterAll(async () => {
  for (const p of projects) await p.cleanup();
  if (work) await rm(work, { recursive: true, force: true });
});

/** Runs `fn` with the root fixed to a temporary project. */
async function inProject<T>(
  files: Record<string, string>,
  fn: (context: IProjectContext) => Promise<T>,
): Promise<T> {
  const project = await createTempProject(files, "zero-config-no-api-");
  projects.push(project);
  return fn(resolveProjectContext({ projectRoot: project.root }));
}

function generate(root: string) {
  return generateCollection(root, { orchestrator: defaultOrchestrator() });
}

describe("zero-config without global /api (a00012 S4)", () => {
  test("Express without basePath: the baseUrl does not carry /api", async () => {
    const result = await inProject(
      {
        "package.json": JSON.stringify({
          name: "express-no-api",
          dependencies: { express: "^4.19.0" },
        }),
        "server.js": `import express from "express";
const app = express();
app.get("/users", (_req, res) => res.json([]));
app.get("/users/:id", (_req, res) => res.json({}));
app.listen(3000);
`,
      },
      async (context) => {
        const config = await buildZeroConfig(context);
        expect(config.baseUrl).toBe("http://localhost");
        expect(config.baseUrl.endsWith("/api")).toBe(false);
        return config;
      },
    );
    expect(result.baseUrl).toBe("http://localhost");
  });

  test("Flask without basePath: the baseUrl does not carry /api", async () => {
    const result = await inProject(
      {
        "requirements.txt": "flask>=3.0\n",
        "app.py": `from flask import Flask, jsonify
app = Flask(__name__)
@app.get("/items")
def items():
    return jsonify([])
@app.get("/items/<int:item_id>")
def item(item_id: int):
    return jsonify({"id": item_id})
`,
      },
      async (context) => {
        const config = await buildZeroConfig(context);
        expect(config.baseUrl).toBe("http://localhost");
        expect(config.baseUrl.endsWith("/api")).toBe(false);
        return config;
      },
    );
    expect(result.baseUrl).toBe("http://localhost");
  });

  test("Gin without basePath: the baseUrl does not carry /api", async () => {
    const result = await inProject(
      {
        "go.mod": "module example.test/gin-no-api\n\ngo 1.22\n",
        "cmd/main.go": `package main
import "github.com/gin-gonic/gin"
func main() {
  r := gin.Default()
  r.GET("/widgets", func(c *gin.Context) { c.JSON(200, gin.H{}) })
  r.GET("/widgets/:id", func(c *gin.Context) { c.JSON(200, gin.H{}) })
  r.Run()
}
`,
      },
      async (context) => {
        const config = await buildZeroConfig(context);
        expect(config.baseUrl).toBe("http://localhost");
        expect(config.baseUrl.endsWith("/api")).toBe(false);
        return config;
      },
    );
    expect(result.baseUrl).toBe("http://localhost");
  });

  test("FastAPI without basePath: the baseUrl does not carry /api", async () => {
    const result = await inProject(
      {
        "requirements.txt": "fastapi>=0.110\nuvicorn>=0.27\n",
        "main.py": `from fastapi import FastAPI
app = FastAPI()
@app.get("/widgets")
def list_widgets():
    return []
@app.get("/widgets/{widget_id}")
def get_widget(widget_id: int):
    return {"id": widget_id}
`,
      },
      async (context) => {
        const config = await buildZeroConfig(context);
        expect(config.baseUrl).toBe("http://localhost");
        expect(config.baseUrl.endsWith("/api")).toBe(false);
        return config;
      },
    );
    expect(result.baseUrl).toBe("http://localhost");
  });

  test("Laravel without routes/*.php: the baseUrl does not carry /api", async () => {
    // The project "looks like" Laravel (composer.json + artisan) but
    // has NEITHER `routes/api.php` NOR `app/Providers/RouteServiceProvider.php`.
    // Previously we glued `/api` on just for having `.env`; now we don't.
    const result = await inProject(
      {
        "composer.json": JSON.stringify({
          name: "acme/laravel-vacio",
          require: { "laravel/framework": "^11.0" },
        }),
        ".env": "APP_NAME=Vacío\n",
      },
      async (context) => {
        const config = await buildZeroConfig(context);
        // Without routes/api.php nor RouteServiceProvider, filePrefixes is
        // empty, so no source contributes `/api`.
        expect(config.baseUrl).toBe("http://localhost");
        expect(config.baseUrl.endsWith("/api")).toBe(false);
        return config;
      },
    );
    expect(result.baseUrl).toBe("http://localhost");
  });

  test("Laravel with routes/api.php: the baseUrl carries /api by framework convention", async () => {
    // routes/api.php exists → `filePrefixes` receives `["api"]` by the
    // Laravel convention (detectFilePrefixes + the routes/*.php
    // fallback). That counts as source (2): the framework collected
    // the prefix and contributes it. The baseUrl, therefore, DOES
    // carry `/api`.
    const result = await inProject(
      {
        "composer.json": JSON.stringify({
          name: "acme/laravel-con-api",
          require: { "laravel/framework": "^11.0" },
        }),
        "routes/api.php": "<?php\n// routes vacías\n",
      },
      async (context) => {
        const config = await buildZeroConfig(context);
        expect(config.baseUrl.endsWith("/api")).toBe(true);
        return config;
      },
    );
    expect(result.baseUrl.endsWith("/api")).toBe(true);
  });

  test("POSTMAN_BASE_PATH contributes the suffix even without a framework", async () => {
    // Source (5): the environment variable is explicit and is
    // respected. Previously the default was `/api` by magic; now the
    // user declares it and the loader glues it to the origin.
    const previous = process.env.POSTMAN_BASE_PATH;
    process.env.POSTMAN_BASE_PATH = "/v3";
    try {
      const result = await inProject(
        {
          "package.json": JSON.stringify({
            name: "express-con-env",
            dependencies: { express: "^4.19.0" },
          }),
          "server.js": "import express from 'express';\n",
        },
        async (context) => {
          const config = await buildZeroConfig(context);
          expect(config.baseUrl).toBe("http://localhost/v3");
          return config;
        },
      );
      expect(result.baseUrl).toBe("http://localhost/v3");
    } finally {
      if (previous === undefined) delete process.env.POSTMAN_BASE_PATH;
      else process.env.POSTMAN_BASE_PATH = previous;
    }
  });

  test("loadProject (zero-config) in Express: the config exposes baseUrl = 'http://localhost'", async () => {
    // Focal test of the full flow: loadProject is the entry used by
    // the pipeline and the commands. Verifies that the config reaching
    // the builder does not carry `/api` for an Express project.
    await inProject(
      {
        "package.json": JSON.stringify({
          name: "express-zero-config",
          dependencies: { express: "^4.19.0" },
        }),
        "server.js": `import express from "express";
const app = express();
app.get("/ping", (_req, res) => res.json({ ok: true }));
`,
      },
      async (context) => {
        const loaded = await loadProject([], context);
        expect(loaded.zeroConfig).toBe(true);
        expect(loaded.config.baseUrl).toBe("http://localhost");
        expect(loaded.config.baseUrl.endsWith("/api")).toBe(false);
      },
    );
  });

  test("Generated Express: the effective baseUrl does not contain /api", async () => {
    // Verifies the full path: the pipeline generates a collection for
    // an Express project and the config's baseUrl does not carry
    // /api. (The request URIs are decided by the scanner; this test
    //  asserts the SUFFIX of the baseUrl, which is the piece the bug
    //  soiled.)
    const project = await createTempProject(
      {
        "package.json": JSON.stringify({
          name: "express-completo",
          dependencies: { express: "^4.19.0" },
        }),
        "server.js": `import express from "express";
const app = express();
app.get("/widgets", (_req, res) => res.json([]));
app.get("/widgets/:id", (_req, res) => res.json({}));
app.listen(3000);
`,
      },
      "express-completo-",
    );
    projects.push(project);

    const result = await generate(project.root);
    expect(result.config.baseUrl).toBe("http://localhost");
    expect(result.config.baseUrl.endsWith("/api")).toBe(false);
  });
});