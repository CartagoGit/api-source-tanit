import { describe, expect, test } from "vitest";

import {
  normalizeForComparison,
  stripApiPrefix,
  joinRoutePath,
} from "../../packages/core/helpers/uri.helper";

describe("uri.helper", () => {
  describe("normalizeForComparison", () => {
    test("collapses {{path}} Postman to :p", () => {
      expect(normalizeForComparison("/users/{{id}}")).toBe("users/:p");
    });

    test("collapses {path} Laravel to :p", () => {
      expect(normalizeForComparison("/users/{id}")).toBe("users/:p");
    });

    test("collapses {path:regex} Laravel to :p", () => {
      expect(normalizeForComparison("/items/{id:\\d+}")).toBe("items/:p");
    });

    test("collapses :path Express to :p", () => {
      expect(normalizeForComparison("/users/:userId")).toBe("users/:p");
    });

    test("collapses <int:id> / <str:slug> / <uuid:token> Django to :p", () => {
      expect(normalizeForComparison("/items/<int:id>")).toBe("items/:p");
      expect(normalizeForComparison("/blog/<str:slug>")).toBe("blog/:p");
      expect(normalizeForComparison("/verify/<uuid:token>")).toBe("verify/:p");
    });

    test("collapses <id> without a Django type to :p", () => {
      expect(normalizeForComparison("/items/<id>")).toBe("items/:p");
    });

    test("two endpoints with the same shape normalize to the same string", () => {
      expect(normalizeForComparison("/users/{id}")).toBe(
        normalizeForComparison("/users/:id"),
      );
      expect(normalizeForComparison("/users/{id}")).toBe(
        normalizeForComparison("/users/{{id}}"),
      );
    });

    test("removes the leading and trailing slash", () => {
      expect(normalizeForComparison("/users/")).toBe("users");
      expect(normalizeForComparison("users")).toBe("users");
    });

    test("collapses // to /", () => {
      expect(normalizeForComparison("/api//users")).toBe("api/users");
    });
  });

  describe("stripApiPrefix", () => {
    test("strips 'api/' when the URI carries it prepended", () => {
      expect(stripApiPrefix("api/users")).toBe("users");
    });

    test("does not touch URIs that do not start with 'api/'", () => {
      expect(stripApiPrefix("users")).toBe("users");
      expect(stripApiPrefix("/users")).toBe("/users");
    });
  });
});

describe("joinRoutePath", () => {
  test("joins prefix and path", () => {
    expect(joinRoutePath("/api", "users")).toBe("/api/users");
  });

  test("collapses repeated slashes", () => {
    expect(joinRoutePath("/api/", "/users")).toBe("/api/users");
  });

  // The bug: `@Controller("orders")` + `@Get()` produced "orders/",
  // which ended up in the collection as a different endpoint from
  // "orders".
  test("an empty path leaves no trailing slash", () => {
    expect(joinRoutePath("orders", "")).toBe("orders");
    expect(joinRoutePath("/api/users", "")).toBe("/api/users");
  });

  // Django declares it on purpose: with APPEND_SLASH, calling without
  // it returns 301 and a POST loses the body.
  test("keeps the trailing slash when the last segment declared one", () => {
    expect(joinRoutePath("api", "users/")).toBe("api/users/");
    expect(joinRoutePath("/api", "users/<int:id>/")).toBe("/api/users/<int:id>/");
  });

  test("a leading `/` marks the route as absolute", () => {
    expect(joinRoutePath("/", "api", "users")).toBe("/api/users");
  });

  test("without a leading `/` the route stays relative", () => {
    expect(joinRoutePath("api", "users")).toBe("api/users");
  });

  test("ignores intermediate empty segments", () => {
    expect(joinRoutePath("/api", "", "users")).toBe("/api/users");
  });

  test("with no useful segments returns the root", () => {
    expect(joinRoutePath("", "")).toBe("/");
    expect(joinRoutePath("/")).toBe("/");
  });
});
