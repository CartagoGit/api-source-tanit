/**
 * Ktor response inferrer (proposal `r00020` S3).
 *
 * The signal is `call.respond(status, payload)`. The spec asserts on
 * the status read from the `HttpStatusCode` enum, on the payload
 * (a constructor names its type; no payload is an empty body) and on
 * the fact that a handler may answer **twice**.
 *
 * The fixture is `tests/fixtures/ktor-responses/` — a real Ktor app.
 */
import { describe, expect, test } from "vitest";

import { KtorRespondResponseInferrer } from "../../packages/core/response-inference/ktor-respond.helper.js";
import {
  contextOf,
  contextOfSource,
  lineOf,
  readFixture,
  routeOf,
} from "./response-inference.helper.js";

const FIXTURE = "ktor-responses";
const MAIN = "src/main.kt";
const SOURCE = readFixture(FIXTURE, MAIN);

const inferrer = new KtorRespondResponseInferrer();

describe("Ktor response inferrer — call.respond (r00020 S3)", () => {
  test("detects only Ktor", () => {
    const route = routeOf({ method: "GET", uri: "/users" });
    expect(inferrer.detect("ktor", route)).toBe(true);
    expect(inferrer.detect("gin", route)).toBe(false);
  });

  test("reads the status of the enum and the type of the payload", () => {
    const route = routeOf({
      method: "GET",
      uri: "/users",
      rawUri: "/users",
      sourceFile: MAIN,
      lineNumber: lineOf(SOURCE, 'get("/users")'),
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "ktor", MAIN));

    const entry = spec?.responses[0];
    expect(entry?.status).toBe(200);
    expect(entry?.confidence).toBe("medium");
    expect(entry?.schema.kind).toBe("ref");
    if (entry?.schema.kind === "ref") {
      expect(entry.schema.$ref).toBe("users");
    }
  });

  test("a handler that answers twice declares two responses", () => {
    const route = routeOf({
      method: "GET",
      uri: "/users/{id}",
      rawUri: "/users/{id}",
      sourceFile: MAIN,
      lineNumber: lineOf(SOURCE, 'get("/users/{id}")'),
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "ktor", MAIN));

    const statuses = (spec?.responses ?? []).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 404]);
  });

  test("a response without a payload has an empty body", () => {
    const route = routeOf({
      method: "DELETE",
      uri: "/users/{id}",
      rawUri: "/users/{id}",
      sourceFile: MAIN,
      lineNumber: lineOf(SOURCE, 'delete("/users/{id}")'),
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "ktor", MAIN));

    const entry = spec?.responses[0];
    expect(entry?.status).toBe(204);
    expect(entry?.schema.kind).toBe("empty");
    expect(entry?.confidence).toBe("high");
  });

  test("a constructor call names the type of the response", () => {
    const source = [
      'post("/users") {',
      '  call.respond(HttpStatusCode.Created, User(2, "Grace"))',
      "}",
    ].join("\n");
    const route = routeOf({ method: "POST", uri: "/users", rawUri: "/users" });
    const spec = inferrer.infer(route, contextOfSource("ktor", source));

    const entry = spec?.responses[0];
    expect(entry?.status).toBe(201);
    if (entry?.schema.kind === "ref") {
      expect(entry.schema.$ref).toBe("User");
    }
  });

  test("a route that is not in the file answers nothing", () => {
    const route = routeOf({
      method: "GET",
      uri: "/orders",
      rawUri: "/orders",
      sourceFile: MAIN,
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "ktor", MAIN));

    expect(spec).toBeNull();
  });
});
