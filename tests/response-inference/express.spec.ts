/**
 * Express response inferrer (proposal `r00020` S3).
 *
 * Express declares nothing, so the spec asserts on what the handler
 * sends: the status the chain declares, the shape of the payload, and
 * the difference between a literal and a reference.
 *
 * The fixture is `tests/fixtures/express-responses/` — a real Express
 * app whose handlers answer with `res.json`.
 */
import { describe, expect, test } from "vitest";

import { ExpressResponseInferrer } from "../../packages/core/response-inference/express.helper.js";
import {
  contextOf,
  contextOfSource,
  fieldsOf,
  lineOf,
  readFixture,
  routeOf,
} from "./response-inference.helper.js";

const FIXTURE = "express-responses";
const APP = "src/app.ts";
const SOURCE = readFixture(FIXTURE, APP);

const inferrer = new ExpressResponseInferrer();

describe("Express response inferrer — res.json (r00020 S3)", () => {
  test("detects only Express", () => {
    const route = routeOf({ method: "GET", uri: "/users" });
    const ctx = contextOf(FIXTURE, "express", APP);
    expect(inferrer.detect("express", route, ctx)).toBe(true);
    expect(inferrer.detect("fastify", route, ctx)).toBe(false);
  });

  test("reads the payload of GET /users as the shape of the response", () => {
    const route = routeOf({
      method: "GET",
      uri: "/users",
      rawUri: "/users",
      sourceFile: APP,
      lineNumber: lineOf(SOURCE, 'app.get("/users"'),
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "express", APP));

    expect(spec).not.toBeNull();
    const entry = spec?.responses[0];
    expect(entry?.status).toBe(200);
    expect(entry?.confidence).toBe("medium");
    expect(fieldsOf(entry?.schema).map((f) => f.name)).toEqual([
      "id",
      "name",
      "email",
    ]);
  });

  test("reads the status the chain declares", () => {
    const route = routeOf({
      method: "POST",
      uri: "/users",
      rawUri: "/users",
      sourceFile: APP,
      lineNumber: lineOf(SOURCE, 'app.post("/users"'),
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "express", APP));

    const entry = spec?.responses[0];
    expect(entry?.status).toBe(201);
    expect(entry?.reason).toContain("res.status(201)");
  });

  test("a payload that is a variable is a reference, not a shape", () => {
    const route = routeOf({
      method: "GET",
      uri: "/users/:id",
      rawUri: "/users/:id",
      sourceFile: APP,
      lineNumber: lineOf(SOURCE, 'app.get("/users/:id"'),
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "express", APP));

    const entry = spec?.responses[0];
    expect(entry?.status).toBe(200);
    expect(entry?.confidence).toBe("low");
    expect(entry?.schema.kind).toBe("ref");
    if (entry?.schema.kind === "ref") {
      expect(entry.schema.$ref).toBe("user");
    }
  });

  test("a handler that sends a plain string answers nothing", () => {
    const route = routeOf({
      method: "GET",
      uri: "/health",
      rawUri: "/health",
      sourceFile: APP,
      lineNumber: lineOf(SOURCE, 'app.get("/health"'),
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "express", APP));

    expect(spec).toBeNull();
  });

  test("the response of a route is not the response of the next one", () => {
    const source = [
      'app.get("/a", (req, res) => {',
      "  res.json({ id: 1 });",
      "});",
      'app.get("/b", (req, res) => {',
      "  res.json({ name: \"b\" });",
      "});",
    ].join("\n");
    const route = routeOf({ method: "GET", uri: "/b", rawUri: "/b" });
    const spec = inferrer.infer(route, contextOfSource("express", source));

    const entry = spec?.responses[0];
    expect(fieldsOf(entry?.schema).map((f) => f.name)).toEqual(["name"]);
  });

  test("a route that is not in the file answers nothing", () => {
    const route = routeOf({
      method: "GET",
      uri: "/orders",
      rawUri: "/orders",
      sourceFile: APP,
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "express", APP));

    expect(spec).toBeNull();
  });
});
