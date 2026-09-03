/**
 * Ramas de fallback y error del inferidor agnóstico.
 *
 * El spec principal (`param-inferrer.spec.ts`) recorre el camino feliz
 * de cada heurística; este cubre las decisiones que solo se toman con
 * entradas raras: nombres de campo de cada familia del diccionario,
 * URIs vacías o de un solo segmento, variables ya declaradas por el
 * host y specs con FormRequest frente a `overrideExisting`.
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

/** Helper para construir un EndpointSpec mínimo en tests. */
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

describe("exampleForPathParam — cada familia del diccionario", () => {
  test("matrícula da una matrícula plausible", () => {
    expect(exampleForPathParam("matricula")).toBe("1234ABC");
    expect(exampleForPathParam("n_matricula")).toBe("1234ABC");
  });

  test("n_* y cantidad dan números", () => {
    expect(exampleForPathParam("n_pedidos")).toBe("10");
    expect(exampleForPathParam("cantidad")).toBe("10");
  });

  test("precio da un decimal", () => {
    expect(exampleForPathParam("precio_unitario")).toBe("19.99");
  });

  test("url* da una URL aunque el nombre siga siendo raro", () => {
    expect(exampleForPathParam("url_callback")).toBe("https://example.com");
  });

  test("el primer patrón que casa manda: codigo_ golpea antes que url", () => {
    // `codigo_proveedor` ya lo documenta el spec principal; aquí la
    // otra colisión del diccionario: `url` va después de `codigo`.
    expect(exampleForPathParam("codigo_url")).toBe("CODIGO001");
  });
});

describe("exampleForQueryField — cada pista del diccionario", () => {
  test("busquedas y texto libre", () => {
    expect(exampleForQueryField("q")).toBe("ejemplo");
    expect(exampleForQueryField("search")).toBe("ejemplo");
    expect(exampleForQueryField("busqueda")).toBe("ejemplo");
    expect(exampleForQueryField("query")).toBe("ejemplo");
  });

  test("identificadores y códigos", () => {
    expect(exampleForQueryField("id")).toBe("1");
    expect(exampleForQueryField("codigo")).toBe("COD001");
    expect(exampleForQueryField("cif")).toBe("COD001");
    expect(exampleForQueryField("nif")).toBe("COD001");
  });

  test("nombres y correos", () => {
    expect(exampleForQueryField("nombre")).toBe("Nombre de prueba");
    expect(exampleForQueryField("razon_social")).toBe("Nombre de prueba");
    expect(exampleForQueryField("email")).toBe("user@example.com");
  });

  test("paginación y orden", () => {
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

  test("estado, relaciones, idioma y fechas", () => {
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

describe("exampleForBodyField — familia por familia (vía _internals)", () => {
  const ejemplo = (name: string, hint?: string) =>
    _internals.exampleForBodyField(name, hint);

  test("el hint de id/codigo pisa al resto de heurísticas", () => {
    expect(ejemplo(" DepartamentoId ", "id")).toBe("1");
    expect(ejemplo("linea", "codigo")).toBe("1");
    // Hint sin semántica de id: cae a las heurísticas por nombre.
    expect(ejemplo("otra_cosa", "denominacion")).toBe("sample_otra_cosa");
  });

  test("sufijos de identificador sin hint", () => {
    expect(ejemplo("usuario_id")).toBe("1");
    expect(ejemplo("producto_codigo")).toBe("COD001");
    // Las variantes camelCase de los sufijos también casan: el
    // sufijo con mayúscula se compara contra el nombre ORIGINAL, no
    // contra la copia en minúsculas (donde nunca podía encajar).
    expect(ejemplo("DepartamentoId")).toBe("1");
    expect(ejemplo("departamentoId")).toBe("1");
    expect(ejemplo("DepartamentoCodigo")).toBe("COD001");
    // Un nombre que termina en "id" minúscula por pura morfología no
    // es un identificador: solo el sufijo exacto (`_id` / `Id`) activa
    // la heurística.
    expect(ejemplo("madrid")).toBe("sample_madrid");
  });

  test("campos de contacto y credenciales", () => {
    expect(ejemplo("email")).toBe("user@example.com");
    expect(ejemplo("password")).toBe("********");
    expect(ejemplo("pass")).toBe("********");
    expect(ejemplo("contrasena")).toBe("********");
  });

  test("textos genéricos", () => {
    expect(ejemplo("name")).toBe("Nombre de prueba");
    expect(ejemplo("nombre")).toBe("Nombre de prueba");
    expect(ejemplo("description")).toBe("Descripción de ejemplo");
    expect(ejemplo("descripcion")).toBe("Descripción de ejemplo");
    expect(ejemplo("notes")).toBe("Notas");
    expect(ejemplo("notas")).toBe("Notas");
  });

  test("URLs, fechas y cantidades", () => {
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

  test("booleanos por diccionario y por prefijo", () => {
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

  test("arrays por diccionario y fallback de texto", () => {
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

describe("inferBodyForSpec — ramas de forma de la URI", () => {
  test("POST de un solo segmento con verbo de acción → body ligero", () => {
    // Sin path params delante: la acción vive sola en `last`.
    const resultado = inferBodyForSpec(spec({ method: "POST", uri: "/reset" }));
    expect(resultado?.body).toEqual({ force: true });
    expect(resultado?.reason).toContain("reset");
  });

  test("cada alternativa del regex de acciones se recorre con su verbo", () => {
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

  test("la familia 'sin body esperado' incluye desactivar", () => {
    const resultado = inferBodyForSpec(
      spec({ method: "POST", uri: "/sesion/desactivar" }),
    );
    expect(resultado?.body).toEqual({});
    expect(resultado?.reason).toContain("sin body");
  });

  test("URI raíz: sin segmentos no revienta y da body genérico vacío", () => {
    const resultado = inferBodyForSpec(spec({ method: "POST", uri: "/" }));
    expect(resultado).not.toBeNull();
    expect(resultado?.body).toEqual({});
    expect(resultado?.reason).toContain("POST");
  });

  test("URI de un solo segmento: no hay resource del que hablar", () => {
    const resultado = inferBodyForSpec(
      spec({ method: "POST", uri: "/productos" }),
    );
    expect(resultado?.body).toEqual({});
  });

  test("PUT de un solo segmento también cae al genérico vacío", () => {
    expect(inferBodyForSpec(spec({ method: "PUT", uri: "/ajustes" }))?.body).toEqual({});
  });

  test("HEAD y OPTIONS no llevan body", () => {
    expect(inferBodyForSpec(spec({ method: "HEAD", uri: "/x" }))).toBeNull();
    expect(inferBodyForSpec(spec({ method: "OPTIONS", uri: "/x" }))).toBeNull();
  });
});

describe("inferQueryForSpec — ramas de forma de la URI", () => {
  test("URI raíz: sin último segmento cae a la paginación estándar", () => {
    const claves = inferQueryForSpec(spec({ method: "GET", uri: "/" })).map(
      (q) => q.key,
    );
    expect(claves).toEqual(["pagina", "items_por_pagina", "q"]);
  });

  test("la lista de 'sin paginación' recorre sus alternativas", () => {
    // La lista vive en un regex sobre el ÚLTIMO segmento: `csv` por
    // `/exportar/csv` (el verbo `exportar` está antes) y `historial`
    // por sí solo. `alarmas` no está en la lista y cae al estándar.
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

  test("POST no genera query aunque tenga path params", () => {
    expect(
      inferQueryForSpec(spec({ method: "POST", uri: "/users/{{id}}" })),
    ).toEqual([]);
  });
});

describe("inferCollectionVariables — host y descubiertas conviven", () => {
  test("base mínima sin nada exterior", () => {
    // a00012 S4: la baseUrl por defecto es el origen puro
    // (`DEFAULT_BASE_URL` = "http://localhost"). El `/api` ya no se
    // añade automáticamente; lo aporta una fuente explícita cuando
    // exista.
    expect(inferCollectionVariables([])).toEqual([
      { key: "baseUrl", value: "http://localhost", type: "string" },
      { key: "token", value: "", type: "string" },
    ]);
  });

  test("el valor declarado por el host se respeta, también el tipo", () => {
    const variables = inferCollectionVariables([], [
      { key: "baseUrl", value: "https://produccion.dev/api" },
      { key: "token", value: "predefinido", type: "secret" },
    ]);
    const porClave = new Map(variables.map((v) => [v.key, v]));
    expect(porClave.get("baseUrl")?.value).toBe("https://produccion.dev/api");
    expect(porClave.get("token")?.value).toBe("predefinido");
    expect(porClave.get("token")?.type).toBe("secret");
  });

  test("variable sin valor ni tipo prueba los valores por defecto", () => {
    const variables = inferCollectionVariables([], [
      { key: "token", value: undefined, type: undefined },
    ]);
    expect(variables).toContainEqual({ key: "token", value: "", type: "string" });
  });

  test("los path params de los specs se descubren con su ejemplo", () => {
    const variables = inferCollectionVariables(
      [spec({ method: "GET", uri: "/clientes/{{codigo}}" })],
    );
    expect(variables).toContainEqual({
      key: "codigo",
      value: "CODIGO001",
      type: "string",
    });
  });

  test("una variable ya declarada no se pisa con el ejemplo inferido", () => {
    const variables = inferCollectionVariables(
      [spec({ method: "GET", uri: "/clientes/{{codigo}}" })],
      [{ key: "codigo", value: "FIJADO" }],
    );
    expect(variables.filter((v) => v.key === "codigo")).toEqual([
      { key: "codigo", value: "FIJADO", type: "string" },
    ]);
  });

  test("varios specs y varios params: se descubren todos una vez", () => {
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

describe("applyAgnosticInference — quién se toca y quién no", () => {
  test("catálogo mixto: cada spec recibe lo que le falta", () => {
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

    // El POST no recibe query (`inferQueryForSpec` es GET-only) y el
    // GET `sinQuery` recibe la suya: por eso 1.
    expect(stats).toEqual({
      bodiesAdded: 1,
      queriesAdded: 1,
      variableInferred: 0,
      skippedManual: 1,
    });
    // El POST desnudo recibe el body genérico: `/productos` tiene un
    // solo segmento, así que no hay `resource` y el body sale vacío.
    expect(sinNada.body).toEqual({});
    expect(sinNada.description).toContain("Body inferido: Genérico para POST.");
    // El que tiene FormRequest no se toca sin override (su `body` venía
    // `null` del helper y sigue así).
    expect(conFR.body).toBeNull();
    expect(conFR.description).toBeUndefined();
    // El manual conserva su body y cuenta como saltado.
    expect(manual.body).toEqual({ a: 1 });
    expect(manual.description).toBeUndefined();
    // El GET desnudo lleva su query estándar.
    expect(getSinQuery.query?.map((q) => q.key)).toEqual([
      "pagina",
      "items_por_pagina",
      "q",
    ]);
    // El GET con query manual la conserva.
    expect(getConQuery.query).toEqual([{ key: "page", value: "3" }]);
  });

  test("descripción previa: la anotación se acumula, no se pisa", () => {
    const s = spec({
      method: "POST",
      uri: "/productos",
      description: "Crea un producto",
    });
    applyAgnosticInference([s]);
    expect(s.description).toContain("Crea un producto");
    expect(s.description).toContain("Body inferido: Genérico para POST.");
  });

  test("un query:[] y la propiedad ausente reciben la misma heurística", () => {
    // Un array vacío ES "sin query": el guardián lo trata igual que
    // la propiedad ausente, así que el GET recibe la heurística
    // estándar en los dos casos. Solo una query no vacía (manual)
    // se conserva tal cual.
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

  test("con overrideExisting, un FormRequest también recibe la heurística", () => {
    const s = spec({
      method: "POST",
      uri: "/tareas/{{id}}/reindexar",
      formRequest: "ReindexarTareaRequest",
    });
    const stats = applyAgnosticInference([s], { overrideExisting: true });
    expect(stats.bodiesAdded).toBe(1);
    // La heurística de acción da el body liger0 `force: true`.
    expect(s.body).toEqual({ force: true });
  });

  test("un PUT sin body ni query recibe las dos cosas", () => {
    const s = spec({ method: "PUT", uri: "/ajustes/generales" });
    const stats = applyAgnosticInference([s]);
    expect(stats.bodiesAdded).toBe(1);
    // GET-only: el PUT no recibe query heurística.
    expect(stats.queriesAdded).toBe(0);
    expect(s.body).toEqual({
      force: false,
      notes: "PUT operation on ajustes",
    });
  });
});

// extractPathParams ya está en el spec principal; aquí solo la línea
// del filtro defensivo que comparten los recorridos anteriores.
describe("extractPathParams", () => {
  test("un solo param guarda su nombre", () => {
    expect(extractPathParams("/clientes/{{codigo}}")).toEqual(["codigo"]);
  });
});

// El diccionario interno se expone para los tests; se comprueba que
// siga exportándose para quien lo use como oráculo.
describe("_internals", () => {
  test("sigue exponiendo los diccionarios y el ayudante de body", () => {
    expect(_internals.ARRAY_HINT_FIELDS.size).toBeGreaterThan(0);
    expect(_internals.BOOLEAN_HINT_FIELDS.has("visible")).toBe(true);
    expect(_internals.COMMON_QUERY_FIELDS).toContain("per_page");
    expect(_internals.QUERY_FIELD_HINTS.length).toBeGreaterThan(0);
    expect(_internals.PATH_PARAM_HINTS.length).toBeGreaterThan(0);
  });
});
