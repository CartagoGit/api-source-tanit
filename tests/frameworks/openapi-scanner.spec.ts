import { describe, expect, test, vi } from "vitest";
import { OpenApiProjectScanner, OpenApiRouteScanner, OpenApiValidationProvider, parseYamlLite } from "../../packages/frameworks/scanners/openapi.scanner";
import type { ParsedRoute } from "../../packages/contracts/interfaces/core/scanner.interface";

import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture, createTempProject } from "../helpers/scanner-fixture";
import { comprehensiveFixtureDir, smokeFixtureDir } from "../../scripts/helpers/root.helper";

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
  test("detect() > 0 cuando hay openapi.yaml en la raíz", async () => {
    expect(await new OpenApiProjectScanner().detect(ROOT)).toBeGreaterThan(0);
  });

  test("detect() === 0 cuando no hay archivo openapi/swagger", async () => {
    expect(await new OpenApiProjectScanner().detect("/tmp")).toBe(0);
  });

  test("scan() encuentra las 4 rutas del mini-fixture (yaml)", async () => {
    const match = await new OpenApiProjectScanner().resolve(ROOT);
    const routes = await new OpenApiRouteScanner().scan(match);
    expect(routes).toHaveLength(4);
  });

  test("GET /api/users, POST /api/users, GET /api/users/{id}, DELETE /api/users/{id}", async () => {
    const match = await new OpenApiProjectScanner().resolve(ROOT);
    const routes = await new OpenApiRouteScanner().scan(match);
    const pairs = routes.map((r) => `${r.method} ${r.uri}`);
    expect(pairs).toContain("GET /api/users");
    expect(pairs).toContain("POST /api/users");
    expect(pairs).toContain("GET /api/users/{id}");
    expect(pairs).toContain("DELETE /api/users/{id}");
  });

  test("path param {id} de paths /api/users/{id} preservado", async () => {
    const match = await new OpenApiProjectScanner().resolve(ROOT);
    const routes = await new OpenApiRouteScanner().scan(match);
    const withId = routes.filter((r) => r.uri.includes("{id}"));
    expect(withId.length).toBe(2);
  });

  test("OpenAPI validation provider resuelve campos de requestBody.schema para POST", async () => {
    const match = await new OpenApiProjectScanner().resolve(ROOT);
    const routes = await new OpenApiRouteScanner().scan(match);
    const post = routes.find((r) => r.method === "POST");
    if (!post) return;
    const provider = new OpenApiValidationProvider();
    const result = await provider.resolve(post, match);
    expect(result.fields.length).toBeGreaterThan(0);
    const names = result.fields.map((f) => f.fieldName);
    expect(names).toContain("name");
    expect(names).toContain("email");
  });

  // `IValidationSpec` separa el tipo lógico del formato semántico:
  // `format: email` en el spec OpenAPI es un string con formato email,
  // no un tipo "email" (que no existe en el contrato).
  test("campo email es string con format 'email'", async () => {
    const match = await new OpenApiProjectScanner().resolve(ROOT);
    const routes = await new OpenApiRouteScanner().scan(match);
    const post = routes.find((r) => r.method === "POST");
    expect(post).toBeDefined();
    const result = await new OpenApiValidationProvider().resolve(post!, match);
    const email = result.fields.find((f) => f.fieldName === "email");
    expect(email).toBeDefined();
    expect(email?.type).toBe("string");
    expect(email?.format).toBe("email");
  });

  test("comprehensive: detecta >20 rutas con $ref schemas y parámetros", async () => {
    const match = await new OpenApiProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new OpenApiRouteScanner().scan(match);
    expect(routes.length).toBeGreaterThanOrEqual(20);
  });
});

// ---------------------------------------------------------------------------
// parseYamlLite: ramas del parser que los fixtures normales no provocan.
// ---------------------------------------------------------------------------

describe("parseYamlLite — escalares, keys con quotes y flow collections", () => {
  test("~ y null se convierten a null; booleans y números también", () => {
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

  test("keys y valores entre comillas simples/dobles pierden el quote", () => {
    const parsed = parseYamlLite(
      "'200': ok\n\"404\": ko\nclave: 'con simples'\notra: \"con dobles\"",
    ) as Record<string, unknown>;
    expect(parsed["200"]).toBe("ok");
    expect(parsed["404"]).toBe("ko");
    expect(parsed.clave).toBe("con simples");
    expect(parsed.otra).toBe("con dobles");
  });

  test("secuencias de scalars y de mappings inline con continuación", () => {
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

  test("secuencia con mapping en bloque anidado tras '- ' vacío", () => {
    const parsed = parseYamlLite(
      ["cosas:", "  -", "    a: 1", "    b: dos"].join("\n"),
    ) as Record<string, unknown>;
    expect(parsed.cosas).toEqual([{ a: 1, b: "dos" }]);
  });

  test("bloques literales | y > tanto en mapping como tras '- clave:'", () => {
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

  test("flow sequence y flow mapping (incluido vacío y con URLs con ':')", () => {
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
    // `soloclave` no tiene `:` a nivel top: se descarta, no rompe.
    expect(parsed.sinSeparador).toEqual({ x: 1 });
  });

  test("tabuladores se sanitizan (YAML no los admite)", () => {
    const parsed = parseYamlLite("a:\n\tb: 1") as Record<string, unknown>;
    expect(parsed.a).toEqual({ b: 1 });
  });

  test("YAML que no es un mapping (array top-level) devuelve array", () => {
    expect(parseYamlLite("- 1\n- 2")).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// OpenApiRouteScanner: ramas de scan() fuera del happy path.
// ---------------------------------------------------------------------------

describe("OpenApiRouteScanner — ramas de scan()", () => {
  test("opts.specPath gana sobre los artefactos detectados", async () => {
    const project = await createTempProject({
      "openapi.json": JSON.stringify({ paths: { "/raiz": { get: { summary: "raiz" } } } }),
      "docs/openapi.json": JSON.stringify({ paths: { "/docs": { get: { summary: "docs" } } } }),
    });
    try {
      const match = await new OpenApiProjectScanner().resolve(project.root);
      expect(match.artifacts[0]).toBe("openapi.json");
      const routes = await new OpenApiRouteScanner({ specPath: "docs/openapi.json" }).scan(match);
      expect(routes.map((r) => r.uri)).toEqual(["/docs"]);
      expect(routes[0]?.sourceFile).toBe("docs/openapi.json#GET/docs");
    } finally {
      await project.cleanup();
    }
  });

  test("specPath a un fichero que no existe devuelve []", async () => {
    const project = await createTempProject({
      "openapi.json": JSON.stringify({ paths: {} }),
    });
    try {
      const match = await new OpenApiProjectScanner().resolve(project.root);
      const routes = await new OpenApiRouteScanner({ specPath: "missing.json" }).scan(match);
      expect(routes).toEqual([]);
    } finally {
      await project.cleanup();
    }
  });

  test("match sin artefactos devuelve []", async () => {
    const routes = await new OpenApiRouteScanner().scan({
      framework: "openapi",
      projectRoot: "/tmp",
      artifacts: [],
    });
    expect(routes).toEqual([]);
  });

  test("JSON inválido lanza con mensaje claro", async () => {
    const project = await createTempProject({ "openapi.json": "{no es json" });
    try {
      const match = await new OpenApiProjectScanner().resolve(project.root);
      await expect(new OpenApiRouteScanner().scan(match)).rejects.toThrow("cannot parse");
    } finally {
      await project.cleanup();
    }
  });

  test("YAML con anclas avisa por console.warn pero no lanza", async () => {
    const project = await createTempProject({
      "openapi.yaml": "paths:\n  /a:\n    get:\n      summary: &s hola\n",
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const match = await new OpenApiProjectScanner().resolve(project.root);
      const routes = await new OpenApiRouteScanner().scan(match);
      expect(warn).toHaveBeenCalled();
      expect(routes.map((r) => r.uri)).toEqual(["/a"]);
    } finally {
      warn.mockRestore();
      await project.cleanup();
    }
  });

  test("basePath de opts gana sobre el del spec y llena prefixChain", async () => {
    const project = await createTempProject({
      "openapi.json": JSON.stringify({ basePath: "/v3", paths: { "/users": { get: {} } } }),
    });
    try {
      const match = await new OpenApiProjectScanner().resolve(project.root);
      const conOpcion = await new OpenApiRouteScanner({ basePath: "/api/v2" }).scan(match);
      expect(conOpcion[0]?.uri).toBe("/api/v2/users");
      expect(conOpcion[0]?.prefixChain).toEqual(["/api/v2"]);
      const sinOpcion = await new OpenApiRouteScanner().scan(match);
      expect(sinOpcion[0]?.uri).toBe("/v3/users");
      expect(sinOpcion[0]?.prefixChain).toEqual(["/v3"]);
    } finally {
      await project.cleanup();
    }
  });

  test("sin basePath la prefixChain queda vacía y las barras dobles se colapsan", async () => {
    const project = await createTempProject({
      "openapi.json": JSON.stringify({ paths: { "/users": { get: {} } } }),
    });
    try {
      const match = await new OpenApiProjectScanner().resolve(project.root);
      const routes = await new OpenApiRouteScanner().scan(match);
      expect(routes[0]?.prefixChain).toEqual([]);
      expect(routes[0]?.uri).toBe("/users");
    } finally {
      await project.cleanup();
    }
  });

  test("displayName y description: operationId > summary > método+path", async () => {
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
      const routes = await new OpenApiRouteScanner().scan(match);
      const get = routes.find((r) => r.method === "GET");
      expect(get?.displayName).toBe("opId");
      expect(get?.tags).toEqual(["t1", "t2"]);
      expect(get?.description).toBe("D");
      const post = routes.find((r) => r.method === "POST");
      expect(post?.displayName).toBe("SoloSummary");
      // Sin description propia, el summary hace de description.
      expect(post?.description).toBe("SoloSummary");
      expect(post?.tags).toBeUndefined();
      const put = routes.find((r) => r.method === "PUT");
      expect(put?.displayName).toBe("PUT /x");
      expect(put?.description).toBeUndefined();
    } finally {
      await project.cleanup();
    }
  });

  test("verbos minoritarios head/options/trace también salen", async () => {
    const project = await createTempProject({
      "openapi.json": JSON.stringify({
        paths: { "/y": { head: {}, options: {}, trace: {} } },
      }),
    });
    try {
      const match = await new OpenApiProjectScanner().resolve(project.root);
      const methods = (await new OpenApiRouteScanner().scan(match)).map((r) => r.method).sort();
      expect(methods).toEqual(["HEAD", "OPTIONS", "TRACE"]);
    } finally {
      await project.cleanup();
    }
  });

  test("pathItem u op que no son objetos se descartan sin lanzar", async () => {
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
      const routes = await new OpenApiRouteScanner().scan(match);
      expect(routes.map((r) => `${r.method} ${r.uri}`)).toEqual(["POST /medio"]);
    } finally {
      await project.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// OpenApiValidationProvider: los caminos que el mini-fixture no toca.
// ---------------------------------------------------------------------------

/** Monta un proyecto temporal con un spec JSON y lo deja listo para el provider. */
async function specProject(spec: unknown) {
  const project = await createTempProject({
    "openapi.json": typeof spec === "string" ? spec : JSON.stringify(spec),
  });
  const match = await new OpenApiProjectScanner().resolve(project.root);
  return { project, match };
}

describe("OpenApiValidationProvider — ramas de resolve()", () => {
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

  test("match sin artefactos devuelve fields vacías y endpointKey normalizada", async () => {
    const result = await provider.resolve(
      { method: "GET", uri: "/Users", rawUri: "/Users", sourceFile: "", lineNumber: 0, prefixChain: [] },
      { framework: "openapi", projectRoot: "/tmp", artifacts: [] },
    );
    expect(result.endpointKey).toBe("get /users");
    expect(result.fields).toEqual([]);
  });

  test("spec ilegible (JSON roto) devuelve fields vacías sin lanzar", async () => {
    const { project, match } = await specProject("{roto");
    try {
      const result = await provider.resolve(rutaDe("GET", "/users"), match);
      expect(result.fields).toEqual([]);
    } finally {
      await project.cleanup();
    }
  });

  test("rawUri sin pathItem u op en el spec devuelve fields vacías", async () => {
    const { project, match } = await specProject({ paths: { "/users": { post: {} } } });
    try {
      const sinPath = await provider.resolve(rutaDe("GET", "/no-existe"), match);
      expect(sinPath.fields).toEqual([]);
      // El path existe pero no el verbo.
      const sinOp = await provider.resolve(rutaDe("GET", "/users"), match);
      expect(sinOp.fields).toEqual([]);
    } finally {
      await project.cleanup();
    }
  });

  test("parameters de path, de op, $ref y defaults de 'in'", async () => {
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
      const result = await provider.resolve(rutaDe("GET", "/users"), match);
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

  test("requestBody con tipos scalar, formatos date/datetime, enum y file", async () => {
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
      const result = await provider.resolve(rutaDe("POST", "/things"), match);
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

  test("requestBody con $ref top-level, allOf mixto y ciclo de $ref acotado", async () => {
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
      const porRef = await provider.resolve(rutaDe("POST", "/ref"), match);
      expect(porRef.fields.map((f) => f.fieldName)).toContain("id");

      const allOf = await provider.resolve(rutaDe("POST", "/allof"), match);
      const mergeado = new Map(allOf.fields.map((f) => [f.fieldName, f]));
      expect(mergeado.get("id")?.required).toBe(true);
      expect(mergeado.get("name")?.required).toBe(true);

      // El ciclo no puede colgar: la cota de $ref visitados corta la rama.
      const ciclo = await provider.resolve(rutaDe("POST", "/ciclo"), match);
      expect(ciclo.fields).toEqual([]);

      // Schema vacío: ni properties ni required → cero campos.
      const vacio = await provider.resolve(rutaDe("POST", "/vacio"), match);
      expect(vacio.fields).toEqual([]);
    } finally {
      await project.cleanup();
    }
  });

  test("spec YAML (no .json) también resuelve campos del provider", async () => {
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
      const result = await provider.resolve(rutaDe("POST", "/yaml"), match);
      expect(result.fields.map((f) => f.fieldName)).toEqual(["name"]);
    } finally {
      await project.cleanup();
    }
  });
});
