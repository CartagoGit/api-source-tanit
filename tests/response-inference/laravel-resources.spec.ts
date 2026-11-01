/**
 * Laravel Resources response inferrer (proposal `r00020` S3).
 *
 * Laravel declares its routes in `routes/api.php` and its responses
 * in the controller — a **different file**. The spec walks the three
 * modes of the inferrer: the controller read from the project, the
 * Resource class that declares the shape, and the convention that
 * stands in when nothing is readable.
 *
 * The fixture is `tests/fixtures/laravel-resources/` — a real Laravel
 * API whose controller answers with a `JsonResource`.
 */
import { describe, expect, test } from "vitest";

import { LaravelResourcesResponseInferrer } from "../../packages/core/response-inference/laravel-resources.helper.js";
import {
  contextOf,
  fieldsOf,
  readFixture,
  routeOf,
} from "./response-inference.helper.js";

const FIXTURE = "laravel-resources";
const ROUTES = "routes/api.php";
const SOURCE = readFixture(FIXTURE, ROUTES);

const inferrer = new LaravelResourcesResponseInferrer();

/** The route the Laravel scanner produces for `Route::get('/users', …)`. */
function usersRoute(action: string): ReturnType<typeof routeOf> {
  return routeOf({
    method: "GET",
    uri: "/users",
    rawUri: "/users",
    sourceFile: ROUTES,
    lineNumber: SOURCE.split("\n").findIndex((l) => l.includes(`'${action}'`)) + 1,
    controllerClass: "App\\Http\\Controllers\\UserController",
    actionName: action,
  });
}

describe("Laravel Resources response inferrer — JsonResource (r00020 S3)", () => {
  test("detects only Laravel", () => {
    const route = usersRoute("index");
    const ctx = contextOf(FIXTURE, "laravel", ROUTES);
    expect(inferrer.detect("laravel", route, ctx)).toBe(true);
    expect(inferrer.detect("rails", route, ctx)).toBe(false);
  });

  test("reads the controller of the project and the Resource it returns", () => {
    const spec = inferrer.infer(
      usersRoute("index"),
      contextOf(FIXTURE, "laravel", ROUTES),
    );

    const entry = spec?.responses[0];
    expect(entry?.status).toBe(200);
    expect(entry?.confidence).toBe("high");
    expect(entry?.reason).toContain("UserResource");
  });

  test("reads the fields the Resource declares in its toArray()", () => {
    const spec = inferrer.infer(
      usersRoute("index"),
      contextOf(FIXTURE, "laravel", ROUTES),
    );

    expect(fieldsOf(spec?.responses[0]?.schema).map((f) => f.name)).toEqual([
      "id",
      "name",
      "email",
    ]);
  });

  test("a store action answers 201", () => {
    const route = routeOf({
      method: "POST",
      uri: "/users",
      rawUri: "/users",
      sourceFile: ROUTES,
      controllerClass: "App\\Http\\Controllers\\UserController",
      actionName: "store",
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "laravel", ROUTES));

    expect(spec?.responses[0]?.status).toBe(201);
  });

  test("without a readable controller the answer is the convention", () => {
    const route = routeOf({
      method: "GET",
      uri: "/posts",
      rawUri: "/posts",
      sourceFile: ROUTES,
      controllerClass: "App\\Http\\Controllers\\PostController",
      actionName: "index",
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "laravel", ROUTES));

    const entry = spec?.responses[0];
    expect(entry?.confidence).toBe("low");
    expect(entry?.reason).toContain("Laravel convention");
    expect(entry?.schema.kind).toBe("ref");
    if (entry?.schema.kind === "ref") {
      expect(entry.schema.$ref).toBe("PostResource");
    }
  });

  test("a controller that does not return a Resource answers nothing", () => {
    const route = routeOf({
      method: "GET",
      uri: "/orders",
      rawUri: "/orders",
      sourceFile: ROUTES,
      controllerClass: "App\\Http\\Controllers\\OrderController",
      actionName: "index",
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "laravel", ROUTES));

    // `OrderController` **is** in the fixture, and its action returns
    // a plain model instead of a Resource. The convention would answer
    // "OrderResource", but the controller was read: we know the
    // answer, and the answer is "not this slice".
    expect(spec).toBeNull();
  });

  test("a route with no controller answers nothing", () => {
    const route = routeOf({
      method: "GET",
      uri: "/health",
      rawUri: "/health",
      sourceFile: ROUTES,
    });
    const spec = inferrer.infer(route, contextOf(FIXTURE, "laravel", ROUTES));

    expect(spec).toBeNull();
  });
});
