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
  test("sin overrides devuelve el catálogo automático intacto", () => {
    const auto = [spec({ uri: "/users" })];
    expect(mergeWithManual(auto, [])).toEqual(auto);
  });

  test("el override gana en el nombre", () => {
    const merged = mergeWithManual(
      [spec({ method: "GET", uri: "/users", name: "Obtener Users" })],
      [spec({ method: "GET", uri: "/users", name: "Listado de clientes" })],
    );
    expect(merged[0]?.name).toBe("Listado de clientes");
  });

  test("el override gana en el body", () => {
    const merged = mergeWithManual(
      [spec({ method: "POST", uri: "/users", body: { a: 1 } })],
      [spec({ method: "POST", uri: "/users", body: { b: 2 } })],
    );
    expect(merged[0]?.body).toEqual({ b: 2 });
  });

  // El override corrige lo que el scanner deduce, pero no debe borrar
  // la referencia al FormRequest que el enricher necesita después.
  test("un override sin formRequest conserva el auto-detectado", () => {
    const merged = mergeWithManual(
      [spec({ method: "POST", uri: "/users", formRequest: "laravel:post /users" })],
      [spec({ method: "POST", uri: "/users", name: "Crear" })],
    );
    expect(merged[0]?.formRequest).toBe("laravel:post /users");
  });

  test("empareja aunque el parámetro se llame distinto", () => {
    const merged = mergeWithManual(
      [spec({ method: "GET", uri: "/users/{{id}}" })],
      [spec({ method: "GET", uri: "/users/{userId}", name: "Ver cliente" })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.name).toBe("Ver cliente");
  });

  test("un endpoint manual que no existe en el código se añade", () => {
    const merged = mergeWithManual(
      [spec({ method: "GET", uri: "/users" })],
      [spec({ method: "POST", uri: "/webhooks/stripe", name: "Webhook" })],
    );
    expect(merged).toHaveLength(2);
    expect(merged[1]?.name).toBe("Webhook");
  });

  test("no confunde endpoints con el mismo path y distinto método", () => {
    const merged = mergeWithManual(
      [spec({ method: "GET", uri: "/users" }), spec({ method: "POST", uri: "/users" })],
      [spec({ method: "POST", uri: "/users", name: "Crear usuario" })],
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((s) => s.method === "GET")?.name).toBe("Endpoint");
    expect(merged.find((s) => s.method === "POST")?.name).toBe("Crear usuario");
  });

  test("un catálogo automático vacío devuelve solo los manuales", () => {
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
  test("sin índice de FormRequests no rompe la colección", async () => {
    const collection = buildCollection([spec({ uri: "/users" })], { ...CONFIG });
    const before = JSON.stringify(collection);
    const stats = await enrichCatalogWithFormRequests(collection, new Map());

    expect(stats.bodyVariants).toBe(0);
    expect(JSON.stringify(collection)).toBe(before);
  });

  test("cuenta como no resuelto lo que no encuentra", async () => {
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

  test("una colección vacía devuelve estadísticas en cero", async () => {
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
// toPostmanUri — conversión de parámetros y normalización de barras
// ---------------------------------------------------------------------------

describe("toPostmanUri", () => {
  test("convierte parámetros Laravel en variables Postman", () => {
    expect(toPostmanUri("api/clientes/{cliente}")).toBe("/clientes/{{cliente}}");
  });

  test("descarta la regex de los parámetros con constraint", () => {
    expect(toPostmanUri("api/fabricantes/{fabricante:tecdoc_id}")).toBe(
      "/fabricantes/{{fabricante}}",
    );
  });

  test("quita el prefijo api/ con o sin barra inicial", () => {
    expect(toPostmanUri("api/pedidos")).toBe("/pedidos");
    expect(toPostmanUri("/api/pedidos")).toBe("/pedidos");
  });

  test("normaliza dobles barras y trailing slash", () => {
    expect(toPostmanUri("api//doble///barra/")).toBe("/doble/barra");
  });

  test("la raíz se conserva como /", () => {
    expect(toPostmanUri("/")).toBe("/");
    expect(toPostmanUri("api/")).toBe("/");
  });

  test("una uri sin api/ se deja tal cual", () => {
    expect(toPostmanUri("login")).toBe("/login");
  });
});

// ---------------------------------------------------------------------------
// discoverEndpoints + routeToSpec sobre un proyecto Laravel temporal
// ---------------------------------------------------------------------------

/**
 * Controlador con todas las formas de firma que el parser distingue:
 * FormRequest importado, importado con alias, Request genérico de
 * Illuminate y parámetro sin tipar.
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
        // Método protegido con FormRequest fuera de app/Http/Requests:
        // el resolver de ruta lo rechaza y cae al fallback por convención.
    }

    public function auditar(GestorRequest $peticion)
    {
        // Alias terminado en Request apuntando a una clase que NO
        // termina en Request: el FQCN no se acepta como FormRequest.
    }

    public function store(CrearUsuarioRequest $peticion)
    {
        // FormRequest vía import directo.
    }

    public function update(UpdateRequest $peticion)
    {
        // FormRequest vía import con alias terminado en Request.
    }

    public function destroy($usuario)
    {
        // Parámetro sin tipar: se cae a la convención de nombres.
    }

    public function activar(Request $peticion)
    {
        // Illuminate\\Http\\Request genérico: NO cuenta como FormRequest.
    }

    public function buscarAlta(Request $peticion)
    {
        // Método camelCase para el humanizado del nombre.
    }

    public function importar(\App\Http\Requests\Usuarios\ImportarUsuarioRequest $peticion)
    {
        // FormRequest tipado con el FQCN completo inline (sin import).
    }
}
`;

const RUTAS_USUARIOS = `<?php

use Illuminate\\Support\\Facades\\Route;
use App\\Http\\Controllers\\UsuarioController;
use App\\Http\\Controllers\\PedidoController;

Route::get('usuarios', [UsuarioController::class, 'index']);
Route::post('usuarios', [UsuarioController::class, 'store']);
// Segunda ruta hacia la misma acción: el cache de reglas del
// FormRequest debe reutilizarse entre ambas.
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

describe("discoverEndpoints sobre un proyecto temporal", () => {
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

  test("convierte las rutas en specs con uri Postman y nombre legible", async () => {
    const res = await descubre();
    expect(res.routes).toHaveLength(11);
    expect(res.specs).toHaveLength(11);

    const specDe = (metodo: string, uri: string): EndpointSpec | undefined =>
      res.specs.find((s) => s.method === metodo && s.uri === uri);

    expect(specDe("GET", "/usuarios")?.name).toBe("Listar Usuarios");
    expect(specDe("GET", "/usuarios")?.folder).toBe("Usuarios");
    expect(specDe("PUT", "/usuarios/{{usuario}}")?.name).toBe("Actualizar Usuarios");
    expect(specDe("DELETE", "/usuarios/{{usuario}}")?.name).toBe("Eliminar Usuarios");
    // Método fuera de las etiquetas conocidas + recurso de dos palabras.
    expect(specDe("GET", "/usuarios/buscar-alta")?.name).toContain("Buscar Alta");

    const pedidos = specDe("GET", "/pedidos");
    expect(pedidos?.name).toBe("Listar Pedidos");
    expect(pedidos?.folder).toBe("Pedidos");
  });

  test("el body sale del FormRequest mínimo para POST y PUT", async () => {
    const res = await descubre();
    const crear = res.specs.find((s) => s.method === "POST" && s.uri === "/usuarios");
    expect(crear?.formRequest).toBe("app/Http/Requests/Usuarios/CrearUsuarioRequest.php");
    expect(crear?.body).toEqual({
      name: "sample_name",
      email: "user@example.com",
    });
    expect(crear?.description).toBe("Auto · CrearUsuarioRequest");

    // update: FormRequest resuelto vía alias; sin campos required, el
    // body mínimo está vacío y se cae al completo.
    const actualizar = res.specs.find((s) => s.method === "PUT");
    expect(actualizar?.formRequest).toBe(
      "app/Http/Requests/Usuarios/ActualizarUsuarioRequest.php",
    );
    expect(actualizar?.body).toEqual({ nombre: "sample_nombre" });
  });

  test("el fallback por convención encuentra el FormRequest del destroy", async () => {
    // DestroyUsuarioRequest no está importado en el controlador y el
    // parámetro no tiene tipo: se localiza por convención de nombre
    // (destroy → Destroy… + recurso Usuario en app/Http/Requests).
    const res = await descubre();
    const borrar = res.specs.find((s) => s.method === "DELETE");
    expect(borrar?.formRequest).toBe("app/Http/Requests/DestroyUsuarioRequest.php");
    expect(borrar?.description).toBe("Auto · DestroyUsuarioRequest");
    // DELETE no es POST/PUT/PATCH: la descripción entra, el body no.
    expect(borrar?.body).toBeUndefined();
  });

  test("sin FormRequest ni por firma ni por convención el spec queda pelado", async () => {
    const res = await descubre();
    const index = res.specs.find((s) => s.method === "GET" && s.uri === "/usuarios");
    expect(index?.formRequest).toBeUndefined();
    expect(index?.body).toBeUndefined();
    expect(index?.description).toBeUndefined();

    // Request genérico de Illuminate: no genera FormRequest.
    const activar = res.specs.find((s) => s.uri.endsWith("/activar"));
    expect(activar?.formRequest).toBeUndefined();
    // El nombre usa el último segmento significativo, no el prefijo.
    expect(activar?.name).toBe("Activar Activar");
  });

  test("los métodos con body solo lo llevan en POST/PUT/PATCH", async () => {
    const res = await descubre();
    // GET con FormRequest no recibe body: solo POST/PUT/PATCH. Hay
    // cuatro POST con reglas (store×2, import, sincronizar) y un PUT.
    const conCuerpo = res.specs.filter((s) => s.body !== undefined).map((s) => s.method);
    expect(conCuerpo.sort()).toEqual(["POST", "POST", "POST", "POST", "PUT"]);
  });

  test("los contadores conFormRequest / sinFormRequest cuadran con los specs", async () => {
    const res = await descubre();
    // store×2, update, destroy, import, sincronizar = 6 con FormRequest;
    // index, activar, buscarAlta, auditar (alias que no apunta a un
    // FormRequest) y pedidos.index = 5 sin FormRequest.
    expect(res.withFormRequest).toBe(6);
    expect(res.withoutFormRequest).toBe(5);
    expect(res.withFormRequest + res.withoutFormRequest).toBe(res.specs.length);
  });

  test("un alias Request cuyo FQCN no es un FormRequest no resuelve nada", async () => {
    // El import `use App\Models\Gestor as GestorRequest` hace que el
    // parser de firmas apunte a App\Models\Gestor: resolveFormRequestPath
    // lo rechaza y la convención tampoco encuentra nada.
    const res = await descubre();
    const auditar = res.specs.find((s) => s.uri.endsWith("/auditar"));
    expect(auditar?.formRequest).toBeUndefined();
    expect(auditar?.body).toBeUndefined();
    expect(auditar?.description).toBeUndefined();
  });

  test("el fallback por convención también cubre verbos con camelCase", async () => {
    // `sincronizar` importa un modelo (no un FormRequest de Http\Requests):
    // resolveFormRequestPath lo rechaza y la resolución cae en la
    // convención de nombres, donde `SincronizarRequest` casa.
    const res = await descubre();
    const sincronizar = res.specs.find((s) => s.uri.endsWith("/sincronizar"));
    expect(sincronizar?.formRequest).toBe("app/Http/Requests/SincronizarRequest.php");
    expect(sincronizar?.description).toBe("Auto · SincronizarRequest");
  });

  test("los overrides manuales ganan pero conservan el formRequest", async () => {
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

  test("un proyecto sin carpeta routes devuelve todo vacío sin romper", async () => {
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
// enrichCatalogWithFormRequests — rutas de enriquecimiento no recorridas
// ---------------------------------------------------------------------------

describe("enrichCatalogWithFormRequests — enriquecimiento real", () => {
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
   * El endpoint vive dentro de su carpeta: buildCollection envuelve cada
   * grupo en un item con `item`. El enriquecer muta ese nodo interior.
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

  test("GET con reglas de búsqueda genera variantes de query y envuelve el item", async () => {
    const { collection, stats } = await enriquecer(
      [spec({ name: "Listar Usuarios", method: "GET", uri: "/usuarios" })],
      new Map([["GET usuarios", "app/Http/Requests/ListarUsuarioRequest.php"]]),
    );
    expect(stats.resolved).toBe(1);
    expect(stats.queryVariants).toBe(2);
    expect(stats.bodyVariants).toBe(0);

    // El nodo del endpoint queda convertido en carpeta [base, Variantes].
    const nodo = nodoEndpoint(collection);
    expect(nodo?.item).toBeDefined();
    expect(nodo?.item?.[0]?.name).toBe("Listar Usuarios (base)");
    const contenedor = nodo?.item?.[1];
    expect(contenedor?.name).toContain("ListarUsuarioRequest");
    const queries = contenedor?.item?.map(
      (v) => v.request?.url.query?.map((q) => q.key) ?? [],
    );
    // La variante "Básica" usa el PRIMER campo filtrable del rules():
    // aquí `nombre` (el segundo trae todos los campos).
    expect(queries).toEqual([["nombre"], ["nombre", "busqueda"]]);
  });

  test("POST enriquece con variantes de body, deduplicando la de enum", async () => {
    const { collection, stats } = await enriquecer(
      [spec({ name: "Crear Usuario", method: "POST", uri: "/usuarios" })],
      new Map([["POST usuarios", "app/Http/Requests/StoreUsuarioRequest.php"]]),
    );
    expect(stats.resolved).toBe(1);
    // Mínimo + enum inactivo: la variante enum=activo coincide con el
    // mínimo y se deduplica; el completo también coincide y no entra.
    expect(stats.bodyVariants).toBe(2);

    const variantes = nodoEndpoint(collection)?.item?.[1]?.item ?? [];
    expect(variantes.map((v) => v.name)).toEqual([
      "Variante: Mínimo (solo required)" + VARIANT_TAG,
      "Variante: Enum estado=inactivo" + VARIANT_TAG,
    ]);
    const bodies = variantes.map((v) => JSON.parse(v.request?.body?.raw ?? "{}"));
    expect(bodies).toEqual([
      { name: "sample_name", estado: "activo" },
      { name: "sample_name", estado: "inactivo" },
    ]);
    // Cada variante lleva su Content-Type.
    expect(variantes[0]?.request?.header.some((h) => h.key === "Content-Type")).toBe(true);
  });

  test("la adivinanza por nombre crea candidatos Store a partir de Crear", async () => {
    // Índice con un FormRequest que no existe: la resolución cae en la
    // heurística de nombres y encuentra StoreUsuarioRequest.
    const { collection, stats } = await enriquecer(
      [spec({ name: "Crear Usuario", method: "POST", uri: "/usuarios" })],
      new Map([["POST usuarios", "app/Http/Requests/NoExiste.php"]]),
    );
    expect(stats.resolved).toBe(1);
    expect(stats.bodyVariants).toBeGreaterThan(0);
    expect(nodoEndpoint(collection)?.item).toBeDefined();
  });

  test("PATCH sin required genera vacío + completo + variantes de enum", async () => {
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

  test("GET sin variantes de query no reestructura el item", async () => {
    // PutUsuarioRequest solo tiene `estado` con `in:`: ninguna regla
    // tipada entra en generateQueryVariants y el nodo queda intacto.
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

  test("las reglas dinámicas se acumulan en rulesWithUnknown", async () => {
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

  test("un FormRequest inexistente se cuenta como no resuelto", async () => {
    const { stats } = await enriquecer(
      [spec({ name: "Ver Usuario", method: "GET", uri: "/usuarios/{{id}}" })],
      new Map([["GET usuarios/:p", "app/Http/Requests/VaciaRequest.php"]]),
    );
    expect(stats.resolved).toBe(0);
    expect(stats.unresolved).toBe(1);
  });

  test("DELETE con reglas resueltas se cuenta pero no genera variantes", async () => {
    const { stats } = await enriquecer(
      [spec({ name: "Eliminar Usuario", method: "DELETE", uri: "/usuarios/{{id}}" })],
      new Map([["DELETE usuarios/:p", "app/Http/Requests/StoreUsuarioRequest.php"]]),
    );
    expect(stats.resolved).toBe(1);
    expect(stats.bodyVariants).toBe(0);
    expect(stats.queryVariants).toBe(0);
  });

  test("Eliminar resuelve por la adivinanza Destroy cuando el índice falla", async () => {
    let collection: ReturnType<typeof buildCollection>;
    collection = buildCollection(
      [spec({ name: "Eliminar Usuario", method: "DELETE", uri: "/usuarios/{{id}}" })],
      { ...CONFIG },
    );
    // Índice sin archivo: la resolución recae en la heurística de
    // nombres (Eliminar → DestroyUsuarioRequest del fixture principal).
    const stats = await enrichCatalogWithFormRequests(
      collection,
      new Map([["DELETE usuarios/:p", "app/Http/Requests/NoExisteRequest.php"]]),
      contexto,
    );
    expect(stats.resolved).toBe(1);
  });

  test("un body manual se conserva como base y se cuenta en skippedManualBody", async () => {
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

  test("un endpoint que no casa ni por índice ni por nombre queda sin tocar", async () => {
    const { collection, stats } = await enriquecer(
      [spec({ name: "Operacion Rara", method: "POST", uri: "/raro" })],
      new Map([["POST raro", "app/Http/Requests/NoExisteRequest.php"]]),
    );
    expect(stats.resolved).toBe(0);
    expect(stats.unresolved).toBe(1);
    expect(nodoEndpoint(collection)?.item).toBeUndefined();
  });

  test("un FormRequest sin reglas cuenta como no enriquecible", async () => {
    // VaciarRequest devuelve `[]`: `loadFormRequest` lo parsea, lo ve
    // vacío (isEmpty) y devuelve null → el endpoint queda sin resolver
    // y el nodo intacto.
    const { collection, stats } = await enriquecer(
      [spec({ name: "Vaciar Usuarios", method: "POST", uri: "/usuarios/vaciar", body: { a: 1 } })],
      new Map([["POST usuarios/vaciar", "app/Http/Requests/VaciarRequest.php"]]),
    );
    expect(stats.resolved).toBe(0);
    expect(stats.unresolved).toBe(1);
    expect(nodoEndpoint(collection)?.item).toBeUndefined();
  });
});
