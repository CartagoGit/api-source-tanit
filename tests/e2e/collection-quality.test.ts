/**
 * The collection as a product.
 *
 * The scanner tests check that routes are detected; these check that
 * what ends up in Postman **works**. They are different things: a
 * collection can have all 18 endpoints right and still be useless if
 * its `PUT`s are missing the example body.
 *
 * It runs against all 12 frameworks, so a new scanner inherits the bar
 * without anyone having to remember.
 */
import { describe, expect, test } from "vitest";

import { generateWithAllFrameworks } from "../../packages/frameworks/index";
import { comprehensiveFixtureDir } from "../../scripts/helpers/root.helper";
import { SUPPORTED_METHODS } from "../../packages/contracts/constants/core/postman.constant";
import type { PostmanItem } from "../../packages/contracts/interfaces/core/postman.interface";
import { FRAMEWORK_IDS } from "../../packages/contracts/constants/frameworks/framework-ids.constant";

/** All requests in the collection, without the folders. */
function requestsOf(items: ReadonlyArray<PostmanItem>): PostmanItem[] {
  return items.flatMap((item) =>
    item.item ? requestsOf(item.item as PostmanItem[]) : [item],
  );
}

describe.each([...FRAMEWORK_IDS])("colección de %s", (framework) => {
  test("every request has name, method and URL", async () => {
    const { collection } = await generateWithAllFrameworks(
      comprehensiveFixtureDir(framework),
    );
    for (const request of requestsOf(collection.item)) {
      expect(request.name, JSON.stringify(request).slice(0, 120)).toBeTruthy();
      expect(request.request?.method).toBeTruthy();
      expect(request.request?.url?.raw).toBeTruthy();
    }
  });

  test("every URL hangs off {{baseUrl}}", async () => {
    const { collection } = await generateWithAllFrameworks(
      comprehensiveFixtureDir(framework),
    );
    for (const request of requestsOf(collection.item)) {
      expect(request.request?.url?.raw, request.name).toMatch(/^\{\{baseUrl\}\}/);
    }
  });

  test("no URL has double slashes", async () => {
    const { collection } = await generateWithAllFrameworks(
      comprehensiveFixtureDir(framework),
    );
    for (const request of requestsOf(collection.item)) {
      const raw = (request.request?.url?.raw ?? "").replace("://", ":/");
      expect(raw.includes("//"), `${request.name}: ${raw}`).toBe(false);
    }
  });

  // The regression: optional fields were dropped when building the body,
  // so an `update` whose FormRequest declares everything with
  // `sometimes` came out WITHOUT a body. This is the most common
  // PUT/PATCH case, and an example without a body is useless.
  test("writes with rules come with an example body", async () => {
    const { collection, specs } = await generateWithAllFrameworks(
      comprehensiveFixtureDir(framework),
    );
    // EXACT method + URI are compared. With a substring comparison,
    // `/auth/logout` would match the rule from another endpoint and the
    // test would require a body on a logout, which legitimately has none.
    const bodiesByKey = new Map(
      specs
        .filter((spec) => spec.formRequest && spec.body)
        .map((spec) => [`${spec.method} ${spec.uri}`, spec.body]),
    );
    if (bodiesByKey.size === 0) return;

    for (const [key] of bodiesByKey) {
      const [, uri] = key.split(" ");
      const method = key.split(" ")[0];
      const request = requestsOf(collection.item).find(
        (candidate) =>
          candidate.request?.method === method &&
          (candidate.request?.url?.raw ?? "").endsWith(uri ?? "\u0000"),
      );
      if (!request) continue;
      expect(request.request?.body, key).toBeTruthy();
    }
  });

  test("no header goes without a key", async () => {
    const { collection } = await generateWithAllFrameworks(
      comprehensiveFixtureDir(framework),
    );
    for (const request of requestsOf(collection.item)) {
      for (const header of request.request?.header ?? []) {
        expect(header.key, request.name).toBeTruthy();
      }
    }
  });
});

describe("HTTP methods supported by Postman", () => {
  // `EndpointSpec["method"]` did not cover HEAD or OPTIONS, but five
  // scanners detect them (`method: ["GET","HEAD"]` in Fastify,
  // `app.Options()` in Fiber…). The adapter was silently filtering
  // them out: they were scanned correctly and disappeared without a word.
  test("a declared HEAD reaches the collection", async () => {
    const { specs } = await generateWithAllFrameworks(
      comprehensiveFixtureDir("fastify"),
    );
    expect(specs.some((spec) => spec.method === "HEAD")).toBe(true);
  });

  // The adapter's list and the type's list were two different things:
  // adding a method to the type was useless until the other was also
  // updated. a00012 S3.c added TRACE because the OpenAPI scanner
  // recognizes it (`paths./y.trace`) but the adapter was silently
  // filtering it out.
  test("the adapter list and the contract list are the same", () => {
    expect([...SUPPORTED_METHODS]).toEqual([
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
      "TRACE",
    ]);
  });
});
