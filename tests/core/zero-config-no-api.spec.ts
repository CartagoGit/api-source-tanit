/**
 * Zero-config sin `/api` global cuando ningún framework lo declara.
 *
 * Antes del a00012 S4, la `baseUrl` por defecto era `http://localhost/api`
 * y se pegaba `/api` automáticamente al `APP_URL` cuando se leía del
 * `.env`. Un proyecto Express/Flask/Gin/FastAPI sin prefijo global
 * terminaba con todas sus URIs como `http://localhost/api/<resto>`,
 * aunque el router real montase las rutas en `/<resto>`.
 *
 * Esta slice cierra ese bug verificando, en cuatro frameworks sin
 * prefijo global y un Laravel con y sin `RouteServiceProvider`, que la
 * colección generada **no** añade `/api` cuando no hay evidencia de
 * que el prefijo exista.
 *
 * Las cinco fuentes documentadas que sí lo aportan:
 *   1. ruta explícita (routePrefix matcheado por un scanner);
 *   2. framework (Laravel/Express/... → prefix del router);
 *   3. config explícito (`delendai.config.json#basePath`,
 *      `.expostmanrc.json#basePath`);
 *   4. OpenAPI `servers[]`;
 *   5. variable de entorno `POSTMAN_BASE_PATH`.
 *
 * Para Express/Flask/Gin/FastAPI **sin** config explícito, ninguna de
 * las cinco está activa, así que la colección debe salir sin `/api`.
 * Para Laravel sin `RouteServiceProvider`, los `routes/*.php` reciben
 * `["api"]` como prefijo lógico (esa parte del comportamiento se
 * mantiene) —y por tanto el `baseUrl` también lo lleva, porque esa es
 * la convención documentada del framework. En cambio, un Laravel sin
 * ningún `routes/*.php` debe salir sin `/api`.
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

/** Ejecuta `fn` con la raíz fijada a un proyecto temporal. */
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

describe("zero-config sin /api global (a00012 S4)", () => {
  test("Express sin basePath: la baseUrl no lleva /api", async () => {
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

  test("Flask sin basePath: la baseUrl no lleva /api", async () => {
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

  test("Gin sin basePath: la baseUrl no lleva /api", async () => {
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

  test("FastAPI sin basePath: la baseUrl no lleva /api", async () => {
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

  test("Laravel sin routes/*.php: la baseUrl no lleva /api", async () => {
    // El proyecto se "parece" a Laravel (composer.json + artisan) pero
    // NO tiene ni `routes/api.php` ni `app/Providers/RouteServiceProvider.php`.
    // Antes le pegábamos `/api` solo por tener el `.env`; ahora no.
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
        // Sin routes/api.php ni RouteServiceProvider, filePrefixes está
        // vacío, así que no hay fuente que aporte `/api`.
        expect(config.baseUrl).toBe("http://localhost");
        expect(config.baseUrl.endsWith("/api")).toBe(false);
        return config;
      },
    );
    expect(result.baseUrl).toBe("http://localhost");
  });

  test("Laravel con routes/api.php: la baseUrl lleva /api por convención del framework", async () => {
    // routes/api.php existe → `filePrefixes` recibe `["api"]` por la
    // convención de Laravel (detectFilePrefixes + el fallback de
    // routes/*.php). Eso cuenta como fuente (2): el framework recogió
    // el prefijo y lo aporta. La baseUrl, por tanto, SÍ lleva `/api`.
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

  test("POSTMAN_BASE_PATH aporta el sufijo aunque no haya framework", async () => {
    // Fuente (5): la variable de entorno es explícita y se respeta.
    // Antes el default era `/api` por arte de magia; ahora el usuario
    // lo declara y el loader lo pega al origen.
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

  test("loadProject (zero-config) en Express: el config expone baseUrl = 'http://localhost'", async () => {
    // Test focal del flujo completo: loadProject es la entrada que
    // usan el pipeline y los comandos. Verifica que el config que
    // llega al builder no lleva `/api` para un proyecto Express.
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

  test("Express generado: la baseUrl efectiva no contiene /api", async () => {
    // Verifica el camino completo: el pipeline genera una colección
    // para un proyecto Express y el baseUrl del config no lleva /api.
    // (Las URIs de las requests las decide el scanner; este test
    //  asegura el SUFIJO de la baseUrl, que es la pieza que el bug
    //  ensuciaba.)
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