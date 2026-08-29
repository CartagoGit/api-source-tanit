import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { parseAllRoutes, parseRoutesFile, stripComments } from "../../projects/frameworks/laravel/route-parser.service";
import { prettyGroupName, topGroupFor } from "../../projects/core/helpers/uri.helper";
import { resolveProjectContext } from "../../projects/core/discovery/project-context.service";
import { withProjectRoot } from "../../projects/core/discovery/paths.service";
import type { IProjectContext } from "../../projects/contracts/interfaces/core/project-context.interface";
import { createTempProject, type ITempProject } from "../helpers/scanner-fixture";

describe("route-parser.service (pure helpers)", () => {
  describe("stripComments", () => {
    test("elimina comentarios de bloque /* ... */", () => {
      const src = `Route::get('/a', [Foo::class,'a']);
/* Route::get('/b', [Foo::class,'b']); */
Route::get('/c', [Foo::class,'c']);`;
      const stripped = stripComments(src);
      expect(stripped).not.toContain("/b");
      expect(stripped).toContain("/a");
      expect(stripped).toContain("/c");
    });

    test("elimina comentarios de línea //", () => {
      const src = `Route::get('/a', [Foo::class,'a']);
// Route::get('/b', [Foo::class,'b']);
Route::get('/c', [Foo::class,'c']);`;
      const stripped = stripComments(src);
      expect(stripped).not.toContain("/b");
    });

    test("preserva // cuando va precedido de : (URL tipo http://)", () => {
      const src = `$url = 'http://example.com/api';`;
      const stripped = stripComments(src);
      expect(stripped).toContain("http://example.com/api");
    });
  });

  describe("topGroupFor", () => {
    test("devuelve el primer segmento cuando la URI empieza por api/", () => {
      expect(topGroupFor("api/clientes")).toBe("clientes");
    });

    test("devuelve el primer segmento cuando la URI empieza por /api/", () => {
      expect(topGroupFor("/api/clientes")).toBe("clientes");
    });

    test("ignora sub-segmentos más profundos", () => {
      expect(topGroupFor("api/users/123")).toBe("users");
      expect(topGroupFor("api/pedidos/historial")).toBe("pedidos");
    });

    test("respeta el override prefijo → grupo", () => {
      expect(topGroupFor("api/tol/tecdoc", { "tol/tecdoc": "tol/tecdoc" })).toBe(
        "tol/tecdoc",
      );
    });

    test("URI vacía → (raíz)", () => {
      expect(topGroupFor("")).toBe("(raíz)");
    });

    test("URI que no es api → primer segmento", () => {
      expect(topGroupFor("alive")).toBe("alive");
    });
  });

  describe("prettyGroupName", () => {
    test("capitaliza", () => {
      expect(prettyGroupName("pedidos")).toBe("Pedidos");
    });

    test("sustituye - y _ por espacio", () => {
      expect(prettyGroupName("usuarios-activos")).toBe("Usuarios Activos");
      expect(prettyGroupName("mi_api")).toBe("Mi Api");
    });

    test("preserva / como separador", () => {
      expect(prettyGroupName("tol/tecdoc")).toBe("Tol/Tecdoc");
    });

    test("(raíz) → Raíz", () => {
      expect(prettyGroupName("(raíz)")).toBe("Raíz");
    });

    test("string vacío → Raíz", () => {
      expect(prettyGroupName("")).toBe("Raíz");
    });
  });
});

// ---------------------------------------------------------------------------
// Parsing de archivos de rutas reales sobre un proyecto temporal en disco
// ---------------------------------------------------------------------------

const RUTAS_PHP = `<?php

use Illuminate\\Support\\Facades\\Route;
use App\\Http\\Controllers\\PedidoController;
use App\\Http\\Controllers\\FacturaController as Facturas;

// Ruta comentada: no debe contarse.
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
// Controlador sin use: se resuelve por la convención de namespace.
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

  test("resuelve las rutas con su prefijo por defecto", async () => {
    const rutas = await parseRoutesFile("routes/api.php", ["api"], contexto);
    const uris = rutas.map((r) => r.uri);
    expect(uris).toContain("api/v1/admin/pedidos");
    expect(uris).toContain("api/v1");
    expect(uris).toContain("api/facturas");
    expect(uris).toContain("api/salud");
    // Las comentadas desaparecen (stripComments antes de parsear).
    expect(uris.some((u) => u.includes("comentada"))).toBe(false);
    expect(uris.some((u) => u.includes("bloque"))).toBe(false);
  });

  test("la pila de prefijos encadena y se desapila al cerrar el grupo", async () => {
    const rutas = await parseRoutesFile("routes/api.php", ["api"], contexto);
    const pedidos = rutas.find((r) => r.rawUri === "pedidos");
    expect(pedidos?.prefixChain).toEqual(["api", "v1", "admin"]);
    // Lo declarado tras cerrar los grupos ya no hereda los prefijos.
    const salud = rutas.find((r) => r.rawUri === "salud");
    expect(salud?.prefixChain).toEqual(["api"]);
    expect(salud?.uri).toBe("api/salud");
  });

  test("una uri vacía dentro de un prefijo hereda solo la cadena de prefijos", async () => {
    const rutas = await parseRoutesFile("routes/api.php", ["api"], contexto);
    const raiz = rutas.find((r) => r.uri === "api/v1");
    expect(raiz?.rawUri).toBe("");
    expect(raiz?.controllerClass).toBe("App\\Http\\Controllers\\PedidoController");
    expect(raiz?.actionName).toBe("index");
  });

  test("resuelve imports con alias y sin alias", async () => {
    const rutas = await parseRoutesFile("routes/api.php", ["api"], contexto);
    const factura = rutas.find((r) => r.rawUri === "facturas");
    expect(factura?.controllerClass).toBe("App\\Http\\Controllers\\FacturaController");
    expect(factura?.actionName).toBe("listado");
    const pedido = rutas.find((r) => r.rawUri === "pedidos");
    expect(pedido?.controllerClass).toBe("App\\Http\\Controllers\\PedidoController");
  });

  test("el array del controlador puede partir en la línea siguiente", async () => {
    // `facturas` declara la uri en una línea y el [Controller, 'accion']
    // en la siguiente: la ventana de dos líneas debe capturarlo.
    const rutas = await parseRoutesFile("routes/api.php", ["api"], contexto);
    const factura = rutas.find((r) => r.rawUri === "facturas");
    expect(factura?.actionName).toBe("listado");
  });

  test("una closure no aporta ni controlador ni acción", async () => {
    const rutas = await parseRoutesFile("routes/api.php", ["api"], contexto);
    const salud = rutas.find((r) => r.rawUri === "salud");
    expect(salud?.controllerClass).toBeUndefined();
    expect(salud?.actionName).toBeUndefined();
    expect(salud?.sourceFile).toBe("routes/api.php");
    expect(salud?.lineNumber).toBeGreaterThan(0);
  });

  test("un controlador sin import se asume en App\\Http\\Controllers", async () => {
    const rutas = await parseRoutesFile("routes/api.php", ["api"], contexto);
    const libro = rutas.find((r) => r.rawUri === "libros");
    expect(libro?.controllerClass).toBe("App\\Http\\Controllers\\LibroController");
    expect(libro?.actionName).toBe("crear");
  });

  test("sin context se apoya en el singleton de paths.service", () =>
    withProjectRoot(project.root, async () => {
      const rutas = await parseRoutesFile("routes/api.php", ["api"]);
      expect(rutas.some((r) => r.rawUri === "salud")).toBe(true);
    }));
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

  test("asume el prefijo api para los archivos no listados", async () => {
    const rutas = await parseAllRoutes({}, contexto);
    expect(rutas.map((r) => r.uri).sort()).toEqual(["api/cosas", "api/salud"]);
  });

  test("filePrefixes reemplaza el prefijo por defecto por archivo", async () => {
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

  test("ignora los ficheros que no son .php", async () => {
    const rutas = await parseAllRoutes({}, contexto);
    expect(rutas.some((r) => r.sourceFile === "routes/notas.txt")).toBe(false);
  });

  test("sin context tira del singleton de paths.service", () =>
    withProjectRoot(project.root, async () => {
      const rutas = await parseAllRoutes({});
      expect(rutas.length).toBeGreaterThan(0);
    }));

  test("sin carpeta routes devuelve una lista vacía", async () => {
    const tmp = await createTempProject({ "composer.json": "{}" });
    try {
      const ctxLocal = resolveProjectContext({ projectRoot: tmp.root });
      expect(await parseAllRoutes({}, ctxLocal)).toEqual([]);
    } finally {
      await tmp.cleanup();
    }
  });
});
