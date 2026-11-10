/**
 * Rails response inferrer (proposal `r00020` S3).
 *
 * Rails declares its routes in `config/routes.rb` and renders the
 * response in the controller — a **different file**. The spec walks
 * the three modes of the inferrer: the controller read from the
 * project, the hash the action renders, and the REST convention that
 * stands in when the controller cannot be read.
 *
 * The fixture is `tests/fixtures/rails-render/` — a real Rails app
 * whose actions render JSON.
 */
import { describe, expect, test } from "vitest";

import { RailsRenderResponseInferrer } from "../../packages/core/response-inference/rails-render.helper.js";
import {
  contextOf,
  fieldsOf,
  routeOf,
} from "./response-inference.helper.js";

const FIXTURE = "rails-render";
const ROUTES = "config/routes.rb";

const inferrer = new RailsRenderResponseInferrer();

describe("Rails response inferrer — render json (r00020 S3)", () => {
  test("detects only Rails", () => {
    const route = routeOf({
      method: "GET",
      uri: "/users",
      rawUri: "users",
      actionName: "index",
    });
    const ctx = contextOf(FIXTURE, "rails", ROUTES);
    expect(inferrer.detect("rails", route, ctx)).toBe(true);
    expect(inferrer.detect("laravel", route, ctx)).toBe(false);
  });

  test("reads the controller of the project and the hash it renders", () => {
    const route = routeOf({
      method: "GET",
      uri: "/api/users",
      rawUri: "users",
      sourceFile: ROUTES,
      actionName: "index",
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "rails", ROUTES));

    const entry = spec?.responses[0];
    expect(entry?.status).toBe(200);
    expect(entry?.confidence).toBe("medium");
    expect(entry?.reason).toContain("Rails render json:");
    expect(fieldsOf(entry?.schema).map((f) => f.name)).toEqual([
      "id",
      "name",
      "email",
    ]);
  });

  test("an instance variable is a reference to the model", () => {
    const route = routeOf({
      method: "GET",
      uri: "/api/users/{id}",
      rawUri: "users/{id}",
      sourceFile: ROUTES,
      actionName: "show",
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "rails", ROUTES));

    const entry = spec?.responses[0];
    expect(entry?.confidence).toBe("low");
    expect(entry?.schema.kind).toBe("ref");
    if (entry?.schema.kind === "ref") {
      expect(entry.schema.$ref).toBe("User");
    }
  });

  test("a render that declares a status wins over the convention", () => {
    const route = routeOf({
      method: "POST",
      uri: "/api/users",
      rawUri: "users",
      sourceFile: ROUTES,
      actionName: "create",
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "rails", ROUTES));

    const entry = spec?.responses[0];
    expect(entry?.status).toBe(201);
    expect(fieldsOf(entry?.schema).map((f) => f.name)).toEqual(["id"]);
  });

  test("without a readable controller the answer is the convention", () => {
    const route = routeOf({
      method: "GET",
      uri: "/posts",
      rawUri: "posts",
      sourceFile: ROUTES,
      actionName: "index",
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "rails", ROUTES));

    const entry = spec?.responses[0];
    expect(entry?.confidence).toBe("low");
    expect(entry?.reason).toContain("Rails REST convention");
    expect(entry?.schema.kind).toBe("ref");
    if (entry?.schema.kind === "ref") {
      expect(entry.schema.$ref).toBe("Post");
    }
  });

  test("a route with no action answers nothing", () => {
    const route = routeOf({
      method: "GET",
      uri: "/health",
      rawUri: "health",
      sourceFile: ROUTES,
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "rails", ROUTES));

    expect(spec).toBeNull();
  });

  test("the routes file is read, not the controller of another route", () => {
    const route = routeOf({
      method: "GET",
      uri: "/api/users",
      rawUri: "users",
      sourceFile: ROUTES,
      actionName: "index",
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "rails", ROUTES));

    // The plain `UsersController` renders two fields; the namespaced
    // one renders three. Reading the wrong controller is the failure
    // this assertion exists for.
    expect(fieldsOf(spec?.responses[0]?.schema).map((f) => f.name)).toEqual([
      "id",
      "name",
      "email",
    ]);
  });
});
