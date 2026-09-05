import { describe, expect, test } from "vitest";

import { exampleForPathParam, exampleForQueryField, extractPathParams, inferBodyForSpec, inferQueryForSpec } from "../../packages/core/domain/param-inferrer.service";
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

describe("param-inferrer.service", () => {
  describe("extractPathParams", () => {
    test("extracts the names in order", () => {
      expect(extractPathParams("/users/{{id}}/posts/{{postId}}")).toEqual([
        "id",
        "postId",
      ]);
    });

    test("a URI without params returns []", () => {
      expect(extractPathParams("/users")).toEqual([]);
    });
  });

  describe("exampleForPathParam", () => {
    test("plain id → '1'", () => {
      expect(exampleForPathParam("id")).toBe("1");
      expect(exampleForPathParam("user_id")).toBe("1");
    });

    test("codigo → 'CODIGO001'", () => {
      expect(exampleForPathParam("codigo")).toBe("CODIGO001");
    });

    test("codigo_proveedor falls back to the first matching pattern (codigo) — order matters", () => {
      // The first pattern that matches wins. Today
      // `codigo_proveedor` matches `codigo` before its own pattern.
      // We document the behavior here; fixing it is left for a
      // future PR.
      expect(exampleForPathParam("codigo_proveedor")).toBe("CODIGO001");
    });

    test("email → 'user@example.com'", () => {
      expect(exampleForPathParam("email")).toBe("user@example.com");
    });

    test("uuid → fixed UUID v4", () => {
      expect(exampleForPathParam("uuid")).toBe(
        "00000000-0000-0000-0000-000000000001",
      );
    });

    test("unknown name → '1' (fallback)", () => {
      expect(exampleForPathParam("xyz_unknown")).toBe("1");
    });
  });

  describe("exampleForQueryField", () => {
    test("page → '1'", () => {
      expect(exampleForQueryField("page")).toBe("1");
      expect(exampleForQueryField("pagina")).toBe("1");
    });

    test("search → 'example'", () => {
      expect(exampleForQueryField("q")).toBe("ejemplo");
      expect(exampleForQueryField("search")).toBe("ejemplo");
    });

    test("status → 'active'", () => {
      expect(exampleForQueryField("status")).toBe("active");
      expect(exampleForQueryField("estado")).toBe("active");
    });

    test("unknown field → 'example'", () => {
      expect(exampleForQueryField("xyz_unknown")).toBe("ejemplo");
    });
  });

  describe("inferBodyForSpec", () => {
    test("GET generates no body", () => {
      expect(inferBodyForSpec(spec({ method: "GET" }))).toBeNull();
    });

    test("DELETE generates no body", () => {
      expect(inferBodyForSpec(spec({ method: "DELETE" }))).toBeNull();
    });

    test("POST /productos/{{id}}/reindexar → { force: true }", () => {
      const result = inferBodyForSpec(
        spec({ method: "POST", uri: "/productos/{{id}}/reindexar" }),
      );
      expect(result).not.toBeNull();
      expect(result?.body.force).toBe(true);
    });

    test("POST /despersonar → empty body", () => {
      const result = inferBodyForSpec(
        spec({ method: "POST", uri: "/usuarios/despersonar" }),
      );
      expect(result?.body).toEqual({});
    });

    test("POST with a sub-path that is not an action → generic body", () => {
      const result = inferBodyForSpec(
        spec({ method: "POST", uri: "/productos/asignar" }),
      );
      expect(result?.body.force).toBe(false);
      expect(result?.body.notes).toContain("productos");
    });

    test("PUT /usuarios/{{id}} → generic body", () => {
      const result = inferBodyForSpec(
        spec({ method: "PUT", uri: "/api/usuarios/{{id}}" }),
      );
      expect(result).not.toBeNull();
      expect(result?.body.force).toBe(false);
    });

    test("PUT /usuarios/{{id}} → generic body", () => {
      const result = inferBodyForSpec(
        spec({ method: "PUT", uri: "/api/usuarios/{{id}}" }),
      );
      expect(result).not.toBeNull();
      expect(result?.body.force).toBe(false);
    });
  });

  describe("inferQueryForSpec", () => {
    test("non-GET → []", () => {
      expect(
        inferQueryForSpec(spec({ method: "POST", uri: "/x" })),
      ).toEqual([]);
    });

    test("GET show with path param → include only", () => {
      const result = inferQueryForSpec(
        spec({ method: "GET", uri: "/users/{{id}}" }),
      );
      expect(result).toHaveLength(1);
      expect(result[0]?.key).toBe("include");
    });

    test("GET index → pagination + search", () => {
      const result = inferQueryForSpec(
        spec({ method: "GET", uri: "/api/users" }),
      );
      const keys = result.map((q) => q.key);
      expect(keys).toContain("pagina");
      expect(keys).toContain("items_por_pagina");
      expect(keys).toContain("q");
    });

    test("GET /alive excludes pagination", () => {
      const result = inferQueryForSpec(
        spec({ method: "GET", uri: "/alive" }),
      );
      const keys = result.map((q) => q.key);
      expect(keys).toEqual(["q"]);
    });

    test("GET /pdf excludes pagination", () => {
      const result = inferQueryForSpec(
        spec({ method: "GET", uri: "/api/facturas/pdf" }),
      );
      const keys = result.map((q) => q.key);
      expect(keys).toEqual(["q"]);
    });
  });
});
