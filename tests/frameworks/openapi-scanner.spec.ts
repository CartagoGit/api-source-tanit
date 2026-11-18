import { describe, expect, test, vi } from "vitest";
import { OpenApiProjectScanner, OpenApiRouteScanner, OpenApiValidationProvider, parseYamlLite } from "../../packages/frameworks/scanners/openapi.scanner";
import type { ParsedRoute } from "../../packages/contracts/interfaces/core/scanner.interface";

import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture, createTempProject } from "../helpers/scanner-fixture";
import { comprehensiveFixtureDir, smokeFixtureDir } from "../../scripts/helpers/root.helper";

import { EMPTY_SCAN_RESULT } from "../helpers/empty-scan-result";
describeScannerContract({
  framework: "openapi",
  fixtureRoot: comprehensiveFixture("openapi"),
  capabilities: {
    validation: true,
    pathParams: true,
    stripsComments: false,
  },
});

const ROOT = smokeFixtureDir("openapi");
const COMPREHENSIVE = comprehensiveFixtureDir("openapi");

describe("OpenAPI scanner", () => {
  test("detect() > 0 when openapi.yaml exists at the root", async () => {
    expect((await new OpenApiProjectScanner().detect(ROOT)).score).toBeGreaterThan(0);
  });

  test("detect() === 0 when there is no openapi/swagger file", async () => {
    expect((await new OpenApiProjectScanner().detect("/tmp")).score).toBe(0);
  });

  test("scan() finds the 4 routes of the mini-fixture (yaml)", async () => {
    const match = await new OpenApiProjectScanner().resolve(ROOT);
    const routes = (await new OpenApiRouteScanner().scan(match)).routes;
    expect(routes).toHaveLength(4);
  });

  test("GET /api/users, POST /api/users, GET /api/users/{id}, DELETE /api/users/{id}", async () => {
    const match = await new OpenApiProjectScanner().resolve(ROOT);
    const routes = (await new OpenApiRouteScanner().scan(match)).routes;
    const pairs = routes.map((r) => `${r.method} ${r.uri}`);
    expect(pairs).toContain("GET /api/users");
    expect(pairs).toContain("POST /api/users");
    expect(pairs).toContain("GET /api/users/{id}");
    expect(pairs).toContain("DELETE /api/users/{id}");
  });

  test("path param {id} from paths /api/users/{id} preserved", async () => {
    const match = await new OpenApiProjectScanner().resolve(ROOT);
    const routes = (await new OpenApiRouteScanner().scan(match)).routes;
    const withId = routes.filter((r) => r.uri.includes("{id}"));
    expect(withId.length).toBe(2);
  });

  test("OpenAPI validation provider resolves requestBody.schema fields for POST", async () => {
    const match = await new OpenApiProjectScanner().resolve(ROOT);
    const routes = (await new OpenApiRouteScanner().scan(match)).routes;
    const post = routes.find((r) => r.method === "POST");
    if (!post) return;
    const provider = new OpenApiValidationProvider();
    const result = await provider.resolve(post, match, EMPTY_SCAN_RESULT);
    expect(result.fields.length).toBeGreaterThan(0);
    const names = result.fields.map((f) => f.fieldName);
    expect(names).toContain("name");
    expect(names).toContain("email");
  });

  // `IValidationSpec` separates the logical type from the semantic
  // format: `format: email` in the OpenAPI spec is a string with the
  // email format, not an "email" type (which does not exist in the
  // contract).
  test("email field is a string with format 'email'", async () => {
    const match = await new OpenApiProjectScanner().resolve(ROOT);
    const result = await new OpenApiRouteScanner().scan(match);
    const routes = result.routes;
    const post = routes.find((r) => r.method === "POST");
    expect(post).toBeDefined();
    const validation = await new OpenApiValidationProvider().resolve(
      post!,
      match,
      result,
    );
    const email = validation.fields.find((f) => f.fieldName === "email");
    expect(email).toBeDefined();
    expect(email?.type).toBe("string");
    expect(email?.format).toBe("email");
  });

  test("comprehensive: detects >20 routes with $ref schemas and parameters", async () => {
    const match = await new OpenApiProjectScanner().resolve(COMPREHENSIVE);
    const routes = (await new OpenApiRouteScanner().scan(match)).routes;
    expect(routes.length).toBeGreaterThanOrEqual(20);
  });
});

// ---------------------------------------------------------------------------
// parseYamlLite: parser branches that the normal fixtures do not trigger.
// ---------------------------------------------------------------------------

describe("parseYamlLite — scalars, quoted keys and flow collections", () => {
  test("~ and null become null; booleans and numbers too", () => {
    const parsed = parseYamlLite(
      "vacio: ~\nnulo: null\nbandera: true\nnegado: false\nentero: -12\ndecimal: 3.5",
    ) as Record<string, unknown>;
    expect(parsed.vacio).toBeNull();
    expect(parsed.nulo).toBeNull();
    expect(parsed.bandera).toBe(true);
    expect(parsed.negado).toBe(false);
    expect(parsed.entero).toBe(-12);
    expect(parsed.decimal).toBe(3.5);
  });

  test("keys and values in single/double quotes lose the quotes", () => {
    const parsed = parseYamlLite(
      "'200': ok\n\"404\": ko\nclave: 'con simples'\notra: \"con dobles\"",
    ) as Record<string, unknown>;
    expect(parsed["200"]).toBe("ok");
    expect(parsed["404"]).toBe("ko");
    expect(parsed.clave).toBe("con simples");
    expect(parsed.otra).toBe("con dobles");
  });

  test("sequences of scalars and inline mappings with continuation", () => {
    const parsed = parseYamlLite(
      [
        "lista:",
        "  - item1",
        "  - 2",
        "  - name: id",
        "    in: path",
        "    required: true",
      ].join("\n"),
    ) as Record<string, unknown>;
    const lista = parsed.lista as unknown[];
    expect(lista[0]).toBe("item1");
    expect(lista[1]).toBe(2);
    expect(lista[2]).toEqual({ name: "id", in: "path", required: true });
  });

  test("sequence with nested block mapping after an empty '- '", () => {
    const parsed = parseYamlLite(
      ["cosas:", "  -", "    a: 1", "    b: dos"].join("\n"),
    ) as Record<string, unknown>;
    expect(parsed.cosas).toEqual([{ a: 1, b: "dos" }]);
  });

  test("literal blocks | and > both in mapping and after '- key:'", () => {
    const parsed = parseYamlLite(
      [
        "literal: |",
        "  linea1",
        "  linea2",
        "plegado: >",
        "  hola",
        "lista:",
        "  - texto: |",
        "    dentro",
      ].join("\n"),
    ) as Record<string, unknown>;
    expect(parsed.literal).toBe("linea1\nlinea2");
    expect(parsed.plegado).toBe("hola");
    expect(((parsed.lista as unknown[]) ?? [])[0]).toEqual({ texto: "dentro" });
  });

  test("flow sequence and flow mapping (including empty and URLs containing ':')", () => {
    const parsed = parseYamlLite(
      [
        "vacia: []",
        "nums: [1, 2, 3]",
        "mapa: {}",
        "schema: { type: string, format: email }",
        "anidado: { def: { a: 1 } }",
        "url: { base: http://x.com:8080/y }",
        "conCommaEnLista: [[1, 2], 3]",
        "claveQuoted: { 'a:b': 1 }",
        "sinSeparador: { soloclave, x: 1 }",
      ].join("\n"),
    ) as Record<string, unknown>;
    expect(parsed.vacia).toEqual([]);
    expect(parsed.nums).toEqual([1, 2, 3]);
    expect(parsed.mapa).toEqual({});
    expect(parsed.schema).toEqual({ type: "string", format: "email" });
    expect(parsed.anidado).toEqual({ def: { a: 1 } });
    expect(parsed.url).toEqual({ base: "http://x.com:8080/y" });
    expect(parsed.conCommaEnLista).toEqual([[1, 2], 3]);
    expect(parsed.claveQuoted).toEqual({ "a:b": 1 });
      // `soloclave` has no `:` at the top level: it is dropped, does not break.
    expect(parsed.sinSeparador).toEqual({ x: 1 });
  });

  test("tabs are sanitized (YAML does not accept them)", () => {
    const parsed = parseYamlLite("a:\n\tb: 1") as Record<string, unknown>;
    expect(parsed.a).toEqual({ b: 1 });
  });

  test("YAML that is not a mapping (top-level array) returns an array", () => {
    expect(parseYamlLite("- 1\n- 2")).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// OpenApiRouteScanner: scan() branches outside the happy path.
// ---------------------------------------------------------------------------

describe("OpenApiRouteScanner — scan() branches", () => {
  test("opts.specPath wins over detected artifacts", async () => {
    const project = await createTempProject({
      "openapi.json": JSON.stringify({ paths: { "/raiz": { get: { summary: "raiz" } } } }),
      "docs/openapi.json": JSON.stringify({ paths: { "/docs": { get: { summary: "docs" } } } }),
    });
    try {
      const match = await new OpenApiProjectScanner().resolve(project.root);
      expect(match.artifacts[0]).toBe("openapi.json");
      const routes = (await new OpenApiRouteScanner({ specPath: "docs/openapi.json" }).scan(match)).routes;
      expect(routes.map((r) => r.uri)).toEqual(["/docs"]);
      expect(routes[0]?.sourceFile).toBe("docs/openapi.json#GET/docs");
    } finally {
      await project.cleanup();
    }
  });

  test("specPath pointing at a non-existent file returns []", async () => {
    const project = await createTempProject({
      "openapi.json": JSON.stringify({ paths: {} }),
    });
    try {
      const match = await new OpenApiProjectScanner().resolve(project.root);
      const routes = (await new OpenApiRouteScanner({ specPath: "missing.json" }).scan(match)).routes;
      expect(routes).toEqual([]);
    } finally {
      await project.cleanup();
    }
  });

  test("match without artifacts returns []", async () => {
    const result = await new OpenApiRouteScanner().scan({
      framework: "openapi",
      projectRoot: "/tmp",
      artifacts: [],
    });
    expect(result.routes).toEqual([]);
  });

  test("invalid JSON throws with a clear message", async () => {
    const project = await createTempProject({ "openapi.json": "{no es json" });
    try {
      const match = await new OpenApiProjectScanner().resolve(project.root);
      await expect(new OpenApiRouteScanner().scan(match)).rejects.toThrow("cannot parse");
    } finally {
      await project.cleanup();
    }
  });

  test("YAML with anchors warns via console.warn but does not throw", async () => {
    const project = await createTempProject({
      "openapi.yaml": "paths:\n  /a:\n    get:\n      summary: &s hola\n",
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const match = await new OpenApiProjectScanner().resolve(project.root);
      const routes = (await new OpenApiRouteScanner().scan(match)).routes;
      expect(warn).toHaveBeenCalled();
      expect(routes.map((r) => r.uri)).toEqual(["/a"]);
    } finally {
      warn.mockRestore();
      await project.cleanup();
    }
  });

  test("opts basePath wins over the spec's and fills prefixChain", async () => {
    const project = await createTempProject({
      "openapi.json": JSON.stringify({ basePath: "/v3", paths: { "/users": { get: {} } } }),
    });
    try {
      const match = await new OpenApiProjectScanner().resolve(project.root);
      const conOpcion = (await new OpenApiRouteScanner({ basePath: "/api/v2" }).scan(match)).routes;
      expect(conOpcion[0]?.uri).toBe("/api/v2/users");
      expect(conOpcion[0]?.prefixChain).toEqual(["/api/v2"]);
      const sinOpcion = (await new OpenApiRouteScanner().scan(match)).routes;
      expect(sinOpcion[0]?.uri).toBe("/v3/users");
      expect(sinOpcion[0]?.prefixChain).toEqual(["/v3"]);
    } finally {
      await project.cleanup();
    }
  });

  test("without basePath prefixChain is empty and double slashes collapse", async () => {
    const project = await createTempProject({
      "openapi.json": JSON.stringify({ paths: { "/users": { get: {} } } }),
    });
    try {
      const match = await new OpenApiProjectScanner().resolve(project.root);
      const routes = (await new OpenApiRouteScanner().scan(match)).routes;
      expect(routes[0]?.prefixChain).toEqual([]);
      expect(routes[0]?.uri).toBe("/users");
    } finally {
      await project.cleanup();
    }
  });

  test("servers[0].url contributes the prefix in OpenAPI 3", async () => {
    const project = await createTempProject({
      "openapi.json": JSON.stringify({
        openapi: "3.0.3",
        servers: [{ url: "https://api.example.test/v1" }],
        paths: { "/users": { get: {} } },
      }),
    });
    try {
      const match = await new OpenApiProjectScanner().resolve(project.root);
      const routes = (await new OpenApiRouteScanner().scan(match)).routes;
      expect(routes[0]?.uri).toBe("/v1/users");
      expect(routes[0]?.prefixChain).toEqual(["/v1"]);
    } finally {
      await project.cleanup();
    }
  });

  test("displayName and description: operationId > summary > method+path", async () => {
    const project = await createTempProject({
      "openapi.json": JSON.stringify({
        paths: {
          "/x": {
            get: { operationId: "opId", tags: ["t1", "t2"], summary: "S", description: "D" },
            post: { summary: "SoloSummary" },
            put: {},
          },
        },
      }),
    });
    try {
      const match = await new OpenApiProjectScanner().resolve(project.root);
      const routes = (await new OpenApiRouteScanner().scan(match)).routes;
      const get = routes.find((r) => r.method === "GET");
      expect(get?.displayName).toBe("opId");
      expect(get?.tags).toEqual(["t1", "t2"]);
      expect(get?.description).toBe("D");
      const post = routes.find((r) => r.method === "POST");
      expect(post?.displayName).toBe("SoloSummary");
      // Without its own description, summary doubles as description.
      expect(post?.description).toBe("SoloSummary");
      expect(post?.tags).toBeUndefined();
      const put = routes.find((r) => r.method === "PUT");
      expect(put?.displayName).toBe("PUT /x");
      expect(put?.description).toBeUndefined();
    } finally {
      await project.cleanup();
    }
  });

  test("minority verbs head/options/trace also come out", async () => {
    const project = await createTempProject({
      "openapi.json": JSON.stringify({
        paths: { "/y": { head: {}, options: {}, trace: {} } },
      }),
    });
    try {
      const match = await new OpenApiProjectScanner().resolve(project.root);
      const methods = (await new OpenApiRouteScanner().scan(match)).routes.map((r) => r.method).sort();
      expect(methods).toEqual(["HEAD", "OPTIONS", "TRACE"]);
    } finally {
      await project.cleanup();
    }
  });

  test("pathItem or op that are not objects are dropped without throwing", async () => {
    const project = await createTempProject({
      "openapi.json": JSON.stringify({
        paths: {
          "/roto": 5,
          "/medio": { get: "no-es-objeto", post: { summary: "ok" } },
        },
      }),
    });
    try {
      const match = await new OpenApiProjectScanner().resolve(project.root);
      const routes = (await new OpenApiRouteScanner().scan(match)).routes;
      expect(routes.map((r) => `${r.method} ${r.uri}`)).toEqual(["POST /medio"]);
    } finally {
      await project.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// OpenApiValidationProvider: paths the mini-fixture does not touch.
// ---------------------------------------------------------------------------

/** Builds a temporary project with a JSON spec and leaves it ready for the provider. */
async function specProject(spec: unknown) {
  const project = await createTempProject({
    "openapi.json": typeof spec === "string" ? spec : JSON.stringify(spec),
  });
  const match = await new OpenApiProjectScanner().resolve(project.root);
  return { project, match };
}

describe("OpenApiValidationProvider — resolve() branches", () => {
  const provider = new OpenApiValidationProvider();

  function rutaDe(method: string, rawUri: string): ParsedRoute {
    return {
      method,
      uri: rawUri,
      rawUri,
      sourceFile: `openapi.json#${method.toUpperCase()}${rawUri}`,
      lineNumber: 0,
      prefixChain: [],
    };
  }

  test("match without artifacts returns empty fields and normalized endpointKey", async () => {
    const result = await provider.resolve(
      { method: "GET", uri: "/Users", rawUri: "/Users", sourceFile: "", lineNumber: 0, prefixChain: [] },
      { framework: "openapi", projectRoot: "/tmp", artifacts: [] },
      EMPTY_SCAN_RESULT,
    );
    expect(result.endpointKey).toBe("get /users");
    expect(result.fields).toEqual([]);
  });

  test("unreadable spec (broken JSON) returns empty fields without throwing", async () => {
    const { project, match } = await specProject("{roto");
    try {
      const result = await provider.resolve(rutaDe("GET", "/users"), match, EMPTY_SCAN_RESULT);
      expect(result.fields).toEqual([]);
    } finally {
      await project.cleanup();
    }
  });

  test("rawUri without pathItem or op in the spec returns empty fields", async () => {
    const { project, match } = await specProject({ paths: { "/users": { post: {} } } });
    try {
      const sinPath = await provider.resolve(rutaDe("GET", "/no-existe"), match, EMPTY_SCAN_RESULT);
      expect(sinPath.fields).toEqual([]);
      // The path exists but the verb does not.
      const sinOp = await provider.resolve(rutaDe("GET", "/users"), match, EMPTY_SCAN_RESULT);
      expect(sinOp.fields).toEqual([]);
    } finally {
      await project.cleanup();
    }
  });

  test("path parameters, op parameters, $ref, and 'in' defaults", async () => {
    const { project, match } = await specProject({
      components: {
        parameters: {
          Limit: { name: "limit", in: "query", required: true, schema: { type: "integer", minimum: 1, maximum: 100 } },
          SinNombre: { in: "header" },
        },
      },
      paths: {
        "/users": {
          parameters: [{ $ref: "#/components/parameters/Limit" }],
          get: {
            parameters: [
              { name: "q", schema: { type: "string", pattern: "^a", description: "desc del param", example: "abc" } },
              // $ref sin name: el name viene del param original.
              { $ref: "#/components/parameters/SinNombre", name: "fallback" },
              // Sin in: cae al default 'query'. Sin schema: tipo any.
              { name: "suave" },
              // $ref que no resuelve: se usa el param tal cual.
              { $ref: "#/components/parameters/NoExiste", name: "roto", in: "path", required: true },
              // Param no-record: se descarta.
              "no-es-objeto",
            ],
          },
        },
      },
    });
    try {
      const result = await provider.resolve(rutaDe("GET", "/users"), match, EMPTY_SCAN_RESULT);
      const byName = new Map(result.fields.map((f) => [f.fieldName, f]));
      expect(byName.get("limit")).toMatchObject({ location: "query", required: true, type: "integer", minimum: 1, maximum: 100 });
      expect(byName.get("fallback")).toMatchObject({ location: "header" });
      expect(byName.get("q")).toMatchObject({ type: "string", pattern: "^a", description: "desc del param", example: "abc" });
      expect(byName.get("suave")).toMatchObject({ location: "query", type: "any" });
      expect(byName.get("roto")).toMatchObject({ location: "path", required: true });
    } finally {
      await project.cleanup();
    }
  });

  test("requestBody with scalar types, date/datetime formats, enum and file", async () => {
    const { project, match } = await specProject({
      paths: {
        "/things": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    properties: {
                      a: { type: "integer" },
                      b: { type: "number" },
                      c: { type: "boolean" },
                      d: { type: "array" },
                      e: { type: "object" },
                      f: { type: "string", format: "date" },
                      g: { type: "string", format: "date-time" },
                      h: { enum: ["x", "y"] },
                      i: { type: "file" },
                      j: {},
                      k: { type: "string", maxLength: 5, minLength: 1, description: "dk", example: 42 },
                    },
                    required: ["a", "k"],
                  },
                },
              },
            },
          },
        },
      },
    });
    try {
      const result = await provider.resolve(rutaDe("POST", "/things"), match, EMPTY_SCAN_RESULT);
      const tipos = new Map(result.fields.map((f) => [f.fieldName, f.type]));
      expect(tipos.get("a")).toBe("integer");
      expect(tipos.get("b")).toBe("number");
      expect(tipos.get("c")).toBe("boolean");
      expect(tipos.get("d")).toBe("array");
      expect(tipos.get("e")).toBe("object");
      expect(tipos.get("f")).toBe("date");
      expect(tipos.get("g")).toBe("datetime");
      expect(tipos.get("h")).toBe("enum");
      expect(tipos.get("i")).toBe("file");
      expect(tipos.get("j")).toBe("any");
      const k = result.fields.find((f) => f.fieldName === "k");
      expect(k).toMatchObject({ maxLength: 5, minLength: 1, description: "dk", example: 42, required: true });
      expect(result.fields.find((f) => f.fieldName === "b")?.required).toBe(false);
      const h = result.fields.find((f) => f.fieldName === "h");
      expect(h?.enumValues).toEqual(["x", "y"]);
    } finally {
      await project.cleanup();
    }
  });

  test("requestBody with $ref top-level, mixed allOf, and bounded $ref cycle", async () => {
    const { project, match } = await specProject({
      components: {
        schemas: {
          Base: { properties: { id: { type: "integer" } }, required: ["id"] },
          CicloA: { allOf: [{ $ref: "#/components/schemas/CicloB" }] },
          CicloB: { allOf: [{ $ref: "#/components/schemas/CicloA" }] },
        },
      },
      paths: {
        "/ref": {
          post: {
            requestBody: {
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Base", properties: { extra: { type: "boolean" } } } },
              },
            },
          },
        },
        "/allof": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/Base" },
                      { properties: { name: { type: "string" } }, required: ["name"] },
                    ],
                  },
                },
              },
            },
          },
        },
        "/ciclo": {
          post: {
            requestBody: {
              content: { "application/json": { schema: { $ref: "#/components/schemas/CicloA" } } },
            },
          },
        },
        "/vacio": {
          post: { requestBody: { content: { "application/json": { schema: {} } } } },
        },
      },
    });
    try {
      const porRef = await provider.resolve(rutaDe("POST", "/ref"), match, EMPTY_SCAN_RESULT);
      expect(porRef.fields.map((f) => f.fieldName)).toContain("id");

      const allOf = await provider.resolve(rutaDe("POST", "/allof"), match, EMPTY_SCAN_RESULT);
      const mergeado = new Map(allOf.fields.map((f) => [f.fieldName, f]));
      expect(mergeado.get("id")?.required).toBe(true);
      expect(mergeado.get("name")?.required).toBe(true);

      // The cycle cannot hang: the visited $ref bound cuts the branch.
      const ciclo = await provider.resolve(rutaDe("POST", "/ciclo"), match, EMPTY_SCAN_RESULT);
      expect(ciclo.fields).toEqual([]);

      // Empty schema: no properties, no required → zero fields.
      const vacio = await provider.resolve(rutaDe("POST", "/vacio"), match, EMPTY_SCAN_RESULT);
      expect(vacio.fields).toEqual([]);
    } finally {
      await project.cleanup();
    }
  });

  test("YAML spec (not .json) also resolves provider fields", async () => {
    const project = await createTempProject({
      "openapi.yaml": [
        "paths:",
        "  /yaml:",
        "    post:",
        "      requestBody:",
        "        content:",
        "          application/json:",
        "            schema:",
        "              properties:",
        "                name: { type: string }",
      ].join("\n"),
    });
    try {
      const match = await new OpenApiProjectScanner().resolve(project.root);
      const result = await provider.resolve(rutaDe("POST", "/yaml"), match, EMPTY_SCAN_RESULT);
      expect(result.fields.map((f) => f.fieldName)).toEqual(["name"]);
    } finally {
      await project.cleanup();
    }
  });
});
