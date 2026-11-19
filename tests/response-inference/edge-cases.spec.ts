/**
 * Edge cases of the response inference (proposal `r00020` S3).
 *
 * The six inferrers read source code written by people, and the code
 * they read is **not** always well formed: an unbalanced parenthesis,
 * a schema with no properties, a payload that is neither a literal
 * nor an identifier. Every one of those cases has an answer, and the
 * answer is always the same one: *say nothing you cannot prove*.
 *
 * This spec feeds the inferrers the malformed shapes and checks that
 * they answer `null` (or a reference) instead of inventing a schema.
 */
import { describe, expect, test } from "vitest";

import {
  findRouteAnchors,
  pickRouteAnchor,
  sliceUntilNextAnchor,
} from "../../packages/core/helpers/route-anchor.helper.js";
import { ExpressResponseInferrer } from "../../packages/core/response-inference/express.helper.js";
import { FastifyResponseInferrer } from "../../packages/core/response-inference/fastify.helper.js";
import { GinResponseInferrer } from "../../packages/core/response-inference/gin.helper.js";
import { KtorRespondResponseInferrer } from "../../packages/core/response-inference/ktor-respond.helper.js";
import { LaravelResourcesResponseInferrer } from "../../packages/core/response-inference/laravel-resources.helper.js";
import { RailsRenderResponseInferrer } from "../../packages/core/response-inference/rails-render.helper.js";
import {
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

describe("route anchoring — malformed files (r00020 S3)", () => {
  test("a pattern that can match empty does not hang the scan", () => {
    const anchors = findRouteAnchors("abc", /x?/g);
    expect(anchors).toEqual([]);
  });

  test("a declaration without a method is not an anchor", () => {
    const anchors = findRouteAnchors('app.("/users")', /\b(\w*)\s+"([^"]*)"/g);
    expect(anchors).toEqual([]);
  });

  test("no anchors means no anchor to pick", () => {
    expect(pickRouteAnchor([], routeOf({ method: "GET", uri: "/users" }))).toBeNull();
  });

  test("with two declarations of the same path the closest line wins", () => {
    const text = [
      'app.get("/users", (req, res) => {',
      "  res.json({ first: true });",
      "});",
      "",
      'app.get("/users", (req, res) => {',
      "  res.json({ second: true });",
      "});",
    ].join("\n");
    const anchors = findRouteAnchors(
      text,
      /\b(?:app|router)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/gi,
    );
    expect(anchors).toHaveLength(2);

    const near = pickRouteAnchor(
      anchors,
      routeOf({ method: "GET", uri: "/users", rawUri: "/users", lineNumber: 5 }),
    );
    expect(near?.line).toBe(4);

    const far = pickRouteAnchor(
      anchors,
      routeOf({ method: "GET", uri: "/users", rawUri: "/users", lineNumber: 1 }),
    );
    expect(far?.line).toBe(0);
  });

  test("without a line the first declaration wins", () => {
    const text = 'app.get("/users", h);\napp.get("/users", h);';
    const anchors = findRouteAnchors(
      text,
      /\b(?:app|router)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/gi,
    );
    const picked = pickRouteAnchor(anchors, routeOf({ method: "GET", uri: "/users" }));
    expect(picked?.line).toBe(0);
  });

  test("the window of a route stops at the next declaration", () => {
    const text = 'app.get("/a", h);\napp.get("/b", h);';
    const anchors = findRouteAnchors(
      text,
      /\b(?:app|router)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/gi,
    );
    const first = anchors[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(sliceUntilNextAnchor(text, first, anchors)).not.toContain("/b");
  });
});

describe("Express — malformed payloads (r00020 S3)", () => {
  test("an empty payload answers nothing", () => {
    const source = 'app.get("/x", (req, res) => { res.json(); });';
    const spec = express.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("express", source),
    );
    expect(spec).toBeNull();
  });

  test("an unbalanced parenthesis answers nothing", () => {
    const source = 'app.get("/x", (req, res) => { res.json({ id: 1';
    const spec = express.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("express", source),
    );
    expect(spec).toBeNull();
  });

  test("a payload with no field answers nothing", () => {
    const source = 'app.get("/x", (req, res) => { res.json({ "": 1 }); });';
    const spec = express.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("express", source),
    );
    expect(spec).toBeNull();
  });

  test("the type of a literal is read from its shape", () => {
    const source = [
      'app.get("/x", (req, res) => {',
      "  res.json({ n: 1.5, b: true, s: \"x\", o: { k: 1 }, a: [1], u: v });",
      "});",
    ].join("\n");
    const spec = express.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("express", source),
    );
    const graph = spec?.responses[0]?.schema;
    expect(graph?.kind).toBe("schema-graph");
    if (graph?.kind !== "schema-graph") return;
    const root = graph.graph.nodes.get(graph.graph.root);
    const types = (root?.children ?? []).map((child) => {
      const node = graph.graph.nodes.get(child.node);
      return node?.scalarType ?? node?.kind;
    });
    expect(types).toEqual([
      "number",
      "boolean",
      "string",
      "object",
      "array",
      "scalar",
    ]);
  });
});

describe("Fastify — malformed schemas (r00020 S3)", () => {
  test("a response block that never opens answers nothing", () => {
    const source = [
      'app.get("/x", { schema: { response: } }, handler);',
    ].join("\n");
    const spec = fastify.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("fastify", source),
    );
    expect(spec).toBeNull();
  });

  test("a status that is not a number is ignored", () => {
    const source = [
      'app.get("/x", { schema: { response: { ok: { type: "object" } } } }, h);',
    ].join("\n");
    const spec = fastify.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("fastify", source),
    );
    expect(spec).toBeNull();
  });

  test("a schema with no properties answers nothing", () => {
    const source = [
      'app.get("/x", { schema: { response: { 200: { type: "object" } } } }, h);',
    ].join("\n");
    const spec = fastify.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("fastify", source),
    );
    expect(spec).toBeNull();
  });

  test("a properties block that never opens answers nothing", () => {
    const source = [
      'app.get("/x", { schema: { response: { 200: { properties: } } } }, h);',
    ].join("\n");
    const spec = fastify.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("fastify", source),
    );
    expect(spec).toBeNull();
  });

  test("a required list that never closes is read as empty", () => {
    const source = [
      'app.get("/x", { schema: { response: { 200: {',
      "  type: \"object\",",
      "  properties: { id: { type: \"integer\" } },",
      "  required: [\"id\"",
      '} } } }, h);',
    ].join("\n");
    const spec = fastify.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("fastify", source),
    );
    expect(spec?.responses[0]?.status).toBe(200);
  });

  test("the type of a property is read from the JSON Schema", () => {
    const source = [
      'app.get("/x", { schema: { response: { 200: {',
      "  type: \"object\",",
      "  properties: {",
      '    n: { type: "number" },',
      '    b: { type: "boolean" },',
      '    a: { type: "array" },',
      '    o: { type: "object" },',
      '    z: { type: "null" },',
      '    u: { type: "whatever" },',
      "  },",
      "} } } }, h);",
    ].join("\n");
    const spec = fastify.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("fastify", source),
    );
    const graph = spec?.responses[0]?.schema;
    expect(graph?.kind).toBe("schema-graph");
    if (graph?.kind !== "schema-graph") return;
    const root = graph.graph.nodes.get(graph.graph.root);
    const kinds = (root?.children ?? []).map(
      (child) => graph.graph.nodes.get(child.node)?.kind,
    );
    expect(kinds).toEqual(["scalar", "scalar", "array", "object", "scalar", "scalar"]);
  });
});

describe("Gin — malformed payloads (r00020 S3)", () => {
  test("an unbalanced parenthesis answers nothing", () => {
    const source = 'r.GET("/x", func(c *gin.Context) { c.JSON(200, gin.H{"id": 1';
    const spec = gin.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("gin", source),
    );
    expect(spec).toBeNull();
  });

  test("a call without a comma answers nothing", () => {
    const source = 'r.GET("/x", func(c *gin.Context) { c.JSON(200) })';
    const spec = gin.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("gin", source),
    );
    expect(spec).toBeNull();
  });

  test("an empty payload answers nothing", () => {
    const source = 'r.GET("/x", func(c *gin.Context) { c.JSON(200,) })';
    const spec = gin.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("gin", source),
    );
    expect(spec).toBeNull();
  });

  test("a payload that is a variable is a reference", () => {
    const source = 'r.GET("/x", func(c *gin.Context) { c.JSON(200, user) })';
    const spec = gin.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("gin", source),
    );
    const entry = spec?.responses[0];
    expect(entry?.schema.kind).toBe("ref");
    if (entry?.schema.kind === "ref") {
      expect(entry.schema.$ref).toBe("user");
    }
  });

  test("a map with no entries answers nothing", () => {
    const source = 'r.GET("/x", func(c *gin.Context) { c.JSON(200, gin.H{}) })';
    const spec = gin.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("gin", source),
    );
    expect(spec).toBeNull();
  });

  test("the type of a Go literal is read from its shape", () => {
    const source = [
      'r.GET("/x", func(c *gin.Context) {',
      '  c.JSON(200, gin.H{',
      '    "s": "x",',
      '    "b": true,',
      '    "i": int64(1),',
      '    "f": 1.5,',
      '    "a": []string{"x"},',
      '    "m": map[string]int{"k": 1},',
      '    "u": something,',
      "  })",
      "})",
    ].join("\n");
    const spec = gin.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("gin", source),
    );
    const graph = spec?.responses[0]?.schema;
    expect(graph?.kind).toBe("schema-graph");
    if (graph?.kind !== "schema-graph") return;
    const root = graph.graph.nodes.get(graph.graph.root);
    const kinds = (root?.children ?? []).map(
      (child) => graph.graph.nodes.get(child.node)?.kind,
    );
    expect(kinds).toEqual([
      "scalar",
      "scalar",
      "scalar",
      "scalar",
      "array",
      "object",
      "scalar",
    ]);
  });
});

describe("Ktor — malformed responses (r00020 S3)", () => {
  test("a call that never closes answers nothing", () => {
    const source = 'get("/x") { call.respond(HttpStatusCode.OK, ';
    const spec = ktor.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("ktor", source),
    );
    expect(spec).toBeNull();
  });

  test("a call without a status answers nothing", () => {
    const source = 'get("/x") { call.respond(payload) }';
    const spec = ktor.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("ktor", source),
    );
    expect(spec).toBeNull();
  });

  test("a status the standard library does not declare answers nothing", () => {
    const source = 'get("/x") { call.respond(HttpStatusCode.Wat, u) }';
    const spec = ktor.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("ktor", source),
    );
    expect(spec).toBeNull();
  });

  test("a payload that is neither a type nor a variable answers nothing", () => {
    const source = 'get("/x") { call.respond(HttpStatusCode.OK, a + b) }';
    const spec = ktor.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("ktor", source),
    );
    expect(spec).toBeNull();
  });
});

describe("Laravel — malformed controllers (r00020 S3)", () => {
  test("an action whose brace never closes answers nothing", () => {
    const source = "<?php class C { public function index() { return new UserResource($u);";
    const spec = laravel.infer(
      routeOf({
        method: "GET",
        uri: "/users",
        rawUri: "/users",
        actionName: "index",
        controllerClass: "App\\Http\\Controllers\\UserController",
      }),
      contextOfSource("laravel", source),
    );
    expect(spec).toBeNull();
  });

  test("a controller class with no name answers nothing", () => {
    const source = "<?php Route::get('/users', [X::class, 'index']);";
    const spec = laravel.infer(
      routeOf({
        method: "GET",
        uri: "/users",
        rawUri: "/users",
        actionName: "index",
        controllerClass: "",
      }),
      contextOfSource("laravel", source),
    );
    expect(spec).toBeNull();
  });

  test("a Resource whose toArray has no array answers a reference", () => {
    const source = [
      "<?php",
      "class UserController extends Controller {",
      "  public function index() {",
      "    return new UserResource($user);",
      "  }",
      "}",
      "class UserResource extends JsonResource {",
      "  public function toArray(Request $request): array {",
      "    return $this->only(['id']);",
      "  }",
      "}",
    ].join("\n");
    const spec = laravel.infer(
      routeOf({
        method: "GET",
        uri: "/users",
        rawUri: "/users",
        actionName: "index",
        controllerClass: "App\\Http\\Controllers\\UserController",
      }),
      contextOfSource("laravel", source),
    );
    const entry = spec?.responses[0];
    expect(entry?.schema.kind).toBe("ref");
    if (entry?.schema.kind === "ref") {
      expect(entry.schema.$ref).toBe("UserResource");
    }
  });
});

describe("Rails — malformed controllers (r00020 S3)", () => {
  test("an action with no render answers nothing", () => {
    const source = ["class UsersController", "  def index", "    @users", "  end", "end"].join("\n");
    const spec = rails.infer(
      routeOf({ method: "GET", uri: "/users", rawUri: "users", actionName: "index" }),
      contextOfSource("rails", source),
    );
    expect(spec).toBeNull();
  });

  test("a render whose brace never closes answers nothing", () => {
    const source = ["class UsersController", "  def index", "    render json: { id: 1", "  end", "end"].join("\n");
    const spec = rails.infer(
      routeOf({ method: "GET", uri: "/users", rawUri: "users", actionName: "index" }),
      contextOfSource("rails", source),
    );
    expect(spec).toBeNull();
  });

  test("a hash with no field answers nothing", () => {
    const source = ["class UsersController", "  def index", "    render json: { }", "  end", "end"].join("\n");
    const spec = rails.infer(
      routeOf({ method: "GET", uri: "/users", rawUri: "users", actionName: "index" }),
      contextOfSource("rails", source),
    );
    expect(spec).toBeNull();
  });

  test("the type of a Ruby literal is read from its shape", () => {
    const source = [
      "class UsersController",
      "  def index",
      "    render json: { n: 1.5, b: true, a: [1], o: { k: 1 }, u: v }",
      "  end",
      "end",
    ].join("\n");
    const spec = rails.infer(
      routeOf({ method: "GET", uri: "/users", rawUri: "users", actionName: "index" }),
      contextOfSource("rails", source),
    );
    const graph = spec?.responses[0]?.schema;
    expect(graph?.kind).toBe("schema-graph");
    if (graph?.kind !== "schema-graph") return;
    const root = graph.graph.nodes.get(graph.graph.root);
    const kinds = (root?.children ?? []).map(
      (child) => graph.graph.nodes.get(child.node)?.kind,
    );
    expect(kinds).toEqual(["scalar", "scalar", "array", "object", "scalar"]);
  });
});

describe("Fastify — schemas that do not add up (r00020 S3)", () => {
  test("an entry without a status is ignored", () => {
    const source = 'app.get("/x", { schema: { response: { 200 } } }, h);';
    const spec = fastify.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("fastify", source),
    );
    expect(spec).toBeNull();
  });

  test("a property without a type is ignored", () => {
    const source = [
      'app.get("/x", { schema: { response: { 200: {',
      '  properties: { id }',
      "} } } }, h);",
    ].join("\n");
    const spec = fastify.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("fastify", source),
    );
    expect(spec).toBeNull();
  });

  test("a property without a name is ignored", () => {
    const source = [
      'app.get("/x", { schema: { response: { 200: {',
      '  properties: { "": { type: "string" } }',
      "} } } }, h);",
    ].join("\n");
    const spec = fastify.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("fastify", source),
    );
    expect(spec).toBeNull();
  });

  test("a string with an escape does not break the block", () => {
    const source = [
      'app.get("/x", { schema: { response: { 200: {',
      '  properties: { id: { type: "string\\"x" } }',
      "} } } }, h);",
    ].join("\n");
    const spec = fastify.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("fastify", source),
    );
    expect(spec?.responses[0]?.status).toBe(200);
  });

  test("a properties block that never closes answers nothing", () => {
    const source = [
      'app.get("/x", { schema: { response: { 200: {',
      "  properties: { id: {",
    ].join("\n");
    const spec = fastify.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("fastify", source),
    );
    expect(spec).toBeNull();
  });
});

describe("Gin — maps that do not add up (r00020 S3)", () => {
  test("a payload that is an expression answers nothing", () => {
    const source = 'r.GET("/x", func(c *gin.Context) { c.JSON(200, a + b) })';
    const spec = gin.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("gin", source),
    );
    expect(spec).toBeNull();
  });

  test("a map that never closes answers nothing", () => {
    const source = 'r.GET("/x", func(c *gin.Context) { c.JSON(200, gin.H{"id": 1';
    const spec = gin.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("gin", source),
    );
    expect(spec).toBeNull();
  });

  test("a map with an empty key answers nothing", () => {
    const source = 'r.GET("/x", func(c *gin.Context) { c.JSON(200, gin.H{"": 1}) })';
    const spec = gin.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("gin", source),
    );
    expect(spec).toBeNull();
  });

  test("the typed literals of Go are read as their type", () => {
    const source = [
      'r.GET("/x", func(c *gin.Context) {',
      '  c.JSON(200, gin.H{"s": string("x"), "b": bool(true), "f": 1.5})',
      "})",
    ].join("\n");
    const spec = gin.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("gin", source),
    );
    const graph = spec?.responses[0]?.schema;
    expect(graph?.kind).toBe("schema-graph");
    if (graph?.kind !== "schema-graph") return;
    const root = graph.graph.nodes.get(graph.graph.root);
    const types = (root?.children ?? []).map((child) => {
      const node = graph.graph.nodes.get(child.node);
      return node?.scalarType ?? node?.kind;
    });
    expect(types).toEqual(["string", "boolean", "number"]);
  });

  test("a string with an escape does not break the map", () => {
    const source = [
      'r.GET("/x", func(c *gin.Context) {',
      '  c.JSON(200, gin.H{"s": "a\\"b", "n": f(1)})',
      "})",
    ].join("\n");
    const spec = gin.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("gin", source),
    );
    expect(spec?.responses[0]?.status).toBe(200);
  });
});

describe("Ktor — payloads that do not add up (r00020 S3)", () => {
  test("a string with an escape does not break the call", () => {
    const source = 'get("/x") { call.respond(HttpStatusCode.OK, User("a\\"b")) }';
    const spec = ktor.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("ktor", source),
    );
    expect(spec?.responses[0]?.status).toBe(200);
  });

  test("a nested call does not break the arguments", () => {
    const source = 'get("/x") { call.respond(HttpStatusCode.OK, f(1, g(2))) }';
    const spec = ktor.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("ktor", source),
    );
    // The payload is a call, and the call's type is not the type of
    // the response: the inferrer says nothing rather than guess.
    expect(spec).toBeNull();
  });
});

describe("Laravel — Resources that do not add up (r00020 S3)", () => {
  const CONTROLLER = "app/Http/Controllers/UserController.php";
  const RESOURCE = "app/Http/Resources/UserResource.php";

  test("a Resource without a toArray answers a reference", () => {
    const spec = laravel.infer(
      routeOf({
        method: "GET",
        uri: "/users",
        rawUri: "/users",
        actionName: "index",
        controllerClass: "App\\Http\\Controllers\\UserController",
      }),
      contextOfFiles(
        "laravel",
        {
          [CONTROLLER]: "<?php class UserController { public function index() { return new UserResource($u); } }",
          [RESOURCE]: "<?php class UserResource extends JsonResource { }",
        },
        CONTROLLER,
      ),
    );
    const entry = spec?.responses[0];
    expect(entry?.schema.kind).toBe("ref");
  });

  test("a toArray that returns nothing answers a reference", () => {
    const spec = laravel.infer(
      routeOf({
        method: "GET",
        uri: "/users",
        rawUri: "/users",
        actionName: "index",
        controllerClass: "App\\Http\\Controllers\\UserController",
      }),
      contextOfFiles(
        "laravel",
        {
          [CONTROLLER]: "<?php class UserController { public function index() { return new UserResource($u); } }",
          [RESOURCE]:
            "<?php class UserResource extends JsonResource { public function toArray($r): array { return []; } }",
        },
        CONTROLLER,
      ),
    );
    const entry = spec?.responses[0];
    expect(entry?.schema.kind).toBe("ref");
  });

  test("a Resource that cannot be read answers a reference", () => {
    const spec = laravel.infer(
      routeOf({
        method: "GET",
        uri: "/users",
        rawUri: "/users",
        actionName: "index",
        controllerClass: "App\\Http\\Controllers\\UserController",
      }),
      contextOfFiles(
        "laravel",
        {
          [CONTROLLER]: "<?php class UserController { public function index() { return new UserResource($u); } }",
        },
        CONTROLLER,
      ),
    );
    const entry = spec?.responses[0];
    expect(entry?.schema.kind).toBe("ref");
  });

  test("a controller class with no model answers nothing", () => {
    const spec = laravel.infer(
      routeOf({
        method: "GET",
        uri: "/users",
        rawUri: "/users",
        actionName: "index",
        controllerClass: "App\\Http\\Controllers\\Controller",
      }),
      contextOfFiles(
        "laravel",
        {
          "routes/api.php":
            "<?php Route::get('/users', [Controller::class, 'index']);",
        },
        "routes/api.php",
      ),
    );
    // The convention would read "Controller" as a model and answer
    // "Resource"; a controller with no model has no Resource.
    expect(spec).toBeNull();
  });

  test("an action whose brace never opens answers nothing", () => {
    const spec = laravel.infer(
      routeOf({
        method: "GET",
        uri: "/users",
        rawUri: "/users",
        actionName: "index",
        controllerClass: "App\\Http\\Controllers\\UserController",
      }),
      contextOfFiles(
        "laravel",
        {
          [CONTROLLER]: "<?php class UserController { public function index() ",
        },
        CONTROLLER,
      ),
    );
    expect(spec).toBeNull();
  });
});

describe("Rails — controllers that do not add up (r00020 S3)", () => {
  const CONTROLLER = "app/controllers/users_controller.rb";

  test("an action that does not render JSON answers nothing", () => {
    const spec = rails.infer(
      routeOf({ method: "GET", uri: "/users", rawUri: "users", actionName: "index" }),
      contextOfFiles(
        "rails",
        {
          [CONTROLLER]: ["class UsersController", "  def index", "    @users", "  end", "end"].join(
            "\n",
          ),
        },
        CONTROLLER,
      ),
    );
    expect(spec).toBeNull();
  });

  test("an action outside the REST convention answers nothing", () => {
    const spec = rails.infer(
      routeOf({ method: "GET", uri: "/users", rawUri: "users", actionName: "custom" }),
      contextOfFiles("rails", { [CONTROLLER]: "class UsersController\nend" }, CONTROLLER),
    );
    expect(spec).toBeNull();
  });

  test("a URI with no segment answers nothing", () => {
    const spec = rails.infer(
      routeOf({ method: "GET", uri: "/", rawUri: "", actionName: "index" }),
      contextOfFiles("rails", { [CONTROLLER]: "class UsersController\nend" }, CONTROLLER),
    );
    expect(spec).toBeNull();
  });

  test("a hash with an empty key is ignored", () => {
    const source = [
      "class UsersController",
      "  def index",
      '    render json: { "": 1 }',
      "  end",
      "end",
    ].join("\n");
    const spec = rails.infer(
      routeOf({ method: "GET", uri: "/users", rawUri: "users", actionName: "index" }),
      contextOfFiles("rails", { [CONTROLLER]: source }, CONTROLLER),
    );
    expect(spec).toBeNull();
  });

  test("a string with an escape does not break the hash", () => {
    const source = [
      "class UsersController",
      "  def index",
      '    render json: { "a\\"b": 1 }',
      "  end",
      "end",
    ].join("\n");
    const spec = rails.infer(
      routeOf({ method: "GET", uri: "/users", rawUri: "users", actionName: "index" }),
      contextOfFiles("rails", { [CONTROLLER]: source }, CONTROLLER),
    );
    expect(spec?.responses[0]?.status).toBe(200);
  });
});

describe("Gin — a status that is not a literal (r00020 S3)", () => {
  test("a comma inside a string does not split the arguments", () => {
    const source = 'r.GET("/x", func(c *gin.Context) { c.JSON(codeOf("a,b"), gin.H{"id": 1}) })';
    const spec = gin.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("gin", source),
    );
    expect(spec).toBeNull();
  });

  test("a map that never closes inside a balanced call answers nothing", () => {
    const source = 'r.GET("/x", func(c *gin.Context) { c.JSON(200, gin.H{"id": 1) })';
    const spec = gin.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("gin", source),
    );
    expect(spec).toBeNull();
  });
});

describe("Ktor — a status that is not a literal (r00020 S3)", () => {
  test("a comma inside a string does not split the arguments", () => {
    const source = 'get("/x") { call.respond(codeOf("a,b"), payload) }';
    const spec = ktor.infer(
      routeOf({ method: "GET", uri: "/x", rawUri: "/x" }),
      contextOfSource("ktor", source),
    );
    expect(spec).toBeNull();
  });
});

describe("Laravel — a toArray that does not add up (r00020 S3)", () => {
  const CONTROLLER = "app/Http/Controllers/UserController.php";
  const RESOURCE = "app/Http/Resources/UserResource.php";

  function inferWith(resource: string) {
    return laravel.infer(
      routeOf({
        method: "GET",
        uri: "/users",
        rawUri: "/users",
        actionName: "index",
        controllerClass: "App\\Http\\Controllers\\UserController",
      }),
      contextOfFiles(
        "laravel",
        {
          [CONTROLLER]:
            "<?php class UserController { public function index() { return new UserResource($u); } }",
          [RESOURCE]: resource,
        },
        CONTROLLER,
      ),
    );
  }

  test("a toArray with no brace answers a reference", () => {
    const spec = inferWith("<?php class UserResource { public function toArray($r): array ");
    expect(spec?.responses[0]?.schema.kind).toBe("ref");
  });

  test("a toArray that never closes answers a reference", () => {
    const spec = inferWith(
      "<?php class UserResource { public function toArray($r): array { return ['id' => 1];",
    );
    expect(spec?.responses[0]?.schema.kind).toBe("ref");
  });

  test("a toArray that returns no array answers a reference", () => {
    const spec = inferWith(
      "<?php class UserResource { public function toArray($r): array { return $this->only(['id']); } }",
    );
    expect(spec?.responses[0]?.schema.kind).toBe("ref");
  });

  test("an array that never closes answers a reference", () => {
    const spec = inferWith(
      "<?php class UserResource { public function toArray($r): array { return ['id' => 1; } }",
    );
    expect(spec?.responses[0]?.schema.kind).toBe("ref");
  });

  test("a string with an escape does not break the array", () => {
    const spec = inferWith(
      "<?php class UserResource { public function toArray($r): array { return ['id' => \"a\\\"b\"]; } }",
    );
    expect(spec?.responses[0]?.schema.kind).toBe("schema-graph");
  });
});

describe("Rails — a route that does not add up (r00020 S3)", () => {
  const ROUTES = "config/routes.rb";
  const CONTROLLER = "app/controllers/users_controller.rb";

  test("an action outside the REST convention answers nothing", () => {
    const spec = rails.infer(
      routeOf({ method: "GET", uri: "/users", rawUri: "users", actionName: "custom" }),
      contextOfFiles(
        "rails",
        { [ROUTES]: "Rails.application.routes.draw do\nend" },
        ROUTES,
      ),
    );
    expect(spec).toBeNull();
  });

  test("a URI with no segment answers nothing", () => {
    const spec = rails.infer(
      routeOf({ method: "GET", uri: "/", rawUri: "", actionName: "index" }),
      contextOfFiles(
        "rails",
        { [ROUTES]: "Rails.application.routes.draw do\nend" },
        ROUTES,
      ),
    );
    expect(spec).toBeNull();
  });

  test("a status declared before the render is not the render's status", () => {
    const source = [
      "class UsersController",
      "  def index",
      "    { status: :created }",
      "    render json: { id: 1 }",
      "  end",
      "end",
    ].join("\n");
    const spec = rails.infer(
      routeOf({ method: "GET", uri: "/users", rawUri: "users", actionName: "index" }),
      contextOfFiles("rails", { [CONTROLLER]: source }, CONTROLLER),
    );
    expect(spec?.responses[0]?.status).toBe(200);
  });

  test("a rendered value that is not a hash nor a model answers nothing", () => {
    const source = [
      "class UsersController",
      "  def index",
      "    render json: 42",
      "  end",
      "end",
    ].join("\n");
    const spec = rails.infer(
      routeOf({ method: "GET", uri: "/users", rawUri: "users", actionName: "index" }),
      contextOfFiles("rails", { [CONTROLLER]: source }, CONTROLLER),
    );
    expect(spec).toBeNull();
  });
});

describe("Rails — a route whose action was not resolved (r00020 S3)", () => {
  const ROUTES = "config/routes.rb";
  const CONTROLLER = "app/controllers/health_controller.rb";

  /**
   * The Rails scanner resolves the action only for `resources` routes.
   * A plain `get "/health", to: "health#check"` arrives **without**
   * one — and the controller may well declare several methods.
   */
  function inferWithoutAction(controller: string) {
    return rails.infer(
      routeOf({ method: "GET", uri: "/health", rawUri: "health" }),
      contextOfFiles("rails", { [CONTROLLER]: controller }, ROUTES),
    );
  }

  test("a controller with several methods answers nothing", () => {
    const controller = [
      "class HealthController",
      "  def index",
      '    render json: { wrong: "index" }',
      "  end",
      "  def check",
      "    render json: { ok: true }",
      "  end",
      "end",
    ].join("\n");
    // The first method is NOT the answer: the route points at
    // `health#check`, and reading `index` would attribute its
    // response to a route that does not have it.
    expect(inferWithoutAction(controller)).toBeNull();
  });

  test("a controller with a single method answers with it", () => {
    const controller = [
      "class HealthController",
      "  def check",
      "    render json: { ok: true }",
      "  end",
      "end",
    ].join("\n");
    const spec = inferWithoutAction(controller);
    expect(spec?.responses[0]?.status).toBe(200);
    expect(spec?.responses[0]?.reason).toContain("ok");
  });

  test("a controller with several methods never answers with the first one", () => {
    const controller = [
      "class HealthController",
      "  def index",
      '    render json: { wrong: "index" }',
      "  end",
      "  def check",
      '    render json: { also_wrong: "check" }',
      "  end",
      "end",
    ].join("\n");
    const spec = inferWithoutAction(controller);
    const reasons = (spec?.responses ?? []).map((r) => r.reason);
    expect(reasons).not.toContain('Rails render json: { wrong: "index" }');
    expect(reasons).not.toContain('Rails render json: { also_wrong: "check" }');
  });
});

describe("Laravel — a route whose action was not resolved (r00020 S3)", () => {
  const ROUTES = "routes/api.php";
  const CONTROLLER = "app/Http/Controllers/UserController.php";

  function inferWithoutAction(controller: string) {
    return laravel.infer(
      routeOf({
        method: "GET",
        uri: "/users",
        rawUri: "/users",
        controllerClass: "App\\Http\\Controllers\\UserController",
      }),
      contextOfFiles("laravel", { [CONTROLLER]: controller }, ROUTES),
    );
  }

  test("a controller with several methods answers nothing", () => {
    const controller = [
      "<?php class UserController {",
      "  public function index() { return new UserResource($u); }",
      "  public function show($u) { return new UserResource($u); }",
      "}",
    ].join("\n");
    expect(inferWithoutAction(controller)).toBeNull();
  });

  test("a controller with a single method answers with it", () => {
    const controller =
      "<?php class UserController { public function index() { return new UserResource($u); } }";
    const spec = inferWithoutAction(controller);
    expect(spec?.responses[0]?.schema.kind).toBe("ref");
    expect(spec?.responses[0]?.reason).toContain("UserResource");
  });
});

describe("Gin — a route declared on a group (r00020 S3)", () => {
  test("a group with a name of its own is read", () => {
    // The dominant Gin idiom: the group is called whatever the
    // project calls it, and the routes are declared on the group.
    const source = [
      'users := r.Group("/api/v1")',
      'users.GET("/users", func(c *gin.Context) { c.JSON(200, gin.H{"id": 1}) })',
    ].join("\n");
    const spec = gin.infer(
      routeOf({ method: "GET", uri: "/api/v1/users", rawUri: "/users" }),
      contextOfSource("gin", source),
    );
    expect(spec?.responses[0]?.status).toBe(200);
  });

  test("a group nested in another group is read", () => {
    const source = [
      'v1 := r.Group("/api/v1")',
      'admin := v1.Group("/admin")',
      'admin.GET("/users", func(c *gin.Context) { c.JSON(200, gin.H{"id": 1}) })',
    ].join("\n");
    const spec = gin.infer(
      routeOf({ method: "GET", uri: "/api/v1/admin/users", rawUri: "/users" }),
      contextOfSource("gin", source),
    );
    expect(spec?.responses[0]?.status).toBe(200);
  });
});
