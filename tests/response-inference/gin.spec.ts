/**
 * Gin response inferrer (proposal `r00020` S3).
 *
 * Gin declares nothing: the signal is the `c.JSON(status, payload)`
 * call. The spec asserts on the status — read from the literal or
 * from the `net/http` constant — and on the shape of the map.
 *
 * The fixture is `tests/fixtures/gin-responses/` — a real Gin app.
 */
import { describe, expect, test } from "vitest";

import { GinResponseInferrer } from "../../packages/core/response-inference/gin.helper.js";
import {
  contextOf,
  contextOfSource,
  fieldsOf,
  lineOf,
  readFixture,
  routeOf,
} from "./response-inference.helper.js";

const FIXTURE = "gin-responses";
const MAIN = "main.go";
const SOURCE = readFixture(FIXTURE, MAIN);

const inferrer = new GinResponseInferrer();

describe("Gin response inferrer — c.JSON (r00020 S3)", () => {
  test("detects only Gin", () => {
    const route = routeOf({ method: "GET", uri: "/users" });
    expect(inferrer.detect("gin", route)).toBe(true);
    expect(inferrer.detect("express", route)).toBe(false);
  });

  test("reads the status from the net/http constant and the shape of the map", () => {
    const route = routeOf({
      method: "GET",
      uri: "/users",
      rawUri: "/users",
      sourceFile: MAIN,
      lineNumber: lineOf(SOURCE, 'r.GET("/users"'),
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "gin", MAIN));

    const entry = spec?.responses[0];
    expect(entry?.status).toBe(200);
    expect(entry?.confidence).toBe("medium");
    expect(entry?.reason).toContain("Gin c.JSON(200");
    expect(fieldsOf(entry?.schema).map((f) => f.name)).toEqual(["id", "name"]);
  });

  test("reads the status of a literal as well", () => {
    const source = [
      'r.GET("/x", func(c *gin.Context) {',
      '  c.JSON(202, gin.H{"ok": true})',
      "})",
    ].join("\n");
    const route = routeOf({ method: "GET", uri: "/x", rawUri: "/x" });
    const spec = inferrer.infer(route, contextOfSource("gin", source));

    expect(spec?.responses[0]?.status).toBe(202);
  });

  test("a status that is not a known constant answers nothing", () => {
    const source = [
      'r.GET("/x", func(c *gin.Context) {',
      "  c.JSON(code, gin.H{\"ok\": true})",
      "})",
    ].join("\n");
    const route = routeOf({ method: "GET", uri: "/x", rawUri: "/x" });
    const spec = inferrer.infer(route, contextOfSource("gin", source));

    expect(spec).toBeNull();
  });

  test("a POST route does not read the response of the GET route", () => {
    const route = routeOf({
      method: "POST",
      uri: "/users",
      rawUri: "/users",
      sourceFile: MAIN,
      lineNumber: lineOf(SOURCE, 'r.POST("/users"'),
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "gin", MAIN));

    const entry = spec?.responses[0];
    expect(entry?.status).toBe(201);
    expect(fieldsOf(entry?.schema).map((f) => f.name)).toEqual(["id", "name"]);
  });

  test("a route that is not in the file answers nothing", () => {
    const route = routeOf({
      method: "GET",
      uri: "/orders",
      rawUri: "/orders",
      sourceFile: MAIN,
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "gin", MAIN));

    expect(spec).toBeNull();
  });

  test("a handler that does not render JSON answers nothing", () => {
    const source = [
      'r.GET("/x", func(c *gin.Context) {',
      '  c.String(200, "ok")',
      "})",
    ].join("\n");
    const route = routeOf({ method: "GET", uri: "/x", rawUri: "/x" });
    const spec = inferrer.infer(route, contextOfSource("gin", source));

    expect(spec).toBeNull();
  });
});
