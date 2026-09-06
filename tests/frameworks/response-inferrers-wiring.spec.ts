/**
 * f00012 wiring — the inferrers actually register and the results
 * reach the OpenAPI document.
 *
 * Before this wiring the four `*.response-inferrer.ts` modules
 * self-registered on import, but **no production file imported them**:
 * the registry stayed empty, `inferResponses()` always returned `[]`,
 * and the OpenAPI exporter hard-coded `200: OK` for everything. These
 * tests pin the three links of the chain:
 *
 * 1. `ensureResponseInferrersRegistered()` populates the registry with
 *    the four framework inferrers (spring, nestjs, fastapi, aspnet).
 * 2. `inferResponses()` produces entries for a real signal through
 *    that production path (no `__setInferrersForTest` seeding).
 * 3. `buildOpenApiDocument()` renders `spec.responses` as
 *    `responses.<status>` blocks and keeps the `200: OK` fallback for
 *    specs without inference.
 */
import { describe, expect, test } from "vitest";
import { listRegisteredInferrers } from "../../packages/core/responses/infer-responses";
import {
  ensureResponseInferrersRegistered,
} from "../../packages/frameworks/scanners/response-inferrers";
import { buildOpenApiDocument } from "../../packages/core/exporters/openapi.exporter";
import type {
  EndpointSpec,
} from "../../packages/contracts/interfaces/core/postman.interface";
import type { IExportInput } from "../../packages/contracts/interfaces/core/export-target.interface";

describe("response inferrers — production registration (f00012 wiring)", () => {
  test("ensureResponseInferrersRegistered() populates the 4 frameworks", () => {
    const count = ensureResponseInferrersRegistered();
    const frameworks = listRegisteredInferrers().map((i) => i.framework);
    expect(count).toBeGreaterThanOrEqual(4);
    for (const fw of ["springboot", "nestjs", "fastapi", "aspnet"]) {
      expect(frameworks, `missing inferrer for ${fw}`).toContain(fw);
    }
  });

  test("fastapi signal flows through the production registry", async () => {
    ensureResponseInferrersRegistered();
    // Lazy-import the dispatcher AFTER the barrel has run so the
    // registry instance is the populated one (same module instance in
    // vitest either way — the import order just documents intent).
    const { inferResponses } = await import(
      "../../packages/core/responses/infer-responses"
    );
    const entries = inferResponses(
      { method: "GET", uri: "/users" },
      {
        path: "/app/routes/users.py",
        framework: "fastapi",
        content: [
          "from fastapi import FastAPI",
          "class UserResponse(BaseModel):",
          "    id: int",
          "",
          '@app.get("/users", response_model=UserResponse)',
          "def list_users():",
          "    ...",
        ].join("\n"),
      },
    );
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.confidence).toBe("high");
  });
});

describe("OpenAPI exporter — inferred responses (f00012 wiring)", () => {
  function input(specs: ReadonlyArray<EndpointSpec>): IExportInput {
    return {
      specs,
      config: {
        name: "test-api",
        collectionName: "Test API",
        collectionDescription: "Una API de tests",
        baseUrl: "http://localhost:3000",
        variables: [],
      } as IExportInput["config"],
      auth: { type: "none" },
    };
  }

  function responsesOf(
    doc: Record<string, unknown>,
    path: string,
    method: string,
  ): Record<string, Record<string, unknown>> {
    const paths = doc["paths"] as Record<string, Record<string, unknown>>;
    const op = paths[path]?.[method] as Record<string, unknown>;
    return op["responses"] as Record<string, Record<string, unknown>>;
  }

  test("spec with inferred responses renders status blocks + $ref", () => {
    const doc = buildOpenApiDocument(
      input([
        {
          name: "Get users",
          method: "GET",
          uri: "/users",
          responses: [
            {
              status: 200,
              schema: { kind: "ref", $ref: "#/components/schemas/User" },
              confidence: "high",
              reason: "NestJS return type Promise<User>",
            },
            {
              status: 404,
              schema: { kind: "empty" },
              confidence: "medium",
              reason: "throw new NotFoundException()",
            },
          ],
        },
      ]),
    );
    const responses = responsesOf(doc, "/users", "get");
    expect(responses["200"]).toBeDefined();
    expect((responses["200"] as Record<string, unknown>)["description"]).toBe(
      "NestJS return type Promise<User>",
    );
    const content = (responses["200"] as Record<string, unknown>)[
      "content"
    ] as Record<string, Record<string, unknown>>;
    expect(content["application/json"]["schema"]).toEqual({
      $ref: "#/components/schemas/User",
    });
    // `empty` schema → status block without content.
    expect(responses["404"]).toBeDefined();
    expect((responses["404"] as Record<string, unknown>)["content"]).toBeUndefined();
  });

  test("spec without inference keeps the historical 200: OK fallback", () => {
    const doc = buildOpenApiDocument(
      input([{ name: "Get health", method: "GET", uri: "/health" }]),
    );
    const responses = responsesOf(doc, "/health", "get");
    expect(responses["200"]).toEqual({ description: "OK" });
  });

  test("duplicate statuses keep the first (dispatcher sorts by confidence)", () => {
    const doc = buildOpenApiDocument(
      input([
        {
          name: "Post users",
          method: "POST",
          uri: "/users",
          responses: [
            {
              status: 201,
              schema: { kind: "ref", $ref: "#/components/schemas/User" },
              confidence: "high",
              reason: "201 from @ApiResponse",
            },
            {
              status: 201,
              schema: { kind: "empty" },
              confidence: "low",
              reason: "fallback guess",
            },
          ],
        },
      ]),
    );
    const responses = responsesOf(doc, "/users", "post");
    const created = responses["201"] as Record<string, unknown>;
    expect(created["description"]).toBe("201 from @ApiResponse");
    expect(created["content"]).toBeDefined();
  });
});
