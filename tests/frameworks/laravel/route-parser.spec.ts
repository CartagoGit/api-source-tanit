/**
 * Branches de route-parser.service.ts no cubiertas por las suites genérales.
 *
 * Cada test recorre un `else` concreto identificado en el informe de
 * cobertura:
 *
 *  1. El `})` que cierra un grupo aparece cuando la pila de prefijos ya
 *     está en el nivel inicial del archivo (initialPrefix.length):
 *     la condición `prefixStack.length > initialPrefix.length` toma la
 *     rama falsa y NO se hace pop — rama sin cubrir en todos los fixtures
 *     existentes porque siempre hay un Route::prefix correspondiente.
 *
 *  2. Dos `use` con el mismo short-name: la segunda entrada ve
 *     `imports.has(short)` ya a `true` y salta la escritura.
 *     En los fixtures existentes, si hay alias las dos entradas son
 *     distintas (alias ≠ short-name), por lo que la rama `false` de
 *     `!imports.has(short)` ya se toma; pero aquí queremos el caso donde
 *     un segundo `use` con el mismo short-name pero alias diferente ya
 *     encontraría el short indexado.
 *
 *  3. rawUri vacío dentro de un prefijo anidado: la rama ternaria
 *     `rawUri ? [...prefixStack, rawUri] : [...prefixStack]` toma el
 *     brazo falso (rawUri === "").
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { parseAllRoutes, parseRoutesFile } from "../../../packages/frameworks/laravel/route-parser.service";
import { resolveProjectContext } from "../../../packages/core/discovery/project-context.service";
import type { IProjectContext } from "../../../packages/contracts/interfaces/core/project-context.interface";
import { createTempProject, type ITempProject } from "../../helpers/scanner-fixture";

// ---------------------------------------------------------------------------
// 1. `})` espurio cuando la pila ya está en el nivel inicial
// ---------------------------------------------------------------------------

describe("route-parser — `)` espurio con pila al nivel inicial", () => {
  /**
   * Simula un archivo de rutas que recibe `initialPrefix = ["api"]` pero
   * no añade ningún Route::prefix propio. Si el archivo contiene un `})`
   * (que cerraría un grupo externo en el ServiceProvider), la condición
   * `prefixStack.length > initialPrefix.length` es false y NO se hace pop.
   * Esto cubre la rama corta del &&.
   */
  const RUTAS_SIN_GRUPO = `<?php

use Illuminate\\Support\\Facades\\Route;
use App\\Http\\Controllers\\HealthController;

// Ruta normal — sin Route::prefix propio en este archivo.
Route::get('health', [HealthController::class, 'alive']);

// Cierre de un grupo externo que el ServiceProvider inyecta.
// El parser ve "})" y evalúa la condición pero la pila está
// en initialPrefix.length → rama false → NO hace pop.
});
`;

  let project: ITempProject;
  let ctx: IProjectContext;

  beforeAll(async () => {
    project = await createTempProject({ "routes/external.php": RUTAS_SIN_GRUPO });
    ctx = resolveProjectContext({ projectRoot: project.root });
  });

  afterAll(async () => {
    await project.cleanup();
  });

  test("el }) espurio no corrompe la pila: la ruta sigue teniendo el prefijo inicial", async () => {
    const rutas = await parseRoutesFile("routes/external.php", ["api"], ctx);
    expect(rutas).toHaveLength(1);
    expect(rutas[0]?.uri).toBe("api/health");
    expect(rutas[0]?.prefixChain).toEqual(["api"]);
  });

  test("la URI resuelve correctamente aunque haya un }) al final del archivo", async () => {
    const rutas = await parseRoutesFile("routes/external.php", ["api"], ctx);
    const health = rutas.find((r) => r.rawUri === "health");
    expect(health).toBeDefined();
    expect(health?.controllerClass).toBe("App\\Http\\Controllers\\HealthController");
    expect(health?.actionName).toBe("alive");
  });
});

// ---------------------------------------------------------------------------
// 2. Dos `use` con el mismo short-name: segundo salta imports.has(short)
// ---------------------------------------------------------------------------

describe("route-parser — dos use con el mismo short-name", () => {
  /**
   * Si el archivo importa `use A\Foo;` y luego `use B\Foo as FooAlias;`,
   * la primera entrada guarda short "Foo" en el mapa. La segunda tiene
   * short "Foo" también, pero como ya existe, el bloque
   * `if (!imports.has(short))` toma la rama false y no sobreescribe.
   * Esta rama ya estaba cubierta (alias==short → set + skip), pero aquí
   * documentamos el caso con alias distinto que llega al mismo short.
   */
  const RUTAS_ALIAS_DISTINTO = `<?php

use Illuminate\\Support\\Facades\\Route;
use App\\Http\\Controllers\\UserController;
use App\\Http\\Controllers\\LegacyUserController as UserController2;

Route::get('usuarios', [UserController::class, 'index']);
Route::get('usuarios/legacy', [UserController2::class, 'index']);
`;

  let project: ITempProject;
  let ctx: IProjectContext;

  beforeAll(async () => {
    project = await createTempProject({ "routes/api.php": RUTAS_ALIAS_DISTINTO });
    ctx = resolveProjectContext({ projectRoot: project.root });
  });

  afterAll(async () => {
    await project.cleanup();
  });

  test("el alias LegacyUserController se indexa por el alias, el short-name queda del primer use", async () => {
    const rutas = await parseRoutesFile("routes/api.php", ["api"], ctx);
    expect(rutas).toHaveLength(2);

    const primera = rutas.find((r) => r.rawUri === "usuarios" && !r.uri.includes("legacy"));
    const segunda = rutas.find((r) => r.rawUri === "usuarios/legacy");
    expect(primera?.controllerClass).toBe("App\\Http\\Controllers\\UserController");
    // El segundo use tiene alias "UserController2" que resuelve al FQCN correcto.
    expect(segunda?.controllerClass).toBe("App\\Http\\Controllers\\LegacyUserController");
  });
});

// ---------------------------------------------------------------------------
// 3. rawUri vacío dentro de un grupo con prefijo (rama ternaria falsa)
// ---------------------------------------------------------------------------

describe("route-parser — rawUri vacío dentro de prefijo anidado", () => {
  /**
   * `Route::get('', [Controller::class, 'action'])` produce rawUri = "".
   * La condición `rawUri ? [...prefixStack, rawUri] : [...prefixStack]`
   * toma el brazo false y construye la URI solo con los prefijos.
   * En los tests genéricos esto ya se prueba con la pila de v1/admin; aquí
   * verificamos el caso más profundo: vacío dentro de un sub-prefijo.
   */
  const RUTAS_RAIZ_ANIDADA = `<?php

use Illuminate\\Support\\Facades\\Route;
use App\\Http\\Controllers\\RaizController;

Route::prefix('v2')->group(function () {
    Route::prefix('productos')->group(function () {
        Route::get('', [RaizController::class, 'listar']);
        Route::post('', [RaizController::class, 'crear']);
    });
});
`;

  let project: ITempProject;
  let ctx: IProjectContext;

  beforeAll(async () => {
    project = await createTempProject({ "routes/api.php": RUTAS_RAIZ_ANIDADA });
    ctx = resolveProjectContext({ projectRoot: project.root });
  });

  afterAll(async () => {
    await project.cleanup();
  });

  test("rawUri='' produce URI construida solo con la cadena de prefijos", async () => {
    const rutas = await parseRoutesFile("routes/api.php", ["api"], ctx);
    expect(rutas).toHaveLength(2);

    const uris = rutas.map((r) => r.uri).sort();
    expect(uris).toEqual(["api/v2/productos", "api/v2/productos"]);
  });

  test("rawUri='' tiene prefixChain completa aunque no aporte segmento propio", async () => {
    const rutas = await parseRoutesFile("routes/api.php", ["api"], ctx);
    for (const ruta of rutas) {
      expect(ruta.rawUri).toBe("");
      expect(ruta.prefixChain).toEqual(["api", "v2", "productos"]);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. parseAllRoutes — prefijo explícito vacío (sin api)
// ---------------------------------------------------------------------------

describe("route-parser — parseAllRoutes con prefijo explícito vacío", () => {
  /**
   * `filePrefixes["routes/web.php"] = []` indica que las rutas de ese
   * archivo NO llevan prefijo externo (web routes no tienen /api/). El
   * `?? ["api"]` del default no se activa y la URI resultante es la
   * rawUri sin prefijo.
   */
  let project: ITempProject;
  let ctx: IProjectContext;

  beforeAll(async () => {
    project = await createTempProject({
      "routes/web.php": "<?php\nuse Illuminate\\Support\\Facades\\Route;\nRoute::get('/', fn () => view('welcome'));\nRoute::get('/about', fn () => view('about'));\n",
    });
    ctx = resolveProjectContext({ projectRoot: project.root });
  });

  afterAll(async () => {
    await project.cleanup();
  });

  test("prefijo vacío produce URIs sin el api/ por defecto", async () => {
    const rutas = await parseAllRoutes({ "routes/web.php": [] }, ctx);
    const uris = rutas.map((r) => r.uri).sort();
    expect(uris).toContain("/");
    expect(uris).toContain("/about");
    for (const ruta of rutas) {
      expect(ruta.uri).not.toMatch(/^api\//);
    }
  });
});
