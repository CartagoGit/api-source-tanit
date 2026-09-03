import { describe, expect, test } from "vitest";
import { buildSpecsFromScanner, toPostmanUri } from "../../packages/core/adapters/parsed-route-to-spec.adapter";
import type {
  IProjectMatch,
  IRouteScanner,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute,
} from "../../packages/contracts/interfaces/core/scanner.interface";

const MATCH: IProjectMatch = {
  framework: "demo",
  projectRoot: "/tmp/demo",
  artifacts: [],
};

/**
 * El `body` de un `EndpointSpec` es `unknown` a propósito: el adapter
 * emite JSON arbitrario. Para afirmar sobre un campo concreto hay que
 * decirle a TypeScript que se lee como un objeto.
 */
function bodyOf(spec: { body?: unknown } | undefined): Record<string, unknown> {
  return (spec?.body ?? {}) as Record<string, unknown>;
}

function route(partial: Partial<ParsedRoute>): ParsedRoute {
  return {
    method: "GET",
    uri: "/items",
    rawUri: "/items",
    sourceFile: "src/routes.ts",
    lineNumber: 1,
    prefixChain: [],
    ...partial,
  };
}

function scannerOf(routes: ParsedRoute[]): IRouteScanner {
  return {
    framework: "demo",
    matches: () => true,
    scan: async () => routes,
  };
}

function providerOf(
  fields: IValidationSpec[],
  options: { throws?: boolean } = {},
): IValidationSpecProvider {
  return {
    framework: "demo",
    supports: async () => true,
    resolve: async (r) => {
      if (options.throws) throw new Error("provider roto");
      return { endpointKey: `${r.method} ${r.uri}`, fields };
    },
  };
}

const field = (partial: Partial<IValidationSpec>): IValidationSpec => ({
  fieldName: "name",
  location: "body",
  type: "string",
  required: true,
  ...partial,
});

describe("toPostmanUri — normalización de parámetros", () => {
  test.each([
    ["/users/{id}", "/users/{{id}}"],
    ["/users/:id", "/users/{{id}}"],
    ["/users/<id>", "/users/{{id}}"],
    ["/users/<int:id>", "/users/{{id}}"],
    ["/users/<str:slug>", "/users/{{slug}}"],
    ["/users/<uuid:token>", "/users/{{token}}"],
  ])("%s → %s", (input, expected) => {
    expect(toPostmanUri(input)).toBe(expected);
  });

  // `<int:id>` debe procesarse ANTES que `:param`, o el `:id` interior
  // rompería el token en `<int{{id}}>`.
  test("un conversor de Django no se rompe por el patrón de Express", () => {
    expect(toPostmanUri("/api/<int:id>/edit")).toBe("/api/{{id}}/edit");
  });

  test("una variable que ya es {{x}} no se duplica", () => {
    expect(toPostmanUri("/users/{{id}}")).toBe("/users/{{id}}");
  });

  test("añade la barra inicial si falta", () => {
    expect(toPostmanUri("users")).toBe("/users");
  });

  test("colapsa las barras repetidas", () => {
    expect(toPostmanUri("/api//users")).toBe("/api/users");
  });

  // Django declara la barra final a propósito (APPEND_SLASH).
  test("conserva la barra final", () => {
    expect(toPostmanUri("/users/")).toBe("/users/");
  });

  test("varios parámetros en la misma uri", () => {
    expect(toPostmanUri("/users/{userId}/posts/{postId}")).toBe(
      "/users/{{userId}}/posts/{{postId}}",
    );
  });

  test("no toca un path sin parámetros", () => {
    expect(toPostmanUri("/health")).toBe("/health");
  });
});

/**
 * Un proveedor de validación que **falla**.
 *
 * Antes se tragaba la excepción y devolvía `null`, con lo que el
 * endpoint quedaba exactamente igual que uno que legítimamente no tiene
 * reglas. Un parser roto —un cambio de sintaxis en el framework, un
 * fichero que ya no se puede leer— degradaba la colección entera en
 * silencio: lo único que cambiaba era un contador que nadie mira.
 */
describe("un proveedor de validación que revienta", () => {
  const proveedorRoto = {
    framework: "test",
    supports: async () => true,
    resolve: async () => {
      throw new Error("el parser no supo leer el fichero");
    },
  };

  test("no tumba la generación: el endpoint sale igual", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "POST", uri: "/users" })]),
      MATCH,
      proveedorRoto,
    );
    expect(result.specs).toHaveLength(1);
  });

  /** EL test: el fallo se anota en vez de desaparecer. */
  test("pero queda anotado, con el endpoint y el motivo", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "POST", uri: "/users" })]),
      MATCH,
      proveedorRoto,
    );
    expect(result.validationFailures).toHaveLength(1);
    expect(result.validationFailures[0]).toContain("POST /users");
    expect(result.validationFailures[0]).toContain("no supo leer");
  });

  test("y no se confunde con un endpoint sin reglas", async () => {
    const sinReglas = await buildSpecsFromScanner(
      scannerOf([route({ method: "POST", uri: "/users" })]),
      MATCH,
      null,
    );
    expect(sinReglas.validationFailures).toEqual([]);
    expect(sinReglas.withoutFormRequest).toBe(1);
  });
});

describe("buildSpecsFromScanner — conversión de rutas", () => {
  test("convierte cada ruta en un spec", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "GET", uri: "/users" })]),
      MATCH,
      null,
    );
    expect(result.specs).toHaveLength(1);
    expect(result.specs[0]).toMatchObject({ method: "GET", uri: "/users" });
  });

  test("descarta los verbos que Postman no va a usar", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([
        route({ method: "GET" }),
        route({ method: "TRACE" }),
        route({ method: "CONNECT" }),
      ]),
      MATCH,
      null,
    );
    expect(result.specs).toHaveLength(1);
  });

  test("normaliza el método a mayúsculas", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "post" })]),
      MATCH,
      null,
    );
    expect(result.specs[0]?.method).toBe("POST");
  });

  test("el primer tag se convierte en carpeta", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ tags: ["Usuarios", "Admin"] })]),
      MATCH,
      null,
    );
    expect(result.specs[0]?.folder).toBe("Usuarios");
  });

  test("propaga la descripción de la ruta", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ description: "Lista de usuarios" })]),
      MATCH,
      null,
    );
    expect(result.specs[0]?.description).toBe("Lista de usuarios");
  });

  // Un path param en `query` produciría `/users/{{id}}?id=1`, que no es
  // la ruta declarada. Se resuelven como variables de colección.
  test("los parámetros de path NO se emiten como query string", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ uri: "/users/{id}" })]),
      MATCH,
      null,
    );
    expect(result.specs[0]?.query ?? []).toEqual([]);
    expect(result.specs[0]?.uri).toBe("/users/{{id}}");
  });

  test("una lista vacía produce cero specs", async () => {
    const result = await buildSpecsFromScanner(scannerOf([]), MATCH, null);
    expect(result.specs).toEqual([]);
    expect(result.routes).toEqual([]);
  });
});

describe("buildSpecsFromScanner — reglas de validación", () => {
  test("los campos required forman el body de un POST", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "POST", uri: "/users" })]),
      MATCH,
      providerOf([field({ fieldName: "name" }), field({ fieldName: "email" })]),
    );
    expect(Object.keys(result.specs[0]?.body ?? {})).toEqual(["name", "email"]);
  });

  test("los campos opcionales quedan fuera del body de ejemplo", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "POST" })]),
      MATCH,
      providerOf([
        field({ fieldName: "name" }),
        field({ fieldName: "nota", required: false }),
      ]),
    );
    expect(Object.keys(result.specs[0]?.body ?? {})).toEqual(["name"]);
  });

  test("un GET no recibe body aunque haya reglas", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "GET" })]),
      MATCH,
      providerOf([field({})]),
    );
    expect(result.specs[0]?.body).toBeUndefined();
  });

  test("los campos header salen como headers", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "POST" })]),
      MATCH,
      providerOf([field({ fieldName: "X-Api-Key", location: "header" })]),
    );
    expect(result.specs[0]?.headers?.map((h) => h.key)).toEqual(["X-Api-Key"]);
  });

  test("los campos query se añaden a la query", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "GET" })]),
      MATCH,
      providerOf([field({ fieldName: "page", location: "query", type: "integer" })]),
    );
    expect(result.specs[0]?.query?.map((q) => q.key)).toContain("page");
  });

  // a00010 / B-01: las reglas con `location: "path"` NO deben acabar en
  // `spec.query` — el path param ya viaja en la URI y se documenta vía
  // `spec.fields` con `location: "path"`.
  test("los campos path NO se añaden a query (B-01 a00010)", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "GET", uri: "/users/{{id}}" })]),
      MATCH,
      providerOf([
        field({ fieldName: "id", location: "path", type: "string", required: true }),
      ]),
    );
    const spec = result.specs[0];
    expect(spec?.query ?? []).toEqual([]);
    const pathFields = (spec?.fields ?? []).filter((f) => f.location === "path");
    expect(pathFields.map((f) => f.fieldName)).toEqual(["id"]);
  });

  // Combinado: una ruta con un path param y un query param real.
  // Solo el query param debe llegar a `spec.query`.
  test("mezcla de path y query: solo query llega a spec.query", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "GET", uri: "/users/{{id}}" })]),
      MATCH,
      providerOf([
        field({ fieldName: "id", location: "path", type: "string", required: true }),
        field({ fieldName: "include", location: "query", type: "string", required: false }),
      ]),
    );
    const spec = result.specs[0];
    expect(spec?.query?.map((q) => q.key)).toEqual(["include"]);
    expect((spec?.fields ?? []).filter((f) => f.location === "path").map((f) => f.fieldName)).toEqual(["id"]);
  });

  test("cuenta los endpoints con y sin reglas", async () => {
    const withRules = await buildSpecsFromScanner(
      scannerOf([route({ method: "POST" })]),
      MATCH,
      providerOf([field({})]),
    );
    expect(withRules.withFormRequest).toBe(1);
    expect(withRules.withoutFormRequest).toBe(0);

    const withoutRules = await buildSpecsFromScanner(
      scannerOf([route({ method: "POST" })]),
      MATCH,
      providerOf([]),
    );
    expect(withoutRules.withFormRequest).toBe(0);
    expect(withoutRules.withoutFormRequest).toBe(1);
  });

  // Un provider que peta no debe tumbar la generación entera.
  test("un provider que lanza no rompe el escaneo", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "POST" })]),
      MATCH,
      providerOf([], { throws: true }),
    );
    expect(result.specs).toHaveLength(1);
    expect(result.withoutFormRequest).toBe(1);
  });
});

describe("buildSpecsFromScanner — valores de ejemplo", () => {
  test("un email usa un ejemplo con formato de email", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "POST" })]),
      MATCH,
      providerOf([field({ fieldName: "email", format: "email" })]),
    );
    expect(String(bodyOf(result.specs[0])["email"])).toContain("@");
  });

  test("un enum usa su primer valor", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "POST" })]),
      MATCH,
      providerOf([field({ fieldName: "role", type: "enum", enumValues: ["admin", "user"] })]),
    );
    expect(bodyOf(result.specs[0])["role"]).toBe("admin");
  });

  test("un booleano usa true", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "POST" })]),
      MATCH,
      providerOf([field({ fieldName: "activo", type: "boolean" })]),
    );
    expect(bodyOf(result.specs[0])["activo"]).toBe(true);
  });

  test("un header Authorization apunta a {{token}}", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "POST" })]),
      MATCH,
      providerOf([field({ fieldName: "Authorization", location: "header" })]),
    );
    expect(result.specs[0]?.headers?.[0]?.value).toBe("{{token}}");
  });
});
