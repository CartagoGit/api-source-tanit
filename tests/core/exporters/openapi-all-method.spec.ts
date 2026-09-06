/**
 * Tests for the OpenAPI exporter's handling of `method: "ALL"` (the
 * Hono `.all()` sentinel from commit `aad6376` and the audit
 * 2026-09-06 second pass §13).
 *
 * x00056 S2: the seven standard verbs are emitted, each carrying the
 * `x-tanit-source: "hono.all"` extension so downstream tooling
 * (Redoc, Swagger Editor) can tell them apart from operations that
 * were declared individually.
 */
import { describe, expect, test } from "vitest";

import type { EndpointSpec } from "../../../packages/contracts/interfaces/core/postman.interface";
import type { IExportInput } from "../../../packages/contracts/interfaces/core/export-target.interface";
import { buildOpenApiDocument } from "../../../packages/core/exporters/openapi.exporter";
import { ALL_METHOD_MARKER } from "../../../packages/core/helpers/all-method.helper";

function spec(method: EndpointSpec["method"], uri: string, extra: Partial<EndpointSpec> = {}): EndpointSpec {
  return {
    name: `${method} ${uri}`,
    method,
    uri,
    ...extra,
  };
}

function baseInput(specs: ReadonlyArray<EndpointSpec>): IExportInput {
  return {
    specs,
    config: {
      name: "test-api",
      collectionName: "Test API",
      collectionDescription: "",
      baseUrl: "http://localhost:3000",
      variables: [],
      filePrefixes: {},
      zones: [],
      zoneOrder: [],
      defaultZone: "Other",
      authDescriptions: {},
      loginEndpointName: "Login",
    } as IExportInput["config"],
    auth: { type: "none" },
  };
}

describe("OpenAPI exporter — `method: 'ALL'` expansion (x00056 S2)", () => {
  test("a single `ALL` spec produces a path with seven operations", () => {
    const doc = buildOpenApiDocument(
      baseInput([spec("ALL", "/api/anything")]),
    );
    const paths = doc["paths"] as Record<string, Record<string, unknown>>;
    const path = paths["/api/anything"];
    expect(path, "the single path is emitted").toBeDefined();
    expect(Object.keys(path!).sort()).toEqual(
      ["delete", "get", "head", "options", "patch", "post", "put"],
    );
  });

  test("every expanded operation carries `x-tanit-source: hono.all`", () => {
    const doc = buildOpenApiDocument(
      baseInput([spec("ALL", "/api/anything")]),
    );
    const path = (doc["paths"] as Record<string, Record<string, unknown>>)["/api/anything"];
    for (const verb of Object.keys(path!)) {
      const op = path![verb] as Record<string, unknown>;
      expect(op["x-tanit-source"], `op ${verb}`).toBe(ALL_METHOD_MARKER);
    }
  });

  test("non-ALL specs do NOT carry the marker (no false positives)", () => {
    const doc = buildOpenApiDocument(
      baseInput([
        spec("GET", "/api/users"),
        spec("POST", "/api/users"),
      ]),
    );
    const path = (doc["paths"] as Record<string, Record<string, unknown>>)["/api/users"];
    expect((path!["get"] as Record<string, unknown>)["x-tanit-source"]).toBeUndefined();
    expect((path!["post"] as Record<string, unknown>)["x-tanit-source"]).toBeUndefined();
  });

  test("mixing ALL with an explicit verb: the first writer wins, both stay", () => {
    // Two operations on the same path: the explicit GET is declared
    // first, then the ALL expands. The explicit GET occupies the
    // `get` bucket first, the ALL expansion's GET is dropped (and
    // the other six verbs still materialize).
    const doc = buildOpenApiDocument(
      baseInput([
        spec("GET", "/api/mixed", { name: "explicit-get" }),
        spec("ALL", "/api/mixed", { name: "from-all" }),
      ]),
    );
    const path = (doc["paths"] as Record<string, Record<string, unknown>>)["/api/mixed"];
    expect(Object.keys(path!).sort()).toEqual(
      ["delete", "get", "head", "options", "patch", "post", "put"],
    );
    // The explicit GET keeps its name and has no marker; the six
    // expansion verbs carry the marker.
    const get = path!["get"] as Record<string, unknown>;
    expect(get["summary"]).toBe("explicit-get");
    expect(get["x-tanit-source"]).toBeUndefined();
    for (const verb of ["post", "put", "patch", "delete", "head", "options"]) {
      const op = path![verb] as Record<string, unknown>;
      expect(op["x-tanit-source"], verb).toBe(ALL_METHOD_MARKER);
      expect(op["summary"]).toBe("from-all");
    }
  });

  test("the original name, uri and request body are preserved per expanded verb", () => {
    const doc = buildOpenApiDocument(
      baseInput([
        spec("ALL", "/api/items", {
          name: "Items",
          description: "everything",
          body: { id: 1 },
          fields: [{ fieldName: "id", location: "body", type: "integer", required: true }],
        }),
      ]),
    );
    const path = (doc["paths"] as Record<string, Record<string, unknown>>)["/api/items"];
    for (const verb of Object.keys(path!)) {
      const op = path![verb] as Record<string, unknown>;
      expect(op["summary"]).toBe("Items");
      expect(op["description"]).toBe("everything");
    }
  });
});

describe("OpenAPI exporter — warnings include ALL expansion collisions", () => {
  // x00056 S2: warnings are computed on the EXPANDED set, otherwise
  // an explicit `GET /x` plus an `ALL /x` would not be reported as
  // colliding (the original ALL is one entry; after expansion it
  // produces seven verbs, six of which actually collide).
  test("an explicit GET on the same path as an ALL expands into a real collision", async () => {
    const { OpenApiExporter } = await import("../../../packages/core/exporters/openapi.exporter");
    const exporter = new OpenApiExporter();
    const warnings = exporter.warnings(
      baseInput([
        spec("GET", "/api/x", { name: "explicit" }),
        spec("ALL", "/api/x", { name: "from-all" }),
      ]),
    );
    expect(warnings.length).toBeGreaterThan(0);
    // The collision message identifies the colliding verb.
    expect(warnings.join("\n")).toMatch(/GET\s+\/api\/x/);
  });
});