/**
 * f00014 — Postman exporter emits inferred response[] examples.
 *
 * Closes the Postman half of f00012 S4. The OpenAPI exporter already
 * emits `responses.<status>`; the Postman side had been silent until
 * this slice.
 */
import { describe, expect, test } from "vitest";

import {
  renderInferredPostmanResponses,
} from "../../packages/core/exporters/postman-inferred-response";
import type {
  IResponseInference,
} from "../../packages/contracts/interfaces/core/responses.interface";
import type { EndpointSpec } from "../../packages/contracts/interfaces/core/postman.interface";

const BASE_SPEC: EndpointSpec = {
  method: "GET",
  uri: "/users",
};

function entry(
  status: number,
  reason = "@ApiOkResponse",
  confidence: "high" | "medium" | "low" = "high",
  schema: IResponseInference["schema"] = { kind: "empty" },
): IResponseInference {
  return { status, reason, confidence, schema };
}

describe("f00014 — renderInferredPostmanResponses", () => {
  test("(1) spec without responses → undefined (no `response[]` block)", () => {
    expect(renderInferredPostmanResponses(BASE_SPEC)).toBeUndefined();
    const withEmpty: EndpointSpec = { ...BASE_SPEC, responses: [] };
    expect(renderInferredPostmanResponses(withEmpty)).toBeUndefined();
  });

  test("(2) one entry → one response with code/name/header/body", () => {
    const spec: EndpointSpec = {
      ...BASE_SPEC,
      responses: [
        entry(200, "NestJS return type", "high", { kind: "empty" }),
      ],
    };
    const out = renderInferredPostmanResponses(spec);
    expect(out).toHaveLength(1);
    const item = out![0]!;
    expect(item.code).toBe(200);
    expect(item.status).toBe("OK");
    expect(item.name).toContain("NestJS return type");
    expect(item.header).toEqual([
      { key: "Content-Type", value: "application/json", type: "text" },
    ]);
    expect(item.body).toBe("");
  });

  test("(3) low confidence → preview marker comment", () => {
    const spec: EndpointSpec = {
      ...BASE_SPEC,
      responses: [entry(200, "fallback heuristic", "low", { kind: "empty" })],
    };
    const out = renderInferredPostmanResponses(spec)!;
    expect(out[0]?._postman_previewlanguage).toContain("low confidence");
    expect(out[0]?._postman_previewlanguage).toContain("fallback heuristic");
  });

  test("(4) multiple statuses → multiple entries", () => {
    const spec: EndpointSpec = {
      ...BASE_SPEC,
      responses: [
        entry(200, "happy path"),
        entry(404, "missing"),
        entry(500, "server error"),
      ],
    };
    const out = renderInferredPostmanResponses(spec)!;
    expect(out).toHaveLength(3);
    const codes = out.map((r) => r.code);
    expect(codes).toEqual([200, 404, 500]);
  });

  test("(5) complex schema (array of objects) → body serializes to JSON", () => {
    // Mimic a schema-graph with root → array → object → scalar fields.
    const spec: EndpointSpec = {
      ...BASE_SPEC,
      responses: [
        {
          status: 200,
          reason: "List response",
          confidence: "high",
          schema: {
            kind: "schema-graph",
            graph: {
              nodes: new Map<string, any>([
                [
                  "root",
                  {
                    id: "root",
                    kind: "array",
                    element: {
                      id: "item",
                      kind: "object",
                      fields: [
                        { key: "id", value: { id: "f1", kind: "scalar", scalarType: "number" } },
                        { key: "name", value: { id: "f2", kind: "scalar", scalarType: "string" } },
                      ],
                    },
                  },
                ],
              ]),
              root: "root",
            },
          },
        },
      ],
    };
    const out = renderInferredPostmanResponses(spec)!;
    expect(out[0]?.body).toBe('[\n  {\n    "id": 0,\n    "name": ""\n  }\n]');
  });

  test("(6) deduplicates by (status, reason)", () => {
    const spec: EndpointSpec = {
      ...BASE_SPEC,
      responses: [
        entry(200, "x"),
        entry(200, "x"),
        entry(200, "x"),
      ],
    };
    expect(renderInferredPostmanResponses(spec)).toHaveLength(1);
  });

  test("(7) `ref` schema → `{}` placeholder", () => {
    const spec: EndpointSpec = {
      ...BASE_SPEC,
      responses: [entry(200, "named", "high", { kind: "ref", $ref: "UserDto" })],
    };
    expect(renderInferredPostmanResponses(spec)![0]?.body).toBe("{}");
  });
});