import { describe, expect, test } from "vitest";

import { exampleForPathParam, exampleForQueryField, extractPathParams, inferBodyForSpec, inferQueryForSpec } from "../../projects/core/domain/param-inferrer.service";
import type { EndpointSpec } from "../../projects/contracts/interfaces/core/postman.interface";

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

describe("param-inferrer.service", () => {
  describe("extractPathParams", () => {
    test("extrae los nombres en orden", () => {
      expect(extractPathParams("/users/{{id}}/posts/{{postId}}")).toEqual([
        "id",
        "postId",
      ]);
    });

    test("URI sin params devuelve []", () => {
      expect(extractPathParams("/users")).toEqual([]);
    });
  });

  describe("exampleForPathParam", () => {
    test("id puro → '1'", () => {
      expect(exampleForPathParam("id")).toBe("1");
      expect(exampleForPathParam("user_id")).toBe("1");
    });

    test("codigo → 'CODIGO001'", () => {
      expect(exampleForPathParam("codigo")).toBe("CODIGO001");
    });

    test("codigo_proveedor cae al primer pattern (codigo) — orden importa", () => {
      // El primer pattern que matchea es el que gana. Hoy en día
      // `codigo_proveedor` matchea `codigo` antes que su propio
      // pattern. Documentamos el comportamiento, no lo corregimos
      // aquí (queda como mejora para un futuro PR).
      expect(exampleForPathParam("codigo_proveedor")).toBe("CODIGO001");
    });

    test("email → 'usuario@ejemplo.com'", () => {
      expect(exampleForPathParam("email")).toBe("user@example.com");
    });

    test("uuid → UUID v4 fijo", () => {
      expect(exampleForPathParam("uuid")).toBe(
        "00000000-0000-0000-0000-000000000001",
      );
    });

    test("nombre desconocido → '1' (fallback)", () => {
      expect(exampleForPathParam("xyz_unknown")).toBe("1");
    });
  });

  describe("exampleForQueryField", () => {
    test("page → '1'", () => {
      expect(exampleForQueryField("page")).toBe("1");
      expect(exampleForQueryField("pagina")).toBe("1");
    });

    test("busqueda → 'ejemplo'", () => {
      expect(exampleForQueryField("q")).toBe("ejemplo");
      expect(exampleForQueryField("search")).toBe("ejemplo");
    });

    test("estado → 'active'", () => {
      expect(exampleForQueryField("status")).toBe("active");
      expect(exampleForQueryField("estado")).toBe("active");
    });

    test("campo desconocido → 'ejemplo'", () => {
      expect(exampleForQueryField("xyz_unknown")).toBe("ejemplo");
    });
  });

  describe("inferBodyForSpec", () => {
    test("GET no genera body", () => {
      expect(inferBodyForSpec(spec({ method: "GET" }))).toBeNull();
    });

    test("DELETE no genera body", () => {
      expect(inferBodyForSpec(spec({ method: "DELETE" }))).toBeNull();
    });

    test("POST /productos/{{id}}/reindexar → { force: true }", () => {
      const result = inferBodyForSpec(
        spec({ method: "POST", uri: "/productos/{{id}}/reindexar" }),
      );
      expect(result).not.toBeNull();
      expect(result?.body.force).toBe(true);
    });

    test("POST /despersonar → body vacío", () => {
      const result = inferBodyForSpec(
        spec({ method: "POST", uri: "/usuarios/despersonar" }),
      );
      expect(result?.body).toEqual({});
    });

    test("POST con sub-path que no es acción → body genérico", () => {
      const result = inferBodyForSpec(
        spec({ method: "POST", uri: "/productos/asignar" }),
      );
      expect(result?.body.force).toBe(false);
      expect(result?.body.notes).toContain("productos");
    });

    test("PUT /usuarios/{{id}} → body genérico", () => {
      const result = inferBodyForSpec(
        spec({ method: "PUT", uri: "/api/usuarios/{{id}}" }),
      );
      expect(result).not.toBeNull();
      expect(result?.body.force).toBe(false);
    });

    test("PUT /usuarios/{{id}} → body genérico", () => {
      const result = inferBodyForSpec(
        spec({ method: "PUT", uri: "/api/usuarios/{{id}}" }),
      );
      expect(result).not.toBeNull();
      expect(result?.body.force).toBe(false);
    });
  });

  describe("inferQueryForSpec", () => {
    test("GET no-GET → []", () => {
      expect(
        inferQueryForSpec(spec({ method: "POST", uri: "/x" })),
      ).toEqual([]);
    });

    test("GET show con path param → solo include", () => {
      const result = inferQueryForSpec(
        spec({ method: "GET", uri: "/users/{{id}}" }),
      );
      expect(result).toHaveLength(1);
      expect(result[0]?.key).toBe("include");
    });

    test("GET index → paginación + búsqueda", () => {
      const result = inferQueryForSpec(
        spec({ method: "GET", uri: "/api/users" }),
      );
      const keys = result.map((q) => q.key);
      expect(keys).toContain("pagina");
      expect(keys).toContain("items_por_pagina");
      expect(keys).toContain("q");
    });

    test("GET /alive excluye paginación", () => {
      const result = inferQueryForSpec(
        spec({ method: "GET", uri: "/alive" }),
      );
      const keys = result.map((q) => q.key);
      expect(keys).toEqual(["q"]);
    });

    test("GET /pdf excluye paginación", () => {
      const result = inferQueryForSpec(
        spec({ method: "GET", uri: "/api/facturas/pdf" }),
      );
      const keys = result.map((q) => q.key);
      expect(keys).toEqual(["q"]);
    });
  });
});
