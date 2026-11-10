/**
 * Branches de endpoint-discovery.service.ts no cubiertas por las suites generales.
 *
 * Ramas objetivo (identificadas en el informe de cobertura v8):
 *
 *  1. `endpointName` — URI con todos los segmentos parametrizados
 *     → `segs.length ? ... : ""` toma la rama false → resource = ""
 *     → `if (resource)` toma la rama false
 *     → `return action || ...` — la rama `action` siempre gana (truthy),
 *        pero la rama ternaria falsa de segs.length queda cubierta.
 *
 *  2. `endpointName` — resource y prefix son la misma palabra
 *     → `resource && prefix && resource.toLowerCase() !== prefix.toLowerCase()`
 *     toma la rama false por la comparación de igualdad (tercer &&).
 *
 *  3. `parseControllerFormRequests` — controlador sin archivo PHP
 *     → el `readFile` lanza → catch → retorna mapa vacío.
 *
 *  4. `parseControllerFormRequests` — método con `Request $r` sin import
 *     → `typeName === "Request" && !imports.has("Request")` = true → continue.
 *
 *  5. `resolveFormRequestPath` — archivo FQCN válido pero inexistente en disco
 *     → `readFile` lanza → catch → return null.
 *
 *  6. `parseControllerFormRequests` — Case 2 del if encadenado:
 *     fqcn termina en \\Request Y contiene Http\\Requests
 *     → primera condición falla (`!fqcn.endsWith("\\Request")` = false)
 *     → segunda condición `fqcn.includes("Http\\Requests")` = true → set.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { discoverEndpoints, toPostmanUri } from "../../../packages/frameworks/laravel/endpoint-discovery.service";
import { resolveProjectContext } from "../../../packages/core/discovery/project-context.service";
import type { IProjectContext } from "../../../packages/contracts/interfaces/core/project-context.interface";
import type { ProjectConfig } from "../../../packages/contracts/interfaces/core/project-config.interface";
import { createTempProject, type ITempProject } from "../../helpers/scanner-fixture";

const BASE_CONFIG: ProjectConfig = {
  name: "test",
  collectionName: "Test",
  collectionDescription: "",
  baseUrl: "http://localhost/api",
  variables: [{ key: "baseUrl", value: "http://localhost/api", type: "string" }],
  filePrefixes: {},
  zones: [],
  zoneOrder: [],
  defaultZone: "Otros",
  authDescriptions: {},
  loginEndpointName: "Login",
};

// ---------------------------------------------------------------------------
// 1. URI enteramente parametrizada → resource = ""
// ---------------------------------------------------------------------------

describe("endpoint-discovery — URI con todos los segmentos parametrizados", () => {
  /**
   * Route::get('{tenant}', ...) produce rawUri = "{tenant}" y tras
   * toPostmanUri → "/{{tenant}}". El filtro de segs elimina el único
   * segmento ("{{tenant}}"), dejando segs = []. La condición
   * `segs.length ? humanizeSegment(...) : ""` toma la rama false y
   * resource queda "". El `if (resource)` también es false y se cae a
   * `return action || ...`.
   */
  const RUTAS_SOLO_PARAM = `<?php

use Illuminate\\Support\\Facades\\Route;
use App\\Http\\Controllers\\TenantController;

// La URI completa es un parámetro: ningún segmento literal queda tras filtrar.
Route::get('{tenant}', [TenantController::class, 'show']);
// Closure sin actionName: action = route.method.
Route::get('{id}', fn () => 1);
// Segmento solo parámetro dentro de un prefijo.
Route::prefix('api/v3')->group(function () {
    Route::get('{uuid}', [TenantController::class, 'index']);
});
`;

  let project: ITempProject;
  let ctx: IProjectContext;

  beforeAll(async () => {
    project = await createTempProject({
      "artisan": "",
      "composer.json": '{"require":{"laravel/framework":"^11.0"}}',
      "routes/api.php": RUTAS_SOLO_PARAM,
    });
    ctx = resolveProjectContext({ projectRoot: project.root });
  });

  afterAll(async () => {
    await project.cleanup();
  });

  test("la URI all-param produce un nombre basado en la acción, no en el recurso", async () => {
    const res = await discoverEndpoints(BASE_CONFIG, [], ctx);
    // La ruta con actionName="show" usa humanizeMethod → "Ver"
    const show = res.specs.find((s) => s.uri === "/{{tenant}}" && s.name.startsWith("Ver"));
    expect(show).toBeDefined();
    expect(show?.uri).toBe("/{{tenant}}");
  });

  test("toPostmanUri convierte un rawUri solo-param a {{param}}", () => {
    expect(toPostmanUri("{tenant}")).toBe("/{{tenant}}");
    expect(toPostmanUri("api/{tenant}")).toBe("/{{tenant}}");
    expect(toPostmanUri("{a}/{b}/{c}")).toBe("/{{a}}/{{b}}/{{c}}");
  });

  test("una closure en URI all-param genera el nombre a partir del método HTTP", async () => {
    const res = await discoverEndpoints(BASE_CONFIG, [], ctx);
    // Route::get('{id}', fn () => 1) — sin actionName → action = "GET"
    const closure = res.specs.find((s) => s.uri === "/{{id}}" && s.name === "GET");
    expect(closure).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 2. resource == prefix (misma palabra en posición 0 y última)
// ---------------------------------------------------------------------------

describe("endpoint-discovery — resource y prefix son la misma palabra", () => {
  /**
   * URI `/api/admin/admin` → segs = ["admin", "admin"].
   * resource = "Admin", prefix = "Admin".
   * La condición `resource.toLowerCase() !== prefix.toLowerCase()` = false
   * → el primer `if` falla (rama false del &&) → cae a `if (resource)` = true.
   */
  const RUTAS_RECURSO_IGUAL_PREFIJO = `<?php

use Illuminate\\Support\\Facades\\Route;
use App\\Http\\Controllers\\AdminController;

// URI con el mismo nombre en dos niveles: /admin/admin
Route::prefix('admin')->group(function () {
    Route::get('admin', [AdminController::class, 'index']);
    Route::post('admin', [AdminController::class, 'store']);
});
`;

  let project: ITempProject;
  let ctx: IProjectContext;

  beforeAll(async () => {
    project = await createTempProject({
      "artisan": "",
      "composer.json": '{"require":{"laravel/framework":"^11.0"}}',
      "routes/api.php": RUTAS_RECURSO_IGUAL_PREFIJO,
    });
    ctx = resolveProjectContext({ projectRoot: project.root });
  });

  afterAll(async () => {
    await project.cleanup();
  });

  test("cuando resource == prefix se usa la rama `if (resource)` y no la del !=", async () => {
    const res = await discoverEndpoints(BASE_CONFIG, [], ctx);
    expect(res.specs).toHaveLength(2);

    const get = res.specs.find((s) => s.method === "GET");
    const post = res.specs.find((s) => s.method === "POST");
    // resource = "Admin", prefix = "Admin" → igual → no entra en el primer if
    // pero sí en `if (resource)` → "Listar Admin" / "Crear Admin"
    expect(get?.name).toBe("Listar Admin");
    expect(post?.name).toBe("Crear Admin");
    // URI Postman: strips "api/" del prefijo inicial → /admin/admin
    expect(get?.uri).toBe("/admin/admin");
  });
});

// ---------------------------------------------------------------------------
// 3. Controlador sin archivo PHP → catch en parseControllerFormRequests
// ---------------------------------------------------------------------------

describe("endpoint-discovery — controlador referenciado pero sin archivo PHP", () => {
  /**
   * El route file declara un controlador que no existe en disco.
   * `parseControllerFormRequests` intenta `readFile(abs, "utf8")` y el
   * sistema de archivos lanza → catch → devuelve mapa vacío.
   * El spec se construye sin body/description pero sin romper.
   */
  const RUTAS_CTRL_FANTASMA = `<?php

use Illuminate\\Support\\Facades\\Route;
use App\\Http\\Controllers\\GhostController;

Route::post('ghost', [GhostController::class, 'store']);
Route::get('ghost', [GhostController::class, 'index']);
`;

  let project: ITempProject;
  let ctx: IProjectContext;

  beforeAll(async () => {
    project = await createTempProject({
      "artisan": "",
      "composer.json": '{"require":{"laravel/framework":"^11.0"}}',
      "routes/api.php": RUTAS_CTRL_FANTASMA,
      // GhostController.php intencionalmente ausente
    });
    ctx = resolveProjectContext({ projectRoot: project.root });
  });

  afterAll(async () => {
    await project.cleanup();
  });

  test("la ausencia del archivo del controlador no lanza excepción", async () => {
    await expect(discoverEndpoints(BASE_CONFIG, [], ctx)).resolves.toBeDefined();
  });

  test("las rutas del controlador fantasma se descubren sin FormRequest", async () => {
    const res = await discoverEndpoints(BASE_CONFIG, [], ctx);
    expect(res.specs).toHaveLength(2);
    expect(res.withoutFormRequest).toBe(2);
    for (const spec of res.specs) {
      expect(spec.formRequest).toBeUndefined();
      expect(spec.body).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Método con `Request $r` sin `use Illuminate\Http\Request` → continue
// ---------------------------------------------------------------------------

describe("endpoint-discovery — Request genérico sin import → no resuelve FormRequest", () => {
  /**
   * El controlador tiene `public function handle(Request $r)` pero NO
   * importa `Illuminate\Http\Request`. El parser de firmas ve
   * typeName = "Request" y `imports.has("Request") = false` →
   * la condición `typeName === "Request" && !imports.has("Request")` es
   * true → `continue` (rama antes no cubierta).
   * El endpoint se genera pero sin FormRequest ni body.
   */
  const CTRL_REQUEST_SIN_IMPORT = `<?php

namespace App\\Http\\Controllers;

// Sin "use Illuminate\Http\Request" — el "Request" en el parámetro
// se resuelve al namespace global pero el parser lo descarta.
class HandleController extends Controller
{
    public function handle(Request $r)
    {
        return response()->json([]);
    }

    public function index()
    {
        return [];
    }
}
`;

  const RUTAS_HANDLE = `<?php

use Illuminate\\Support\\Facades\\Route;
use App\\Http\\Controllers\\HandleController;

Route::post('handle', [HandleController::class, 'handle']);
Route::get('handle', [HandleController::class, 'index']);
`;

  let project: ITempProject;
  let ctx: IProjectContext;

  beforeAll(async () => {
    project = await createTempProject({
      "artisan": "",
      "composer.json": '{"require":{"laravel/framework":"^11.0"}}',
      "routes/api.php": RUTAS_HANDLE,
      "app/Http/Controllers/HandleController.php": CTRL_REQUEST_SIN_IMPORT,
    });
    ctx = resolveProjectContext({ projectRoot: project.root });
  });

  afterAll(async () => {
    await project.cleanup();
  });

  test("Request sin import no se confunde con un FormRequest propio", async () => {
    const res = await discoverEndpoints(BASE_CONFIG, [], ctx);
    const post = res.specs.find((s) => s.method === "POST");
    // El `Request $r` sin import se ignora (continue) → no hay FormRequest
    expect(post).toBeDefined();
    expect(post?.formRequest).toBeUndefined();
    expect(post?.body).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. resolveFormRequestPath — archivo no existe en disco → catch → null
// ---------------------------------------------------------------------------

describe("endpoint-discovery — FQCN de FormRequest válido pero archivo ausente", () => {
  /**
   * El controlador importa `use App\Http\Requests\MissingRequest;` y el
   * método store(MissingRequest $r) → FQCN inicia con App\Http\Requests\,
   * el path se construye correctamente, pero el archivo no existe →
   * readFile lanza → catch en resolveFormRequestPath → return null.
   * La ruta cae al fallback por convención (findFormRequestForController)
   * que tampoco encuentra nada → spec sin FormRequest.
   */
  const CTRL_FR_AUSENTE = `<?php

namespace App\\Http\\Controllers;

use App\\Http\\Requests\\MissingRequest;
use Illuminate\\Http\\JsonResponse;

class ItemController extends Controller
{
    public function store(MissingRequest $r): JsonResponse
    {
        return response()->json(['ok' => true]);
    }
}
`;

  const RUTAS_ITEMS = `<?php

use Illuminate\\Support\\Facades\\Route;
use App\\Http\\Controllers\\ItemController;

Route::post('items', [ItemController::class, 'store']);
`;

  let project: ITempProject;
  let ctx: IProjectContext;

  beforeAll(async () => {
    project = await createTempProject({
      "artisan": "",
      "composer.json": '{"require":{"laravel/framework":"^11.0"}}',
      "routes/api.php": RUTAS_ITEMS,
      "app/Http/Controllers/ItemController.php": CTRL_FR_AUSENTE,
      // app/Http/Requests/MissingRequest.php intencionalmente ausente
    });
    ctx = resolveProjectContext({ projectRoot: project.root });
  });

  afterAll(async () => {
    await project.cleanup();
  });

  test("FQCN válido con archivo ausente no lanza excepciones", async () => {
    await expect(discoverEndpoints(BASE_CONFIG, [], ctx)).resolves.toBeDefined();
  });

  test("un FormRequest cuyo archivo no existe no se adjunta al spec", async () => {
    const res = await discoverEndpoints(BASE_CONFIG, [], ctx);
    const post = res.specs.find((s) => s.method === "POST");
    expect(post).toBeDefined();
    // El FQCN apunta a App\Http\Requests\ pero el archivo no está → null
    // La convención tampoco encuentra ningún StoreItemRequest.php
    expect(post?.formRequest).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6. Case 2 del if encadenado: fqcn.endsWith("\\Request") + Http\\Requests
// ---------------------------------------------------------------------------

describe("endpoint-discovery — FormRequest llamado Request dentro de Http\\Requests", () => {
  /**
   * Un proyecto tiene `use App\Http\Requests\Request;` (clase propia que
   * sombrea el Illuminate genérico). En parseControllerFormRequests:
   *   - alias = "Request" → imports.set("Request", "App\\Http\\Requests\\Request")
   *   - typeName === "Request" → true
   *   - imports.has("Request") → true → !imports.has = false → NO continúa
   *   - fqcn = "App\\Http\\Requests\\Request"
   *   - /Request$/.test(fqcn) = true, !fqcn.endsWith("\\Request") = FALSE
   *     (sí termina en \\Request) → primera condición falla
   *   - fqcn.includes("Http\\Requests") = true → SEGUNDA condición = true
   *     → out.set(methodName, fqcn) — rama antes no cubierta.
   */
  const FR_CUSTOM_REQUEST = `<?php

namespace App\\Http\\Requests;

use Illuminate\\Foundation\\Http\\FormRequest;

class Request extends FormRequest
{
    public function rules(): array
    {
        return [
            'payload' => ['required', 'string'],
        ];
    }
}
`;

  const CTRL_CUSTOM_REQUEST = `<?php

namespace App\\Http\\Controllers;

use App\\Http\\Requests\\Request;
use Illuminate\\Http\\JsonResponse;

class PayloadController extends Controller
{
    public function store(Request $r): JsonResponse
    {
        return response()->json(['ok' => true]);
    }
}
`;

  const RUTAS_PAYLOAD = `<?php

use Illuminate\\Support\\Facades\\Route;
use App\\Http\\Controllers\\PayloadController;

Route::post('payload', [PayloadController::class, 'store']);
`;

  let project: ITempProject;
  let ctx: IProjectContext;

  beforeAll(async () => {
    project = await createTempProject({
      "artisan": "",
      "composer.json": '{"require":{"laravel/framework":"^11.0"}}',
      "routes/api.php": RUTAS_PAYLOAD,
      "app/Http/Controllers/PayloadController.php": CTRL_CUSTOM_REQUEST,
      "app/Http/Requests/Request.php": FR_CUSTOM_REQUEST,
    });
    ctx = resolveProjectContext({ projectRoot: project.root });
  });

  afterAll(async () => {
    await project.cleanup();
  });

  test("una clase Request propia en Http\\Requests se resuelve como FormRequest", async () => {
    const res = await discoverEndpoints(BASE_CONFIG, [], ctx);
    const post = res.specs.find((s) => s.method === "POST");
    expect(post).toBeDefined();
    // El formRequest sí se resuelve porque el FQCN pasa el Case 2
    expect(post?.formRequest).toBe("app/Http/Requests/Request.php");
    expect(post?.body).toEqual({ payload: "sample_payload" });
  });
});

// ---------------------------------------------------------------------------
// 7. parseRoutesFile desde un controlador parseado → cache reutilizado
// ---------------------------------------------------------------------------

describe("endpoint-discovery — reutilización del cache de controladores", () => {
  /**
   * Dos rutas apuntan al mismo controlador y acción. La segunda llamada
   * a parseControllerFormRequests debe retornar la promesa cacheada sin
   * releer el archivo. El resultado es consistente en ambas rutas.
   */
  const FR_CREAR = `<?php

namespace App\\Http\\Requests;

use Illuminate\\Foundation\\Http\\FormRequest;

class CreateProductRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'name' => ['required', 'string'],
            'price' => ['required', 'numeric'],
        ];
    }
}
`;

  const CTRL_PRODUCTO = `<?php

namespace App\\Http\\Controllers;

use App\\Http\\Requests\\CreateProductRequest;
use Illuminate\\Http\\JsonResponse;

class ProductController extends Controller
{
    public function store(CreateProductRequest $r): JsonResponse
    {
        return response()->json(['id' => 1], 201);
    }
}
`;

  const RUTAS_PRODUCTO = `<?php

use Illuminate\\Support\\Facades\\Route;
use App\\Http\\Controllers\\ProductController;

// Dos rutas al mismo controlador/acción — cache hit en la segunda.
Route::post('products', [ProductController::class, 'store']);
Route::post('products/bulk', [ProductController::class, 'store']);
`;

  let project: ITempProject;
  let ctx: IProjectContext;

  beforeAll(async () => {
    project = await createTempProject({
      "artisan": "",
      "composer.json": '{"require":{"laravel/framework":"^11.0"}}',
      "routes/api.php": RUTAS_PRODUCTO,
      "app/Http/Controllers/ProductController.php": CTRL_PRODUCTO,
      "app/Http/Requests/CreateProductRequest.php": FR_CREAR,
    });
    ctx = resolveProjectContext({ projectRoot: project.root });
  });

  afterAll(async () => {
    await project.cleanup();
  });

  test("las dos rutas al mismo controlador producen el mismo FormRequest", async () => {
    const res = await discoverEndpoints(BASE_CONFIG, [], ctx);
    const specs = res.specs.filter((s) => s.method === "POST");
    expect(specs).toHaveLength(2);
    for (const s of specs) {
      expect(s.formRequest).toBe("app/Http/Requests/CreateProductRequest.php");
      expect(s.body).toMatchObject({ name: "sample_name" });
      expect(typeof (s.body as Record<string, unknown>).price).toBe("number");
    }
  });

  test("los contadores de FormRequest cuadran con las rutas descubiertas", async () => {
    const res = await discoverEndpoints(BASE_CONFIG, [], ctx);
    expect(res.withFormRequest).toBe(2);
    expect(res.withoutFormRequest).toBe(0);
  });
});
