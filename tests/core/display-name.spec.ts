/**
 * The name of a request is not a route.
 *
 * `deriveName` used to pass the scanner's `displayName` through
 * `toPostmanUri`, which prepends a slash to anything that does not have
 * one — because that is the right thing for a URI. For a name it is
 * not: Postman ended up with `/POST /orders` where the Next.js scanner
 * had put `POST /orders`, and `/create_user` where FastAPI had put the
 * function name.
 *
 * It affected the six scanners that set `displayName` (next.js, gin,
 * flask, symfony, spring boot, fastapi), and nobody noticed because an
 * extra slash on a name does not break the collection: it only uglifies
 * it.
 *
 * What does need translating in a name are the path parameters, so
 * `GET /users/:id` reads the same as its URI.
 */
import { describe, expect, test } from "vitest";

import { deriveName, toPostmanUri } from "../../packages/core/adapters/parsed-route-to-spec.adapter";
import type { ParsedRoute } from "../../packages/contracts/interfaces/core/scanner.interface";

function nameOf(route: Partial<ParsedRoute> & { method: string; uri: string }): string {
  return deriveName(route as ParsedRoute);
}

describe("a displayName is respected as-is", () => {
  test("does not get a slash prepended", () => {
    expect(nameOf({ method: "POST", uri: "/orders", displayName: "POST /orders" })).toBe(
      "POST /orders",
    );
  });

  test("a function name is left as-is", () => {
    expect(nameOf({ method: "POST", uri: "/users", displayName: "create_user" })).toBe(
      "create_user",
    );
  });

  test("a Symfony route name is left as-is", () => {
    expect(nameOf({ method: "POST", uri: "/logout", displayName: "api_logout" })).toBe(
      "api_logout",
    );
  });

  test("does not collapse the slashes in the name", () => {
    // A name may carry `//` on purpose; it is not a route to normalize.
    expect(
      nameOf({ method: "GET", uri: "/x", displayName: "GET https://api/x" }),
    ).toBe("GET https://api/x");
  });

  test("trims whitespace from the edges", () => {
    expect(nameOf({ method: "GET", uri: "/x", displayName: "  listUsers  " })).toBe(
      "listUsers",
    );
  });
});

describe("parameters do get translated", () => {
  test("`:id` from Express becomes `{{id}}`", () => {
    expect(
      nameOf({ method: "GET", uri: "/users/:id", displayName: "GET /users/:id" }),
    ).toBe("GET /users/{{id}}");
  });

  test("`<int:id>` from Django becomes `{{id}}`", () => {
    expect(
      nameOf({ method: "GET", uri: "/users/1", displayName: "GET /users/<int:id>" }),
    ).toBe("GET /users/{{id}}");
  });

  test("`{id}` from Laravel becomes `{{id}}`", () => {
    expect(
      nameOf({ method: "GET", uri: "/users/1", displayName: "GET /users/{id}" }),
    ).toBe("GET /users/{{id}}");
  });

  test("what is already `{{id}}` is not touched", () => {
    expect(
      nameOf({ method: "GET", uri: "/users/1", displayName: "GET /users/{{id}}" }),
    ).toBe("GET /users/{{id}}");
  });
});

describe("a URI is normalized as a URI", () => {
  // This is the difference from a name, and the reason there are now two
  // separate functions.
  test("gets the leading slash when the scanner omits it", () => {
    expect(toPostmanUri("users")).toBe("/users");
  });

  test("collapses repeated slashes", () => {
    expect(toPostmanUri("/api//v1///users")).toBe("/api/v1/users");
  });

  test("and also translates parameters", () => {
    expect(toPostmanUri("/users/:id")).toBe("/users/{{id}}");
  });
});

/**
 * A `GET` does not carry a body, so body rules on a `GET` cannot be
 * its own: they belong to the neighbor.
 *
 * Providers that look for "the closest schema" when the handler does
 * not reference any attach it to whichever endpoint they please — the
 * `GET /users` from the Express example ended up with the fields of
 * `POST /orders`. While those rules only fed the example body it was
 * not noticeable, because the body already skipped these methods;
 * once they started being documented and showing up in OpenAPI, the
 * document described a GET with a body.
 */
describe("body rules only go to the methods that accept them", () => {
  test.each(["GET", "DELETE", "HEAD", "OPTIONS"] as const)(
    "a %s does not keep body rules",
    async (method) => {
      const { generateWithAllFrameworks } = await import("../../packages/frameworks/index");
      const { exampleDir } = await import("../../scripts/helpers/root.helper");
      const result = await generateWithAllFrameworks(exampleDir("express"));
      for (const spec of result.specs) {
        if (spec.method !== method) continue;
        const body = (spec.fields ?? []).filter((f) => f.location === "body");
        expect(body, `${spec.method} ${spec.uri}`).toEqual([]);
      }
    },
  );

  test("a POST does keep them", async () => {
    const { generateWithAllFrameworks } = await import("../../packages/frameworks/index");
    const { exampleDir } = await import("../../scripts/helpers/root.helper");
    const result = await generateWithAllFrameworks(exampleDir("express"));
    const post = result.specs.find((s) => s.method === "POST" && s.uri === "/api/users");
    expect((post?.fields ?? []).some((f) => f.location === "body")).toBe(true);
  });
});
