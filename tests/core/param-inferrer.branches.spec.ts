/**
 * Fallback and error branches of the agnostic inferrer.
 *
 * The main spec (`param-inferrer.spec.ts`) walks the happy path of
 * each heuristic; this one covers decisions that only happen with
 * rare inputs: field names of each dictionary family, empty or
 * single-segment URIs, variables already declared by the host, and
 * specs with FormRequest versus `overrideExisting`.
 */
import { describe, expect, test } from "vitest";

import {
  _internals,
  applyAgnosticInference,
  exampleForPathParam,
  exampleForQueryField,
  extractPathParams,
  inferBodyForSpec,
  inferCollectionVariables,
  inferQueryForSpec,
} from "../../packages/core/domain/param-inferrer.service";
import type { EndpointSpec } from "../../packages/contracts/interfaces/core/postman.interface";

/** Helper to build a minimal EndpointSpec in tests. */
function spec(partial: Partial<EndpointSpec>): EndpointSpec {
  return {
    method: "GET",
    uri: "/x",
    headers: [],
    query: [],
    body: null,
    formRequest: null,
    ...partial,
  } as EndpointSpec;
}

describe("exampleForPathParam — each family of the dictionary", () => {
  test("license plate gives a plausible plate", () => {
    expect(exampleForPathParam("matricula")).toBe("1234ABC");
    expect(exampleForPathParam("n_matricula")).toBe("1234ABC");
  });

  test("n_* and quantity yield numbers", () => {
    expect(exampleForPathParam("n_pedidos")).toBe("10");
    expect(exampleForPathParam("cantidad")).toBe("10");
  });

  test("price gives a decimal", () => {
    expect(exampleForPathParam("precio_unitario")).toBe("19.99");
  });

  test("url* gives a URL even when the name is still odd", () => {
    expect(exampleForPathParam("url_callback")).toBe("https://example.com");
  });

  test("the first matching pattern wins: codigo_ hits before url", () => {
    // `codigo_proveedor` is already documented in the main spec; here
    // the other dictionary collision: `url` comes after `codigo`.
    expect(exampleForPathParam("codigo_url")).toBe("CODIGO001");
  });
});

describe("exampleForQueryField — each dictionary hint", () => {
  test("searches and free text", () => {
    expect(exampleForQueryField("q")).toBe("ejemplo");
    expect(exampleForQueryField("search")).toBe("ejemplo");
    expect(exampleForQueryField("busqueda")).toBe("ejemplo");
    expect(exampleForQueryField("query")).toBe("ejemplo");
  });

  test("identifiers and codes", () => {
    expect(exampleForQueryField("id")).toBe("1");
    expect(exampleForQueryField("codigo")).toBe("COD001");
    expect(exampleForQueryField("cif")).toBe("COD001");
    expect(exampleForQueryField("nif")).toBe("COD001");
  });

  test("names and emails", () => {
    expect(exampleForQueryField("nombre")).toBe("Nombre de prueba");
    expect(exampleForQueryField("razon_social")).toBe("Nombre de prueba");
    expect(exampleForQueryField("email")).toBe("user@example.com");
  });

  test("pagination and ordering", () => {
    expect(exampleForQueryField("page")).toBe("1");
    expect(exampleForQueryField("pagina")).toBe("1");
    expect(exampleForQueryField("per_page")).toBe("10");
    expect(exampleForQueryField("items_por_pagina")).toBe("10");
    expect(exampleForQueryField("limit")).toBe("10");
    expect(exampleForQueryField("offset")).toBe("0");
    expect(exampleForQueryField("sort")).toBe("id");
    expect(exampleForQueryField("order_by")).toBe("id");
    expect(exampleForQueryField("direction")).toBe("asc");
    expect(exampleForQueryField("order")).toBe("asc");
  });

  test("status, relations, language and dates", () => {
    expect(exampleForQueryField("status")).toBe("active");
    expect(exampleForQueryField("estado")).toBe("active");
    expect(exampleForQueryField("activo")).toBe("true");
    expect(exampleForQueryField("active")).toBe("true");
    expect(exampleForQueryField("with")).toBe("all");
    expect(exampleForQueryField("include")).toBe("all");
    expect(exampleForQueryField("lang")).toBe("es");
    expect(exampleForQueryField("locale")).toBe("es");
    expect(exampleForQueryField("fecha_inicio")).toBe("2024-01-01");
    expect(exampleForQueryField("from")).toBe("2024-01-01");
    expect(exampleForQueryField("since")).toBe("2024-01-01");
    expect(exampleForQueryField("fecha_fin")).toBe("2024-12-31");
    expect(exampleForQueryField("to")).toBe("2024-12-31");
    expect(exampleForQueryField("until")).toBe("2024-12-31");
  });
});

describe("exampleForBodyField — family by family (via _internals)", () => {
  const ejemplo = (name: string, hint?: string) =>
    _internals.exampleForBodyField(name, hint);

  test("the id/codigo hint overrides every other heuristic", () => {
    expect(ejemplo(" DepartamentoId ", "id")).toBe("1");
    expect(ejemplo("linea", "codigo")).toBe("1");
    // Hint without id semantics: falls back to name heuristics.
    expect(ejemplo("otra_cosa", "denominacion")).toBe("sample_otra_cosa");
  });

  test("identifier suffixes without a hint", () => {
    expect(ejemplo("usuario_id")).toBe("1");
    expect(ejemplo("producto_codigo")).toBe("COD001");
    // camelCase variants of the suffixes also match: the suffix with
    // uppercase is compared against the ORIGINAL name, not against
    // the lowercase copy (where it could never fit).
    expect(ejemplo("DepartamentoId")).toBe("1");
    expect(ejemplo("departamentoId")).toBe("1");
    expect(ejemplo("DepartamentoCodigo")).toBe("COD001");
    // A name ending in lowercase "id" by pure morphology is not an
    // identifier: only the exact suffix (`_id` / `Id`) triggers the
    // heuristic.
    expect(ejemplo("madrid")).toBe("sample_madrid");
  });

  test("contact and credential fields", () => {
    expect(ejemplo("email")).toBe("user@example.com");
    expect(ejemplo("password")).toBe("********");
    expect(ejemplo("pass")).toBe("********");
    expect(ejemplo("contrasena")).toBe("********");
  });

  test("generic texts", () => {
    expect(ejemplo("name")).toBe("Nombre de prueba");
    expect(ejemplo("nombre")).toBe("Nombre de prueba");
    expect(ejemplo("description")).toBe("Descripción de ejemplo");
    expect(ejemplo("descripcion")).toBe("Descripción de ejemplo");
    expect(ejemplo("notes")).toBe("Notas");
    expect(ejemplo("notas")).toBe("Notas");
  });

  test("URLs, dates and amounts", () => {
    expect(ejemplo("url")).toBe("https://example.com");
    expect(ejemplo("webhook_url")).toBe("https://example.com");
    expect(ejemplo("date")).toBe("2024-01-15");
    expect(ejemplo("updated_at")).toBe("2024-01-15");
    expect(ejemplo("fecha")).toBe("2024-01-15");
    expect(ejemplo("amount")).toBe(19.99);
    expect(ejemplo("total")).toBe(19.99);
    expect(ejemplo("precio")).toBe(19.99);
    expect(ejemplo("importe")).toBe(19.99);
    expect(ejemplo("quantity")).toBe(1);
    expect(ejemplo("cantidad")).toBe(1);
  });

  test("booleans by dictionary and by prefix", () => {
    expect(ejemplo("visible")).toBe(true);
    expect(ejemplo("publico")).toBe(true);
    expect(ejemplo("default")).toBe(true);
    expect(ejemplo("principal")).toBe(true);
    expect(ejemplo("notificar")).toBe(true);
    expect(ejemplo("force")).toBe(true);
    expect(ejemplo("aplicar")).toBe(true);
    expect(ejemplo("reindexar")).toBe(true);
    expect(ejemplo("is_admin")).toBe(true);
    expect(ejemplo("has_stock")).toBe(true);
  });

  test("arrays by dictionary and text fallback", () => {
    expect(ejemplo("tags")).toEqual([1]);
    expect(ejemplo("categorias")).toEqual([1]);
    expect(ejemplo("categories")).toEqual([1]);
    expect(ejemplo("items")).toEqual([1]);
    expect(ejemplo("productos")).toEqual([1]);
    expect(ejemplo("usuarios")).toEqual([1]);
    expect(ejemplo("clientes")).toEqual([1]);
    expect(ejemplo("ids")).toEqual([1]);
    expect(ejemplo("mot libre")).toBe("sample_mot libre");
  });
});

describe("inferBodyForSpec — URI-shape branches", () => {
  test("POST with a single action-verb segment → light body", () => {
    // Without path params up front: the action lives alone in `last`.
    const resultado = inferBodyForSpec(spec({ method: "POST", uri: "/reset" }));
    expect(resultado?.body).toEqual({ force: true });
    expect(resultado?.reason).toContain("reset");
  });

  test("each alternative of the action regex is walked with its verb", () => {
    for (const [uri, verbo] of [
      ["/tareas/{{id}}/ejecutar", "ejecutar"],
      ["/informes/mensual/publicar", "publicar"],
      ["/articulos/{{id}}/restaurar", "restaurar"],
    ] as const) {
      const resultado = inferBodyForSpec(spec({ method: "POST", uri }));
      expect(resultado?.body.force, uri).toBe(true);
      expect(resultado?.reason, uri).toContain(verbo);
    }
  });

  test("the 'no expected body' family includes desactivar", () => {
    const resultado = inferBodyForSpec(
      spec({ method: "POST", uri: "/sesion/desactivar" }),
    );
    expect(resultado?.body).toEqual({});
    expect(resultado?.reason).toContain("sin body");
  });

  test("root URI: no segments does not crash and yields an empty generic body", () => {
    const resultado = inferBodyForSpec(spec({ method: "POST", uri: "/" }));
    expect(resultado).not.toBeNull();
    expect(resultado?.body).toEqual({});
    expect(resultado?.reason).toContain("POST");
  });

  test("single-segment URI: there is no resource to talk about", () => {
    const resultado = inferBodyForSpec(
      spec({ method: "POST", uri: "/productos" }),
    );
    expect(resultado?.body).toEqual({});
  });

  test("single-segment PUT also falls to the empty generic body", () => {
    expect(inferBodyForSpec(spec({ method: "PUT", uri: "/ajustes" }))?.body).toEqual({});
  });

  test("HEAD and OPTIONS do not carry a body", () => {
    expect(inferBodyForSpec(spec({ method: "HEAD", uri: "/x" }))).toBeNull();
    expect(inferBodyForSpec(spec({ method: "OPTIONS", uri: "/x" }))).toBeNull();
  });
});

describe("inferQueryForSpec — URI-shape branches", () => {
  test("root URI: without a last segment falls back to standard pagination", () => {
    const claves = inferQueryForSpec(spec({ method: "GET", uri: "/" })).map(
      (q) => q.key,
    );
    expect(claves).toEqual(["pagina", "items_por_pagina", "q"]);
  });

  test("the 'no pagination' list walks its alternatives", () => {
    // The list lives in a regex over the LAST segment: `csv` for
    // `/exportar/csv` (the verb `exportar` is before) and `historial`
    // on its own. `alarmas` is not in the list and falls to the default.
    const casos: Array<[string, ReadonlyArray<string>]> = [
      ["/exportar/csv", ["q"]],
      ["/pedidos/historial", ["q"]],
      ["/log", ["q"]],
      ["/auth-test", ["q"]],
      ["/blacklist", ["q"]],
      ["/codigos", ["q"]],
      ["/alarmas", ["pagina", "items_por_pagina", "q"]],
    ];
    for (const [uri, esperadas] of casos) {
      const claves = inferQueryForSpec(spec({ method: "GET", uri })).map(
        (q) => q.key,
      );
      expect(claves, uri).toEqual(esperadas);
    }
  });

  test("POST does not generate query even with path params", () => {
    expect(
      inferQueryForSpec(spec({ method: "POST", uri: "/users/{{id}}" })),
    ).toEqual([]);
  });
});

describe("inferCollectionVariables — host and discovered coexist", () => {
  test("minimal base with no external input", () => {
    // a00012 S4: the default baseUrl is the bare origin
    // (`DEFAULT_BASE_URL` = "http://localhost"). The `/api` is no
    // longer added automatically; it is contributed by an explicit
    // source when one exists.
    expect(inferCollectionVariables([])).toEqual([
      { key: "baseUrl", value: "http://localhost", type: "string" },
      { key: "token", value: "", type: "string" },
    ]);
  });

  test("the value declared by the host is respected, including the type", () => {
    const variables = inferCollectionVariables([], [
      { key: "baseUrl", value: "https://produccion.dev/api" },
      { key: "token", value: "predefined", type: "secret" },
    ]);
    const porClave = new Map(variables.map((v) => [v.key, v]));
    expect(porClave.get("baseUrl")?.value).toBe("https://produccion.dev/api");
    expect(porClave.get("token")?.value).toBe("predefined");
    expect(porClave.get("token")?.type).toBe("secret");
  });

  test("a variable with neither value nor type falls back to defaults", () => {
    const variables = inferCollectionVariables([], [
      { key: "token", value: undefined, type: undefined },
    ]);
    expect(variables).toContainEqual({ key: "token", value: "", type: "string" });
  });

  test("path params from specs are discovered with their example", () => {
    const variables = inferCollectionVariables(
      [spec({ method: "GET", uri: "/clientes/{{codigo}}" })],
    );
    expect(variables).toContainEqual({
      key: "codigo",
      value: "CODIGO001",
      type: "string",
    });
  });

  test("a variable already declared is not overwritten with the inferred example", () => {
    const variables = inferCollectionVariables(
      [spec({ method: "GET", uri: "/clientes/{{codigo}}" })],
      [{ key: "codigo", value: "FIXED" }],
    );
    expect(variables.filter((v) => v.key === "codigo")).toEqual([
      { key: "codigo", value: "FIXED", type: "string" },
    ]);
  });

  test("several specs and several params: all are discovered exactly once", () => {
    const variables = inferCollectionVariables([
      spec({ method: "GET", uri: "/users/{{id}}" }),
      spec({ method: "GET", uri: "/users/{{id}}/posts/{{postId}}" }),
    ]);
    const claves = variables.map((v) => v.key);
    expect(claves).toContain("id");
    expect(claves).toContain("postId");
    expect(claves.filter((k) => k === "id")).toHaveLength(1);
  });
});

describe("applyAgnosticInference — who gets touched and who does not", () => {
  test("mixed catalog: each spec receives what it lacks", () => {
    const sinNada = spec({ method: "POST", uri: "/productos" });
    const conFR = spec({
      method: "POST",
      uri: "/productos",
      formRequest: "StoreProductoRequest",
    });
    const manual = spec({
      method: "POST",
      uri: "/productos",
      body: { a: 1 },
    });
    const getSinQuery = spec({
      method: "GET",
      uri: "/items",
      query: undefined,
    });
    const getConQuery = spec({
      method: "GET",
      uri: "/items",
      query: [{ key: "page", value: "3" }],
    });

    const stats = applyAgnosticInference([
      sinNada,
      conFR,
      manual,
      getSinQuery,
      getConQuery,
    ]);

    // The POST receives no query (`inferQueryForSpec` is GET-only) and
    // the GET `sinQuery` receives its query: that is why 1.
    expect(stats).toEqual({
      bodiesAdded: 1,
      queriesAdded: 1,
      variableInferred: 0,
      skippedManual: 1,
    });
    // The bare POST receives the generic body: `/productos` has a
    // single segment, so there is no `resource` and the body comes
    // out empty.
    expect(sinNada.body).toEqual({});
    expect(sinNada.description).toContain("Body inferido: Genérico para POST.");
    // The one with FormRequest is not touched without override (its
    // `body` came `null` from the helper and stays that way).
    expect(conFR.body).toBeNull();
    expect(conFR.description).toBeUndefined();
    // The manual one keeps its body and counts as skipped.
    expect(manual.body).toEqual({ a: 1 });
    expect(manual.description).toBeUndefined();
    // The bare GET carries its standard query.
    expect(getSinQuery.query?.map((q) => q.key)).toEqual([
      "pagina",
      "items_por_pagina",
      "q",
    ]);
    // The GET with a manual query keeps it.
    expect(getConQuery.query).toEqual([{ key: "page", value: "3" }]);
  });

  test("previous description: the annotation is accumulated, not overwritten", () => {
    const s = spec({
      method: "POST",
      uri: "/productos",
      description: "Creates a product",
    });
    applyAgnosticInference([s]);
    expect(s.description).toContain("Creates a product");
    expect(s.description).toContain("Body inferido: Genérico para POST.");
  });

  test("query:[] and the missing property receive the same heuristic", () => {
    // An empty array IS "no query": the guard treats it the same as
    // the missing property, so the GET receives the standard
    // heuristic in both cases. Only a non-empty (manual) query is
    // preserved as-is.
    const vacio = spec({ method: "GET", uri: "/items", query: [] });
    const ausente = spec({ method: "GET", uri: "/items", query: undefined });
    const stats = applyAgnosticInference([vacio, ausente]);
    expect(stats.queriesAdded).toBe(2);
    expect(vacio.query?.map((q) => q.key)).toEqual([
      "pagina",
      "items_por_pagina",
      "q",
    ]);
    expect(ausente.query).toEqual(vacio.query);
  });

  test("with overrideExisting, a FormRequest also receives the heuristic", () => {
    const s = spec({
      method: "POST",
      uri: "/tareas/{{id}}/reindexar",
      formRequest: "ReindexarTareaRequest",
    });
    const stats = applyAgnosticInference([s], { overrideExisting: true });
    expect(stats.bodiesAdded).toBe(1);
    // The action heuristic yields the light body `force: true`.
    expect(s.body).toEqual({ force: true });
  });

  test("a PUT with no body and no query receives both", () => {
    const s = spec({ method: "PUT", uri: "/ajustes/generales" });
    const stats = applyAgnosticInference([s]);
    expect(stats.bodiesAdded).toBe(1);
    // GET-only: PUT does not receive a heuristic query.
    expect(stats.queriesAdded).toBe(0);
    expect(s.body).toEqual({
      force: false,
      notes: "PUT operation on ajustes",
    });
  });
});

// extractPathParams is already in the main spec; here only the
// defensive-filter line that the previous runs share.
describe("extractPathParams", () => {
  test("a single param keeps its name", () => {
    expect(extractPathParams("/clientes/{{codigo}}")).toEqual(["codigo"]);
  });
});

// The internal dictionary is exposed for the tests; we assert it
// keeps being exported for whoever uses it as an oracle.
describe("_internals", () => {
  test("keeps exposing the dictionaries and the body helper", () => {
    expect(_internals.ARRAY_HINT_FIELDS.size).toBeGreaterThan(0);
    expect(_internals.BOOLEAN_HINT_FIELDS.has("visible")).toBe(true);
    expect(_internals.COMMON_QUERY_FIELDS).toContain("per_page");
    expect(_internals.QUERY_FIELD_HINTS.length).toBeGreaterThan(0);
    expect(_internals.PATH_PARAM_HINTS.length).toBeGreaterThan(0);
  });
});
