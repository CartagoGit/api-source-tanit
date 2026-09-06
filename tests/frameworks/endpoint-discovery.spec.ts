import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { VARIANT_TAG } from "../../packages/contracts/constants/core/postman.constant";
import { enrichCatalogWithFormRequests } from "../../packages/frameworks/laravel/catalog-enricher.service";
import { discoverEndpoints, toPostmanUri } from "../../packages/frameworks/laravel/endpoint-discovery.service";
import { buildCollection } from "../../packages/core/domain/collection-builder.service";
import type { EndpointSpec } from "../../packages/contracts/interfaces/core/postman.interface";
import type { ProjectConfig } from "../../packages/contracts/interfaces/core/project-config.interface";
import { mergeWithManual } from "../../packages/core/domain/endpoint-merge.service";
import { resolveProjectContext } from "../../packages/core/discovery/project-context.service";
import type { IProjectContext } from "../../packages/contracts/interfaces/core/project-context.interface";
import { createTempProject, type ITempProject } from "../helpers/scanner-fixture";

const spec = (partial: Partial<EndpointSpec>): EndpointSpec =>
  ({
    name: "Endpoint",
    method: "GET",
    uri: "/items",
    headers: [],
    query: [],
    ...partial,
  }) as EndpointSpec;

describe("mergeWithManual", () => {
  test("without overrides returns the auto catalog intact", () => {
    const auto = [spec({ uri: "/users" })];
    expect(mergeWithManual(auto, [])).toEqual(auto);
  });

  test("override wins on name", () => {
    const merged = mergeWithManual(
      [spec({ method: "GET", uri: "/users", name: "Obtener Users" })],
      [spec({ method: "GET", uri: "/users", name: "Listado de clientes" })],
    );
    expect(merged[0]?.name).toBe("Listado de clientes");
  });

  test("override wins on body", () => {
    const merged = mergeWithManual(
      [spec({ method: "POST", uri: "/users", body: { a: 1 } })],
      [spec({ method: "POST", uri: "/users", body: { b: 2 } })],
    );
    expect(merged[0]?.body).toEqual({ b: 2 });
  });

  // The override fixes what the scanner infers, but must not erase
  // the reference to the FormRequest the enricher needs afterwards.
  test("an override without formRequest keeps the auto-detected one", () => {
    const merged = mergeWithManual(
      [spec({ method: "POST", uri: "/users", formRequest: "laravel:post /users" })],
      [spec({ method: "POST", uri: "/users", name: "Crear" })],
    );
    expect(merged[0]?.formRequest).toBe("laravel:post /users");
  });

  test("matches even when the parameter is named differently", () => {
    const merged = mergeWithManual(
      [spec({ method: "GET", uri: "/users/{{id}}" })],
      [spec({ method: "GET", uri: "/users/{userId}", name: "Ver cliente" })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.name).toBe("Ver cliente");
  });

  test("a manual endpoint that does not exist in code is added", () => {
    const merged = mergeWithManual(
      [spec({ method: "GET", uri: "/users" })],
      [spec({ method: "POST", uri: "/webhooks/stripe", name: "Webhook" })],
    );
    expect(merged).toHaveLength(2);
    expect(merged[1]?.name).toBe("Webhook");
  });

  test("does not confuse endpoints with the same path and different method", () => {
    const merged = mergeWithManual(
      [spec({ method: "GET", uri: "/users" }), spec({ method: "POST", uri: "/users" })],
      [spec({ method: "POST", uri: "/users", name: "Crear usuario" })],
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((s) => s.method === "GET")?.name).toBe("Endpoint");
    expect(merged.find((s) => s.method === "POST")?.name).toBe("Crear usuario");
  });

  test("an empty auto catalog returns only the manual ones", () => {
    const manual = [spec({ name: "Solo manual" })];
    expect(mergeWithManual([], manual)).toEqual(manual);
  });
});

const CONFIG: ProjectConfig = {
  name: "demo",
  collectionName: "Demo",
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

describe("enrichCatalogWithFormRequests", () => {
  test("without FormRequests index the collection is not broken", async () => {
    const collection = buildCollection([spec({ uri: "/users" })], { ...CONFIG });
    const before = JSON.stringify(collection);
    const stats = await enrichCatalogWithFormRequests(collection, new Map());

    expect(stats.bodyVariants).toBe(0);
    expect(JSON.stringify(collection)).toBe(before);
  });

  test("counts what it does not find as unresolved", async () => {
    const project = await createTempProject({});
    const context = resolveProjectContext({ projectRoot: project.root });
    const collection = buildCollection([spec({ method: "POST", uri: "/users" })], {
      ...CONFIG,
    });
    try {
      const stats = await enrichCatalogWithFormRequests(
        collection,
        new Map([["POST users", "app/Http/Requests/NoExiste.php"]]),
        context,
      );
      expect(stats.resolved).toBe(0);
    } finally {
      await project.cleanup();
    }
  });

  test("an empty collection returns zero statistics", async () => {
    const collection = buildCollection([], { ...CONFIG });
    const stats = await enrichCatalogWithFormRequests(collection, new Map());

    expect(stats).toMatchObject({
      bodyVariants: 0,
      queryVariants: 0,
      resolved: 0,
      unresolved: 0,
    });
    expect(stats.rulesWithUnknown).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// toPostmanUri — parameter conversion and slash normalization
// ---------------------------------------------------------------------------

describe("toPostmanUri", () => {
  test("converts Laravel parameters into Postman variables", () => {
    expect(toPostmanUri("api/clientes/{cliente}")).toBe("/clientes/{{cliente}}");
  });

  test("drops the regex from parameters with a constraint", () => {
    expect(toPostmanUri("api/fabricantes/{fabricante:tecdoc_id}")).toBe(
      "/fabricantes/{{fabricante}}",
    );
  });

  test("strips the api/ prefix with or without a leading slash", () => {
    expect(toPostmanUri("api/pedidos")).toBe("/pedidos");
    expect(toPostmanUri("/api/pedidos")).toBe("/pedidos");
  });

  test("normalizes double slashes and trailing slash", () => {
    expect(toPostmanUri("api//doble///barra/")).toBe("/doble/barra");
  });

  test("the root stays as /", () => {
    expect(toPostmanUri("/")).toBe("/");
    expect(toPostmanUri("api/")).toBe("/");
  });

  test("a URI without api/ stays as-is", () => {
    expect(toPostmanUri("login")).toBe("/login");
  });
});

// ---------------------------------------------------------------------------
// discoverEndpoints + routeToSpec on a temporary Laravel project
// ---------------------------------------------------------------------------

/**
 * Controller with every signature shape the parser distinguishes:
 * imported FormRequest, imported with alias, generic Illuminate
 * Request and an untyped parameter.
 */
const USUARIO_CONTROLLER = `<?php

namespace App\\Http\\Controllers;

use App\\Http\\Requests\\Usuarios\\CrearUsuarioRequest;
use App\\Http\\Requests\\Usuarios\\ActualizarUsuarioRequest as UpdateRequest;
use Illuminate\\Http\\Request;
use App\\Models\\FacturaRequest;
use App\\Models\\Gestor as GestorRequest;

class UsuarioController extends Controller
{
    public function index()
    {
        return [];
    }

    protected function sincronizar(FacturaRequest $peticion)
    {
        // Protected method with FormRequest outside app/Http/Requests:
        // the route resolver rejects it and falls back to the
        // convention-based fallback.
    }

    public function auditar(GestorRequest $peticion)
    {
        // Alias ending in Request pointing at a class that does NOT
        // end in Request: the FQCN is not accepted as a FormRequest.
    }

    public function store(CrearUsuarioRequest $peticion)
    {
        // FormRequest via direct import.
    }

    public function update(UpdateRequest $peticion)
    {
        // FormRequest via import with alias ending in Request.
    }

    public function destroy($usuario)
    {
        // Untyped parameter: falls back to the naming convention.
    }

    public function activar(Request $peticion)
    {
        // Generic Illuminate\\Http\\Request: does NOT count as FormRequest.
    }

    public function buscarAlta(Request $peticion)
    {
        // camelCase method for the humanized name.
    }

    public function importar(\App\Http\Requests\Usuarios\ImportarUsuarioRequest $peticion)
    {
        // FormRequest typed with the full FQCN inline (no import).
    }
}
`;

const RUTAS_USUARIOS = `<?php

use Illuminate\\Support\\Facades\\Route;
use App\\Http\\Controllers\\UsuarioController;
use App\\Http\\Controllers\\PedidoController;

Route::get('usuarios', [UsuarioController::class, 'index']);
Route::post('usuarios', [UsuarioController::class, 'store']);
// Second route to the same action: the FormRequest rule cache
// must be reused across both.
Route::post('usuarios/crear', [UsuarioController::class, 'store']);
Route::post('usuarios/importar', [UsuarioController::class, 'importar']);
Route::put('usuarios/{usuario}', [UsuarioController::class, 'update']);
Route::delete('usuarios/{usuario}', [UsuarioController::class, 'destroy']);
Route::post('usuarios/{usuario}/activar', [UsuarioController::class, 'activar']);
Route::get('usuarios/buscar-alta', [UsuarioController::class, 'buscarAlta']);
Route::post('usuarios/{usuario}/sincronizar', [UsuarioController::class, 'sincronizar']);
Route::post('usuarios/auditar', [UsuarioController::class, 'auditar']);

Route::prefix('pedidos')->group(function () {
    Route::get('', [PedidoController::class, 'index']);
});
`;

const PEDIDO_CONTROLLER = `<?php

namespace App\\Http\\Controllers;

class PedidoController extends Controller
{
    public function index()
    {
        return [];
    }
}
`;

const FORM_REQUEST_TEMPLATE = (clase: string, cuerpo: string): string => `<?php

namespace App\\Http\\Requests;

use Illuminate\\Foundation\\Http\\FormRequest;

class ${clase} extends FormRequest
{
    public function rules(): array
    {
        return [
${cuerpo}
        ];
    }
}
`;

const FR_CREAR = FORM_REQUEST_TEMPLATE(
  "CrearUsuarioRequest",
  `            'name' => ['required', 'string', 'max:80'],
            'email' => ['required', 'email', 'max:120'],`,
);
const FR_IMPORTAR = FORM_REQUEST_TEMPLATE(
  "ImportarUsuarioRequest",
  `            'ruta' => ['required', 'string'],`,
);
const FR_ACTUALIZAR = FORM_REQUEST_TEMPLATE(
  "ActualizarUsuarioRequest",
  `            'nombre' => ['sometimes', 'string'],`,
);
const FR_DESTRUIR = FORM_REQUEST_TEMPLATE(
  "DestroyUsuarioRequest",
  `            'motivo' => ['required', 'string'],`,
);
const FR_SINCRONIZAR = FORM_REQUEST_TEMPLATE(
  "SincronizarRequest",
  `            'lote' => ['required', 'string'],`,
);

describe("discoverEndpoints over a temporary project", () => {
  let project: ITempProject;
  let contexto: IProjectContext;

  const configPara = (): ProjectConfig => ({ ...CONFIG, filePrefixes: {} });

  beforeAll(async () => {
    project = await createTempProject({
      "artisan": "",
      "composer.json": '{"require":{"laravel/framework":"^11.0"}}',
      "routes/api.php": RUTAS_USUARIOS,
      "app/Http/Controllers/UsuarioController.php": USUARIO_CONTROLLER,
      "app/Http/Controllers/PedidoController.php": PEDIDO_CONTROLLER,
      "app/Http/Requests/Usuarios/CrearUsuarioRequest.php": FR_CREAR,
      "app/Http/Requests/Usuarios/ImportarUsuarioRequest.php": FR_IMPORTAR,
      "app/Http/Requests/Usuarios/ActualizarUsuarioRequest.php": FR_ACTUALIZAR,
      "app/Http/Requests/DestroyUsuarioRequest.php": FR_DESTRUIR,
      "app/Http/Requests/SincronizarRequest.php": FR_SINCRONIZAR,
    });
    contexto = resolveProjectContext({ projectRoot: project.root });
  });

  afterAll(async () => {
    await project.cleanup();
  });

  const descubre = () => discoverEndpoints(configPara(), [], contexto);

  test("turns routes into specs with a Postman uri and readable name", async () => {
    const res = await descubre();
    expect(res.routes).toHaveLength(11);
    expect(res.specs).toHaveLength(11);

    const specDe = (metodo: string, uri: string): EndpointSpec | undefined =>
      res.specs.find((s) => s.method === metodo && s.uri === uri);

    expect(specDe("GET", "/usuarios")?.name).toBe("Listar Usuarios");
    expect(specDe("GET", "/usuarios")?.folder).toBe("Usuarios");
    expect(specDe("PUT", "/usuarios/{{usuario}}")?.name).toBe("Actualizar Usuarios");
    expect(specDe("DELETE", "/usuarios/{{usuario}}")?.name).toBe("Eliminar Usuarios");
    // Method outside the known labels + a two-word resource.
    expect(specDe("GET", "/usuarios/buscar-alta")?.name).toContain("Buscar Alta");

    const pedidos = specDe("GET", "/pedidos");
    expect(pedidos?.name).toBe("Listar Pedidos");
    expect(pedidos?.folder).toBe("Pedidos");
  });

  test("the body comes from the minimal FormRequest for POST and PUT", async () => {
    const res = await descubre();
    const crear = res.specs.find((s) => s.method === "POST" && s.uri === "/usuarios");
    expect(crear?.formRequest).toBe("app/Http/Requests/Usuarios/CrearUsuarioRequest.php");
    expect(crear?.body).toEqual({
      name: "sample_name",
      email: "user@example.com",
    });
    expect(crear?.description).toBe("Auto · CrearUsuarioRequest");

    // update: FormRequest resolved via alias; with no required
    // fields, the minimal body is empty and falls back to the full
    // one.
    const actualizar = res.specs.find((s) => s.method === "PUT");
    expect(actualizar?.formRequest).toBe(
      "app/Http/Requests/Usuarios/ActualizarUsuarioRequest.php",
    );
    expect(actualizar?.body).toEqual({ nombre: "sample_nombre" });
  });

  test("the convention fallback finds the destroy FormRequest", async () => {
    // DestroyUsuarioRequest is not imported in the controller and the
    // parameter has no type: it is located by name convention
    // (destroy → Destroy… + Usuario resource in app/Http/Requests).
    const res = await descubre();
    const borrar = res.specs.find((s) => s.method === "DELETE");
    expect(borrar?.formRequest).toBe("app/Http/Requests/DestroyUsuarioRequest.php");
    expect(borrar?.description).toBe("Auto · DestroyUsuarioRequest");
    // DELETE is not POST/PUT/PATCH: the description comes in, the
    // body does not.
    expect(borrar?.body).toBeUndefined();
  });

  test("without FormRequest neither by signature nor by convention the spec stays bare", async () => {
    const res = await descubre();
    const index = res.specs.find((s) => s.method === "GET" && s.uri === "/usuarios");
    expect(index?.formRequest).toBeUndefined();
    expect(index?.body).toBeUndefined();
    expect(index?.description).toBeUndefined();

    // Generic Illuminate Request: no FormRequest is generated.
    const activar = res.specs.find((s) => s.uri.endsWith("/activar"));
    expect(activar?.formRequest).toBeUndefined();
    // The name uses the last meaningful segment, not the prefix.
    expect(activar?.name).toBe("Activar Activar");
  });

  test("methods with body only carry it on POST/PUT/PATCH", async () => {
    const res = await descubre();
    // GET with FormRequest receives no body: only POST/PUT/PATCH.
    // There are four POSTs with rules (store×2, import, sincronizar)
    // and one PUT.
    const conCuerpo = res.specs.filter((s) => s.body !== undefined).map((s) => s.method);
    expect(conCuerpo.sort()).toEqual(["POST", "POST", "POST", "POST", "PUT"]);
  });

  test("the conFormRequest / sinFormRequest counters reconcile with the specs", async () => {
    const res = await descubre();
    // store×2, update, destroy, import, sincronizar = 6 with FormRequest;
    // index, activar, buscarAlta, auditar (alias that does not point at
    // a FormRequest) and pedidos.index = 5 without FormRequest.
    expect(res.withFormRequest).toBe(6);
    expect(res.withoutFormRequest).toBe(5);
    expect(res.withFormRequest + res.withoutFormRequest).toBe(res.specs.length);
  });

  test("a Request alias whose FQCN is not a FormRequest resolves nothing", async () => {
    // The import `use App\Models\Gestor as GestorRequest` makes the
    // signature parser point at App\Models\Gestor:
    // resolveFormRequestPath rejects it and the convention finds
    // nothing either.
    const res = await descubre();
    const auditar = res.specs.find((s) => s.uri.endsWith("/auditar"));
    expect(auditar?.formRequest).toBeUndefined();
    expect(auditar?.body).toBeUndefined();
    expect(auditar?.description).toBeUndefined();
  });

  test("the convention fallback also covers camelCase verbs", async () => {
    // `sincronizar` imports a model (not a Http\Requests FormRequest):
    // resolveFormRequestPath rejects it and resolution falls into the
    // naming convention, where `SincronizarRequest` matches.
    const res = await descubre();
    const sincronizar = res.specs.find((s) => s.uri.endsWith("/sincronizar"));
    expect(sincronizar?.formRequest).toBe("app/Http/Requests/SincronizarRequest.php");
    expect(sincronizar?.description).toBe("Auto · SincronizarRequest");
  });

  test("manual overrides win but preserve the formRequest", async () => {
    const res = await discoverEndpoints(
      configPara(),
      [
        {
          name: "Alta de cliente",
          method: "POST",
          uri: "/usuarios",
          headers: [],
          query: [],
        } as EndpointSpec,
      ],
      contexto,
    );
    const crear = res.specs.find((s) => s.method === "POST" && s.uri === "/usuarios");
    expect(crear?.name).toBe("Alta de cliente");
    expect(crear?.formRequest).toBe("app/Http/Requests/Usuarios/CrearUsuarioRequest.php");
  });

  test("a project without a routes folder returns everything empty without breaking", async () => {
    const tmp = await createTempProject({ "composer.json": "{}" });
    try {
      const ctxLocal = resolveProjectContext({ projectRoot: tmp.root });
      const res = await discoverEndpoints(configPara(), [], ctxLocal);
      expect(res.specs).toEqual([]);
      expect(res.routes).toEqual([]);
      expect(res.withFormRequest).toBe(0);
      expect(res.withoutFormRequest).toBe(0);
    } finally {
      await tmp.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// enrichCatalogWithFormRequests — enrichment paths not yet walked
// ---------------------------------------------------------------------------

describe("enrichCatalogWithFormRequests — real enrichment", () => {
  let project: ITempProject;
  let contexto: IProjectContext;

  beforeAll(async () => {
    project = await createTempProject({
      "app/Http/Requests/ListarUsuarioRequest.php": FORM_REQUEST_TEMPLATE(
        "ListarUsuarioRequest",
        `            'nombre' => ['sometimes', 'string'],
            'busqueda' => ['sometimes', 'string'],`,
      ),
      "app/Http/Requests/StoreUsuarioRequest.php": FORM_REQUEST_TEMPLATE(
        "StoreUsuarioRequest",
        `            'name' => ['required', 'string'],
            'estado' => ['required', 'in:activo,inactivo'],`,
      ),
      "app/Http/Requests/PutUsuarioRequest.php": FORM_REQUEST_TEMPLATE(
        "PutUsuarioRequest",
        `            'estado' => ['sometimes', 'in:ok,ko'],`,
      ),
      "app/Http/Requests/DestroyUsuarioRequest.php": FORM_REQUEST_TEMPLATE(
        "DestroyUsuarioRequest",
        `            'motivo' => ['required', 'string'],`,
      ),
      "app/Http/Requests/VaciarRequest.php": FORM_REQUEST_TEMPLATE(
        "VaciarRequest",
        "",
      ),
      "app/Http/Requests/DinamicaRequest.php": `<?php

namespace App\\Http\\Requests;

use Illuminate\\Foundation\\Http\\FormRequest;
use Illuminate\\Validation\\Rule;

class DinamicaRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'tipo' => ['required', Rule::in(['a', 'b'])],
            'simple' => ['required', 'string'],
        ];
    }
}
`,
    });
    contexto = resolveProjectContext({ projectRoot: project.root });
  });

  afterAll(async () => {
    await project.cleanup();
  });

  /**
   * The endpoint lives inside its folder: buildCollection wraps each
   * group in an item with `item`. The enricher mutates that inner
   * node.
   */
  const nodoEndpoint = (collection: ReturnType<typeof buildCollection>) =>
    collection.item[0]?.item?.[0];

  const enriquecer = async (specs: EndpointSpec[], indice: Map<string, string>) => {
    const collection = buildCollection(specs, { ...CONFIG });
    return {
      collection,
      stats: await enrichCatalogWithFormRequests(collection, indice, contexto),
    };
  };

  test("GET with search rules generates query variants and wraps the item", async () => {
    const { collection, stats } = await enriquecer(
      [spec({ name: "Listar Usuarios", method: "GET", uri: "/usuarios" })],
      new Map([["GET usuarios", "app/Http/Requests/ListarUsuarioRequest.php"]]),
    );
    expect(stats.resolved).toBe(1);
    expect(stats.queryVariants).toBe(2);
    expect(stats.bodyVariants).toBe(0);

    // The endpoint node becomes a folder [base, Variants].
    const nodo = nodoEndpoint(collection);
    expect(nodo?.item).toBeDefined();
    expect(nodo?.item?.[0]?.name).toBe("Listar Usuarios (base)");
    const contenedor = nodo?.item?.[1];
    expect(contenedor?.name).toContain("ListarUsuarioRequest");
    const queries = contenedor?.item?.map(
      (v) => v.request?.url.query?.map((q) => q.key) ?? [],
    );
    // The "Basic" variant uses the FIRST filterable field in rules():
    // here `nombre` (the second carries all the fields).
    expect(queries).toEqual([["nombre"], ["nombre", "busqueda"]]);
  });

  test("POST enriches with body variants, deduping the enum one", async () => {
    const { collection, stats } = await enriquecer(
      [spec({ name: "Crear Usuario", method: "POST", uri: "/usuarios" })],
      new Map([["POST usuarios", "app/Http/Requests/StoreUsuarioRequest.php"]]),
    );
    expect(stats.resolved).toBe(1);
    // Minimal + enum=inactivo: the enum=activo variant matches the
    // minimal and is deduped; the full one also matches and does not
    // enter.
    expect(stats.bodyVariants).toBe(2);

    const variantes = nodoEndpoint(collection)?.item?.[1]?.item ?? [];
    expect(variantes.map((v) => v.name)).toEqual([
      "Variant: Mínimo (solo required)" + VARIANT_TAG,
      "Variant: Enum estado=inactivo" + VARIANT_TAG,
    ]);
    const bodies = variantes.map((v) => JSON.parse(v.request?.body?.raw ?? "{}"));
    expect(bodies).toEqual([
      { name: "sample_name", estado: "activo" },
      { name: "sample_name", estado: "inactivo" },
    ]);
    // Each variant carries its Content-Type.
    expect(variantes[0]?.request?.header.some((h) => h.key === "Content-Type")).toBe(true);
  });

  test("name guessing creates Store candidates from Crear", async () => {
    // Index with a FormRequest that does not exist: resolution falls
    // back to the naming heuristic and finds StoreUsuarioRequest.
    const { collection, stats } = await enriquecer(
      [spec({ name: "Crear Usuario", method: "POST", uri: "/usuarios" })],
      new Map([["POST usuarios", "app/Http/Requests/NoExiste.php"]]),
    );
    expect(stats.resolved).toBe(1);
    expect(stats.bodyVariants).toBeGreaterThan(0);
    expect(nodoEndpoint(collection)?.item).toBeDefined();
  });

  test("PATCH without required yields empty + full + enum variants", async () => {
    const { collection, stats } = await enriquecer(
      [spec({ name: "Editar Usuario", method: "PATCH", uri: "/usuarios/{{id}}" })],
      new Map([["PATCH usuarios/:p", "app/Http/Requests/PutUsuarioRequest.php"]]),
    );
    expect(stats.resolved).toBe(1);
    expect(stats.bodyVariants).toBe(3);

    const cuerpos = (nodoEndpoint(collection)?.item?.[1]?.item ?? []).map((v) =>
      JSON.parse(v.request?.body?.raw ?? "{}"),
    );
    expect(cuerpos).toEqual([{}, { estado: "ok" }, { estado: "ko" }]);
  });

  test("GET without query variants does not restructure the item", async () => {
    // PutUsuarioRequest only has `estado` with `in:`: no typed rule
    // enters generateQueryVariants and the node stays intact.
    const { collection, stats } = await enriquecer(
      [spec({ name: "Ver Usuario", method: "GET", uri: "/usuarios" })],
      new Map([["GET usuarios", "app/Http/Requests/PutUsuarioRequest.php"]]),
    );
    expect(stats.resolved).toBe(1);
    expect(stats.queryVariants).toBe(0);
    const nodo = nodoEndpoint(collection);
    expect(nodo?.item).toBeUndefined();
    expect(nodo?.request).toBeDefined();
  });

test("dynamic rules accumulate in rulesWithUnknown", async () => {
    const { stats } = await enriquecer(
      [spec({ name: "Crear Dinamica", method: "POST", uri: "/dinamica" })],
      new Map([["POST dinamica", "app/Http/Requests/DinamicaRequest.php"]]),
    );
    expect(stats.resolved).toBe(1);
    expect(stats.rulesWithUnknown).toEqual([
      { formRequest: "DinamicaRequest", unknown: ["tipo → Rule::in(['a', 'b'])"] },
    ]);
    expect(stats.bodyVariants).toBe(1);
  });

  test("a non-existent FormRequest is counted as unresolved", async () => {
    const { stats } = await enriquecer(
      [spec({ name: "Ver Usuario", method: "GET", uri: "/usuarios/{{id}}" })],
      new Map([["GET usuarios/:p", "app/Http/Requests/VaciaRequest.php"]]),
    );
    expect(stats.resolved).toBe(0);
    expect(stats.unresolved).toBe(1);
  });

  test("DELETE with resolved rules is counted but generates no variants", async () => {
    const { stats } = await enriquecer(
      [spec({ name: "Eliminar Usuario", method: "DELETE", uri: "/usuarios/{{id}}" })],
      new Map([["DELETE usuarios/:p", "app/Http/Requests/StoreUsuarioRequest.php"]]),
    );
    expect(stats.resolved).toBe(1);
    expect(stats.bodyVariants).toBe(0);
    expect(stats.queryVariants).toBe(0);
  });

  test("Eliminar resolves via the Destroy guess when the index fails", async () => {
    let collection: ReturnType<typeof buildCollection>;
    collection = buildCollection(
      [spec({ name: "Eliminar Usuario", method: "DELETE", uri: "/usuarios/{{id}}" })],
      { ...CONFIG },
    );
    // Index without a file: resolution falls back to the naming
    // heuristic (Eliminar → DestroyUsuarioRequest from the main
    // fixture).
    const stats = await enrichCatalogWithFormRequests(
      collection,
      new Map([["DELETE usuarios/:p", "app/Http/Requests/NoExisteRequest.php"]]),
      contexto,
    );
    expect(stats.resolved).toBe(1);
  });

  test("a manual body is kept as base and counted in skippedManualBody", async () => {
    const { stats } = await enriquecer(
      [
        spec({
          name: "Crear Usuario",
          method: "POST",
          uri: "/usuarios",
          body: { manual: true },
        }),
      ],
      new Map([["POST usuarios", "app/Http/Requests/StoreUsuarioRequest.php"]]),
    );
    expect(stats.resolved).toBe(1);
    expect(stats.bodyVariants).toBeGreaterThan(0);
    expect(stats.skippedManualBody).toBe(1);
  });

  test("an endpoint that matches neither by index nor by name is left untouched", async () => {
    const { collection, stats } = await enriquecer(
      [spec({ name: "Operacion Rara", method: "POST", uri: "/raro" })],
      new Map([["POST raro", "app/Http/Requests/NoExisteRequest.php"]]),
    );
    expect(stats.resolved).toBe(0);
    expect(stats.unresolved).toBe(1);
    expect(nodoEndpoint(collection)?.item).toBeUndefined();
  });

  test("a FormRequest without rules counts as not enrichable", async () => {
    // VaciarRequest returns `[]`: `loadFormRequest` parses it,
    // sees it empty (isEmpty) and returns null → the endpoint stays
    // unresolved and the node stays intact.
    const { collection, stats } = await enriquecer(
      [spec({ name: "Vaciar Usuarios", method: "POST", uri: "/usuarios/vaciar", body: { a: 1 } })],
      new Map([["POST usuarios/vaciar", "app/Http/Requests/VaciarRequest.php"]]),
    );
    expect(stats.resolved).toBe(0);
    expect(stats.unresolved).toBe(1);
    expect(nodoEndpoint(collection)?.item).toBeUndefined();
  });

  // a00017/S1: the descriptions the Laravel enricher injects into the
  // Postman collection are part of the user-visible artifact. They
  // must be in English; the project's i18n layer
  // (`packages/ui/i18n/locales/*.json`) cannot translate strings the
  // generator itself emitted in Spanish.
  test("emits English descriptions for both POST and GET variants (a00017/S1)", async () => {
    const collectionPost = buildCollection(
      [spec({ name: "Crear Usuario", method: "POST", uri: "/usuarios" })],
      { ...CONFIG },
    );
    await enrichCatalogWithFormRequests(
      collectionPost,
      new Map([["POST usuarios", "app/Http/Requests/StoreUsuarioRequest.php"]]),
      contexto,
    );
    const variantesPost = nodoEndpoint(collectionPost)?.item?.[1]?.item ?? [];
    expect(variantesPost.length).toBeGreaterThan(0);
    const serializadoPost = JSON.stringify(variantesPost);
    expect(serializadoPost).toContain("Auto-generated variant");
    expect(serializadoPost).toContain("Auto-generated from StoreUsuarioRequest");
    expect(serializadoPost).not.toContain("Variante auto-generada");
    expect(serializadoPost).not.toContain("Generada automáticamente");
    expect(serializadoPost).not.toContain("Variants auto-generadas");

    const collectionGet = buildCollection(
      [spec({ name: "Listar Usuarios", method: "GET", uri: "/usuarios" })],
      { ...CONFIG },
    );
    await enrichCatalogWithFormRequests(
      collectionGet,
      new Map([["GET usuarios", "app/Http/Requests/ListarUsuarioRequest.php"]]),
      contexto,
    );
    const serializadoGet = JSON.stringify(nodoEndpoint(collectionGet));
    expect(serializadoGet).toContain("Auto-generated variants from `ListarUsuarioRequest`");
    expect(serializadoGet).not.toContain("Variants auto-generadas");
    expect(serializadoGet).not.toContain("Colecci");
    expect(serializadoGet).not.toContain("Generada automáticamente");
  });
});
