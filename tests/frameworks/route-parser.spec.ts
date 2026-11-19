import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { parseAllRoutes, parseRoutesFile, stripComments } from "../../packages/frameworks/laravel/route-parser.service";
import { prettyGroupName, topGroupFor } from "../../packages/core/helpers/uri.helper";
import { resolveProjectContext } from "../../packages/core/discovery/project-context.service";
import type { IProjectContext } from "../../packages/contracts/interfaces/core/project-context.interface";
import { createTempProject, type ITempProject } from "../helpers/scanner-fixture";

describe("route-parser.service (pure helpers)", () => {
  describe("stripComments", () => {
    test("strips block comments /* ... */", () => {
      const src = `Route::get('/a', [Foo::class,'a']);
/* Route::get('/b', [Foo::class,'b']); */
Route::get('/c', [Foo::class,'c']);`;
      const stripped = stripComments(src);
      expect(stripped).not.toContain("/b");
      expect(stripped).toContain("/a");
      expect(stripped).toContain("/c");
    });

    test("strips line comments //", () => {
      const src = `Route::get('/a', [Foo::class,'a']);
// Route::get('/b', [Foo::class,'b']);
Route::get('/c', [Foo::class,'c']);`;
      const stripped = stripComments(src);
      expect(stripped).not.toContain("/b");
    });

    test("preserves // when preceded by : (URL like http://)", () => {
      const src = `$url = 'http://example.com/api';`;
      const stripped = stripComments(src);
      expect(stripped).toContain("http://example.com/api");
    });
  });

  describe("topGroupFor", () => {
    test("returns the first segment when the URI starts with api/", () => {
      expect(topGroupFor("api/clientes")).toBe("clientes");
    });

    test("returns the first segment when the URI starts with /api/", () => {
      expect(topGroupFor("/api/clientes")).toBe("clientes");
    });

    test("ignores deeper sub-segments", () => {
      expect(topGroupFor("api/users/123")).toBe("users");
      expect(topGroupFor("api/pedidos/historial")).toBe("pedidos");
    });

    test("respects the prefix → group override", () => {
      expect(topGroupFor("api/tol/tecdoc", { "tol/tecdoc": "tol/tecdoc" })).toBe(
        "tol/tecdoc",
      );
    });

    test("empty URI → (root)", () => {
      expect(topGroupFor("")).toBe("(root)");
    });

    test("URI that is not an api → first segment", () => {
      expect(topGroupFor("alive")).toBe("alive");
    });
  });

  describe("prettyGroupName", () => {
    test("capitalizes", () => {
      expect(prettyGroupName("pedidos")).toBe("Pedidos");
    });

    test("replaces - and _ with a space", () => {
      expect(prettyGroupName("usuarios-activos")).toBe("Usuarios Activos");
      expect(prettyGroupName("mi_api")).toBe("Mi Api");
    });

    test("preserves / as separator", () => {
      expect(prettyGroupName("tol/tecdoc")).toBe("Tol/Tecdoc");
    });

    test("(root) → Root", () => {
      expect(prettyGroupName("(root)")).toBe("Root");
    });

    test("empty string → Root", () => {
      expect(prettyGroupName("")).toBe("Root");
    });
  });
});

// ---------------------------------------------------------------------------
// Parsing real route files against a temporary project on disk
// ---------------------------------------------------------------------------

const RUTAS_PHP = `<?php

use Illuminate\\Support\\Facades\\Route;
use App\\Http\\Controllers\\PedidoController;
use App\\Http\\Controllers\\FacturaController as Facturas;

// Commented route: must not be counted.
// Route::get('comentada', fn () => 1);
/* Route::get('bloque', fn () => 1); */

Route::prefix('v1')->group(function () {
    Route::prefix('admin')->group(function () {
        Route::get('pedidos', [PedidoController::class, 'index']);
    });
    Route::get('', [PedidoController::class, 'index']);
});

Route::get('facturas',
    [Facturas::class, 'listado']);

Route::get('salud', fn () => 1);
// Controller without use: it is resolved by the namespace convention.
Route::post('libros', [LibroController::class, 'crear']);
`;

describe("route-parser.service — parseRoutesFile sobre disco", () => {
  let project: ITempProject;
  let contexto: IProjectContext;

  beforeAll(async () => {
    project = await createTempProject({
      "routes/api.php": RUTAS_PHP,
      "routes/erp.php": "<?php\nRoute::get('cosas', fn () => 1);\n",
      "routes/notas.txt": "no es php: se ignora.",
    });
    contexto = resolveProjectContext({ projectRoot: project.root });
  });

  afterAll(async () => {
    await project.cleanup();
  });

  test("resolves routes with their default prefix", async () => {
    const rutas = await parseRoutesFile("routes/api.php", ["api"], contexto);
    const uris = rutas.map((r) => r.uri);
    expect(uris).toContain("api/v1/admin/pedidos");
    expect(uris).toContain("api/v1");
    expect(uris).toContain("api/facturas");
    expect(uris).toContain("api/salud");
    // Commented ones disappear (stripComments runs before parsing).
    expect(uris.some((u) => u.includes("comentada"))).toBe(false);
    expect(uris.some((u) => u.includes("bloque"))).toBe(false);
  });

  test("the prefix stack chains and pops when the group closes", async () => {
    const rutas = await parseRoutesFile("routes/api.php", ["api"], contexto);
    const pedidos = rutas.find((r) => r.rawUri === "pedidos");
    expect(pedidos?.prefixChain).toEqual(["api", "v1", "admin"]);
    // Anything declared after the groups close no longer inherits
    // the prefixes.
    const salud = rutas.find((r) => r.rawUri === "salud");
    expect(salud?.prefixChain).toEqual(["api"]);
    expect(salud?.uri).toBe("api/salud");
  });

  test("an empty URI inside a prefix inherits only the prefix chain", async () => {
    const rutas = await parseRoutesFile("routes/api.php", ["api"], contexto);
    const raiz = rutas.find((r) => r.uri === "api/v1");
    expect(raiz?.rawUri).toBe("");
    expect(raiz?.controllerClass).toBe("App\\Http\\Controllers\\PedidoController");
    expect(raiz?.actionName).toBe("index");
  });

  test("resolves imports with and without alias", async () => {
    const rutas = await parseRoutesFile("routes/api.php", ["api"], contexto);
    const factura = rutas.find((r) => r.rawUri === "facturas");
    expect(factura?.controllerClass).toBe("App\\Http\\Controllers\\FacturaController");
    expect(factura?.actionName).toBe("listado");
    const pedido = rutas.find((r) => r.rawUri === "pedidos");
    expect(pedido?.controllerClass).toBe("App\\Http\\Controllers\\PedidoController");
  });

  test("the controller array can split across the next line", async () => {
    // `facturas` declares the uri on one line and the
    // [Controller, 'action'] on the next: the two-line window must
    // capture it.
    const rutas = await parseRoutesFile("routes/api.php", ["api"], contexto);
    const factura = rutas.find((r) => r.rawUri === "facturas");
    expect(factura?.actionName).toBe("listado");
  });

  test("a closure contributes neither controller nor action", async () => {
    const rutas = await parseRoutesFile("routes/api.php", ["api"], contexto);
    const salud = rutas.find((r) => r.rawUri === "salud");
    expect(salud?.controllerClass).toBeUndefined();
    expect(salud?.actionName).toBeUndefined();
    expect(salud?.sourceFile).toBe("routes/api.php");
    expect(salud?.lineNumber).toBeGreaterThan(0);
  });

  test("a controller without import is assumed under App\\Http\\Controllers", async () => {
    const rutas = await parseRoutesFile("routes/api.php", ["api"], contexto);
    const libro = rutas.find((r) => r.rawUri === "libros");
    expect(libro?.controllerClass).toBe("App\\Http\\Controllers\\LibroController");
    expect(libro?.actionName).toBe("crear");
  });

});

describe("route-parser.service — parseAllRoutes", () => {
  let project: ITempProject;
  let contexto: IProjectContext;

  beforeAll(async () => {
    project = await createTempProject({
      "routes/api.php": "<?php\nRoute::get('salud', fn () => 1);\n",
      "routes/erp.php": "<?php\nRoute::get('cosas', fn () => 1);\n",
      "routes/notas.txt": "no es php: se ignora.",
    });
    contexto = resolveProjectContext({ projectRoot: project.root });
  });

  afterAll(async () => {
    await project.cleanup();
  });

  test("assumes the api prefix for unlisted files", async () => {
    const rutas = await parseAllRoutes({}, contexto);
    expect(rutas.map((r) => r.uri).sort()).toEqual(["api/cosas", "api/salud"]);
  });

  test("filePrefixes replaces the default prefix per file", async () => {
    const rutas = await parseAllRoutes(
      { "routes/api.php": [], "routes/erp.php": ["api", "erp"] },
      contexto,
    );
    const salud = rutas.find((r) => r.rawUri === "salud");
    const cosas = rutas.find((r) => r.rawUri === "cosas");
    expect(salud?.uri).toBe("salud");
    expect(cosas?.uri).toBe("api/erp/cosas");
    expect(cosas?.prefixChain).toEqual(["api", "erp"]);
  });

  test("ignores files that are not .php", async () => {
    const rutas = await parseAllRoutes({}, contexto);
    expect(rutas.some((r) => r.sourceFile === "routes/notas.txt")).toBe(false);
  });

  test("without a routes folder returns an empty list", async () => {
    const tmp = await createTempProject({ "composer.json": "{}" });
    try {
      const ctxLocal = resolveProjectContext({ projectRoot: tmp.root });
      expect(await parseAllRoutes({}, ctxLocal)).toEqual([]);
    } finally {
      await tmp.cleanup();
    }
  });
});
