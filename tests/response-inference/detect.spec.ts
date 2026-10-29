/**
 * The two questions of the response-inference contract (proposal
 * `r00020` S3).
 *
 * `detect()` asks whether the route uses the construct the inferrer
 * models; `infer()` asks what the route returns. The contract says
 * `detect()` answers `false` for *"a route of my framework that does
 * not use the construct I understand"* — a Laravel controller that
 * returns a plain array, a Rails action that renders HTML.
 *
 * That is what the six inferrers of this slice answer, and this spec
 * pins it: each one says `false` for the route that does not use its
 * construct, and `true` for the one that does.
 *
 * The last test is the invariant that ties the two questions together:
 * **a route that is not detected is never inferred.** A `detect()`
 * that said `false` for a route the inferrer could answer would drop
 * a response on the floor, and the observable result would be a
 * silently missing response rather than a loud failure.
 */
import { describe, expect, test } from "vitest";

import { ExpressResponseInferrer } from "../../packages/core/response-inference/express.helper.js";
import { FastifyResponseInferrer } from "../../packages/core/response-inference/fastify.helper.js";
import { GinResponseInferrer } from "../../packages/core/response-inference/gin.helper.js";
import { KtorRespondResponseInferrer } from "../../packages/core/response-inference/ktor-respond.helper.js";
import { LaravelResourcesResponseInferrer } from "../../packages/core/response-inference/laravel-resources.helper.js";
import { RailsRenderResponseInferrer } from "../../packages/core/response-inference/rails-render.helper.js";
import {
  MEASURED_INFERRERS,
  REFERENCE_ROUTES,
} from "../helpers/response-inference-routes.helper.js";
import {
  contextOf,
  contextOfFiles,
  contextOfSource,
  routeOf,
} from "./response-inference.helper.js";

const express = new ExpressResponseInferrer();
const fastify = new FastifyResponseInferrer();
const gin = new GinResponseInferrer();
const ktor = new KtorRespondResponseInferrer();
const laravel = new LaravelResourcesResponseInferrer();
const rails = new RailsRenderResponseInferrer();

describe("detect() — the question the contract describes (r00020 S3)", () => {
  test("Express: a handler that sends nothing is not this slice", () => {
    const source = 'app.get("/x", (req, res) => { res.end(); });';
    const route = routeOf({ method: "GET", uri: "/x", rawUri: "/x" });
    const ctx = contextOfSource("express", source);
    expect(express.detect("express", route, ctx)).toBe(false);
    expect(express.infer(route, ctx)).toBeNull();
  });

  test("Express: a handler that sends JSON is", () => {
    const source = 'app.get("/x", (req, res) => { res.json({ id: 1 }); });';
    const route = routeOf({ method: "GET", uri: "/x", rawUri: "/x" });
    expect(express.detect("express", route, contextOfSource("express", source))).toBe(true);
  });

  test("Fastify: a route that declares no schema is not this slice", () => {
    const source = 'app.get("/x", async () => ({ status: "ok" }));';
    const route = routeOf({ method: "GET", uri: "/x", rawUri: "/x" });
    const ctx = contextOfSource("fastify", source);
    expect(fastify.detect("fastify", route, ctx)).toBe(false);
    expect(fastify.infer(route, ctx)).toBeNull();
  });

  test("Fastify: a route that declares a schema is", () => {
    const source = [
      'app.get("/x", { schema: { response: { 200: { type: "object",',
      '  properties: { id: { type: "integer" } } } } } }, async () => ({ id: 1 }));',
    ].join("\n");
    const route = routeOf({ method: "GET", uri: "/x", rawUri: "/x" });
    expect(fastify.detect("fastify", route, contextOfSource("fastify", source))).toBe(true);
  });

  test("Gin: a handler that renders a string is not this slice", () => {
    const source = 'r.GET("/x", func(c *gin.Context) { c.String(200, "ok") })';
    const route = routeOf({ method: "GET", uri: "/x", rawUri: "/x" });
    const ctx = contextOfSource("gin", source);
    expect(gin.detect("gin", route, ctx)).toBe(false);
    expect(gin.infer(route, ctx)).toBeNull();
  });

  test("Gin: a handler that renders JSON is", () => {
    const source = 'r.GET("/x", func(c *gin.Context) { c.JSON(200, gin.H{"id": 1}) })';
    const route = routeOf({ method: "GET", uri: "/x", rawUri: "/x" });
    expect(gin.detect("gin", route, contextOfSource("gin", source))).toBe(true);
  });

  test("Ktor: a handler that does not answer is not this slice", () => {
    const source = 'get("/x") { call.respondText("ok") }';
    const route = routeOf({ method: "GET", uri: "/x", rawUri: "/x" });
    const ctx = contextOfSource("ktor", source);
    expect(ktor.detect("ktor", route, ctx)).toBe(false);
    expect(ktor.infer(route, ctx)).toBeNull();
  });

  test("Ktor: a handler that answers is", () => {
    const source = 'get("/x") { call.respond(HttpStatusCode.OK, User(1)) }';
    const route = routeOf({ method: "GET", uri: "/x", rawUri: "/x" });
    expect(ktor.detect("ktor", route, contextOfSource("ktor", source))).toBe(true);
  });

  test("Laravel: a controller that returns a plain model is not this slice", () => {
    const controller = "app/Http/Controllers/UserController.php";
    const route = routeOf({
      method: "GET",
      uri: "/users",
      rawUri: "/users",
      controllerClass: "App\\Http\\Controllers\\UserController",
      actionName: "index",
    });
    const ctx = contextOfFiles(
      "laravel",
      {
        [controller]:
          "<?php class UserController { public function index() { return User::all(); } }",
      },
      controller,
    );
    expect(laravel.detect("laravel", route, ctx)).toBe(false);
    expect(laravel.infer(route, ctx)).toBeNull();
  });

  test("Laravel: a controller that returns a Resource is", () => {
    const controller = "app/Http/Controllers/UserController.php";
    const route = routeOf({
      method: "GET",
      uri: "/users",
      rawUri: "/users",
      controllerClass: "App\\Http\\Controllers\\UserController",
      actionName: "index",
    });
    const ctx = contextOfFiles(
      "laravel",
      {
        [controller]:
          "<?php class UserController { public function index() { return new UserResource($u); } }",
      },
      controller,
    );
    expect(laravel.detect("laravel", route, ctx)).toBe(true);
  });

  test("Rails: an action that renders HTML is not this slice", () => {
    const controller = "app/controllers/users_controller.rb";
    const route = routeOf({
      method: "GET",
      uri: "/users",
      rawUri: "users",
      actionName: "index",
    });
    const ctx = contextOfFiles(
      "rails",
      {
        [controller]: [
          "class UsersController",
          "  def index",
          '    render html: "<h1>Users</h1>"',
          "  end",
          "end",
        ].join("\n"),
      },
      controller,
    );
    expect(rails.detect("rails", route, ctx)).toBe(false);
    expect(rails.infer(route, ctx)).toBeNull();
  });

  test("Rails: an action that renders JSON is", () => {
    const controller = "app/controllers/users_controller.rb";
    const route = routeOf({
      method: "GET",
      uri: "/users",
      rawUri: "users",
      actionName: "index",
    });
    const ctx = contextOfFiles(
      "rails",
      {
        [controller]: [
          "class UsersController",
          "  def index",
          "    render json: { id: 1 }",
          "  end",
          "end",
        ].join("\n"),
      },
      controller,
    );
    expect(rails.detect("rails", route, ctx)).toBe(true);
  });

  test("a route of another framework is never mine", () => {
    const source = 'app.get("/x", (req, res) => { res.json({ id: 1 }); });';
    const route = routeOf({ method: "GET", uri: "/x", rawUri: "/x" });
    const ctx = contextOfSource("express", source);
    expect(express.detect("fastify", route, ctx)).toBe(false);
    expect(gin.detect("fastify", route, ctx)).toBe(false);
    expect(rails.detect("fastify", route, ctx)).toBe(false);
    expect(laravel.detect("fastify", route, ctx)).toBe(false);
  });
});

describe("detect() and infer() agree (r00020 S3)", () => {
  test("a route that is not detected is never inferred", () => {
    for (const entry of MEASURED_INFERRERS) {
      const ctx = contextOf(entry.fixture, entry.inferrer.framework, entry.source);
      for (const reference of REFERENCE_ROUTES[entry.id] ?? []) {
        const route = routeOf({
          method: reference.method,
          uri: reference.uri,
          rawUri: reference.rawUri,
          sourceFile: reference.sourceFile,
          lineNumber: reference.lineNumber,
          controllerClass: reference.controllerClass,
          actionName: reference.actionName,
        });
        const detected = entry.inferrer.detect(
          entry.inferrer.framework,
          route,
          ctx,
        );
        if (detected) continue;
        const spec = entry.inferrer.infer(route, ctx);
        expect(
          spec,
          `${entry.id} inferred a route it does not detect`,
        ).toBeNull();
      }
    }
  });
});
