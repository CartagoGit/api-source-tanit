/**
 * Fastify response inferrer (proposal `r00020` S3).
 *
 * Fastify is the only one of the six that **declares** its response
 * schema, so its spec asserts on the declaration: the statuses the
 * route declares, the shape of each one, and which fields are
 * required.
 *
 * The fixture is `tests/fixtures/fastify-responses/` — a real Fastify
 * app whose routes declare `schema.response`.
 */
import { describe, expect, test } from "vitest";

import { FastifyResponseInferrer } from "../../packages/core/response-inference/fastify.helper.js";
import {
  contextOf,
  contextOfSource,
  fieldsOf,
  lineOf,
  readFixture,
  routeOf,
} from "./response-inference.helper.js";

const FIXTURE = "fastify-responses";
const SERVER = "src/server.ts";
const SOURCE = readFixture(FIXTURE, SERVER);

const inferrer = new FastifyResponseInferrer();

describe("Fastify response inferrer — schema.response (r00020 S3)", () => {
  test("detects only Fastify", () => {
    const route = routeOf({ method: "GET", uri: "/users" });
    expect(inferrer.detect("fastify", route)).toBe(true);
    expect(inferrer.detect("express", route)).toBe(false);
  });

  test("reads the declared status, shape and required fields of GET /users", () => {
    const route = routeOf({
      method: "GET",
      uri: "/users",
      rawUri: "/users",
      sourceFile: SERVER,
      lineNumber: lineOf(SOURCE, "app.get("),
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "fastify", SERVER));

    expect(spec).not.toBeNull();
    const responses = spec?.responses ?? [];
    expect(responses).toHaveLength(1);

    const entry = responses[0];
    expect(entry?.status).toBe(200);
    expect(entry?.confidence).toBe("high");
    expect(entry?.reason).toContain("Fastify schema.response.200");
    expect(fieldsOf(entry?.schema).map((f) => f.name)).toEqual([
      "id",
      "name",
      "email",
    ]);
    expect(fieldsOf(entry?.schema).filter((f) => f.required).map((f) => f.name)).toEqual([
      "id",
      "name",
    ]);
  });

  test("reads every status the route declares", () => {
    const route = routeOf({
      method: "POST",
      uri: "/users",
      rawUri: "/users",
      sourceFile: SERVER,
      lineNumber: lineOf(SOURCE, "app.post("),
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "fastify", SERVER));

    const statuses = (spec?.responses ?? []).map((r) => r.status).sort();
    expect(statuses).toEqual([201, 400]);
  });

  test("does not read the schema of another route", () => {
    const route = routeOf({
      method: "GET",
      uri: "/users",
      rawUri: "/users",
      sourceFile: SERVER,
      lineNumber: lineOf(SOURCE, "app.get("),
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "fastify", SERVER));

    // The POST /users route declares a 201 and a 400; the GET route
    // declares a 200. Reading the wrong declaration is the failure
    // this assertion exists for.
    expect((spec?.responses ?? []).map((r) => r.status)).toEqual([200]);
  });

  test("a route without a declared schema answers nothing", () => {
    const route = routeOf({
      method: "GET",
      uri: "/health",
      rawUri: "/health",
      sourceFile: SERVER,
      lineNumber: lineOf(SOURCE, 'app.get("/health"'),
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "fastify", SERVER));

    expect(spec).toBeNull();
  });

  test("a route that is not in the file answers nothing", () => {
    const route = routeOf({
      method: "GET",
      uri: "/orders",
      rawUri: "/orders",
      sourceFile: SERVER,
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "fastify", SERVER));

    expect(spec).toBeNull();
  });

  test("a declared `$ref` is a reference, not a structural schema", () => {
    const source = [
      'app.get("/things", {',
      "  schema: {",
      "    response: {",
      '      200: { $ref: "Thing#" },',
      "    },",
      "  },",
      "}, handler);",
    ].join("\n");
    const route = routeOf({ method: "GET", uri: "/things", rawUri: "/things" });
    const spec = inferrer.infer(route, contextOfSource("fastify", source));

    const entry = spec?.responses[0];
    expect(entry?.status).toBe(200);
    expect(entry?.schema.kind).toBe("ref");
    if (entry?.schema.kind === "ref") {
      expect(entry.schema.$ref).toBe("Thing#");
    }
  });

  test("a handler that overrides the status answers with the override", () => {
    const source = [
      'app.get("/thing", async (request, reply) => {',
      "  reply.code(202).send({});",
      "});",
    ].join("\n");
    const route = routeOf({ method: "GET", uri: "/thing", rawUri: "/thing" });
    const spec = inferrer.infer(route, contextOfSource("fastify", source));

    const entry = spec?.responses[0];
    expect(entry?.status).toBe(202);
    expect(entry?.confidence).toBe("low");
  });
});
