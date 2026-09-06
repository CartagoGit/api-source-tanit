import { describe, expect, test } from "vitest";

import {
  buildCollection,
} from "../../packages/core/domain/collection-builder.service";
import type {
  EndpointSpec,
} from "../../packages/contracts/interfaces/core/postman.interface";
import type { ProjectConfig } from "../../packages/contracts/interfaces/core/project-config.interface";

const baseConfig: ProjectConfig = {
  name: "t",
  collectionName: "T Collection",
  collectionDescription: "Test collection",
  baseUrl: "http://x",
  variables: [{ key: "baseUrl", value: "http://x", type: "string" }],
  filePrefixes: {},
  zones: [],
  zoneOrder: [],
  defaultZone: "Other",
  authDescriptions: {},
  loginEndpointName: "Login",
};

function spec(partial: Partial<EndpointSpec>): EndpointSpec {
  return {
    method: "GET",
    uri: "/x",
    headers: [],
    query: [],
    body: null,
    formRequest: null,
    ...partial,
  } as EndpointSpec;
}

describe("collection-builder.service", () => {
  describe("buildCollection", () => {
    test("an empty collection produces a single empty folder", () => {
      const col = buildCollection([], baseConfig);
      expect(col.info.name).toBe("T Collection");
      expect(col.info.description).toBe("Test collection");
      expect(col.variable).toHaveLength(1);
      expect(col.item).toEqual([]);
    });

    // The `auth` block comes from what the API does, not from a
    // constant. Previously this test asserted that an EMPTY collection
    // came out with bearer — i.e. it required the lie: without
    // endpoints there is no way to know the API uses bearer, or uses
    // anything.
    test("without any auth signal, no block is invented", () => {
      const col = buildCollection([], baseConfig);
      expect(col.auth).toBeUndefined();
    });

    test("with a login endpoint, bearer with {{token}}", () => {
      const col = buildCollection([spec({ method: "POST", uri: "/auth/login" })], baseConfig, {
        type: "bearer",
        evidence: "test",
      });
      expect(col.auth).toEqual({
        type: "bearer",
        bearer: [{ key: "token", value: "{{token}}", type: "string" }],
      });
    });

    test("groups endpoints by topFolder", () => {
      const col = buildCollection(
        [
          spec({ method: "GET", uri: "/users" }),
          spec({ method: "POST", uri: "/users" }),
          spec({ method: "GET", uri: "/orders" }),
        ],
        baseConfig,
      );
      const folderNames = col.item.map((f) => f.name);
      expect(folderNames).toContain("Users");
      expect(folderNames).toContain("Orders");
    });

    test("respects uriGroupOverrides", () => {
      const config = {
        ...baseConfig,
        uriGroupOverrides: { "tol/tecdoc": "tol/tecdoc" },
      };
      const col = buildCollection(
        [spec({ method: "GET", uri: "/api/tol/tecdoc/items" })],
        config,
      );
      expect(col.item[0]?.name).toBe("Tol/Tecdoc");
    });

    // This test used to assert the opposite ("unique ids"), which is
    // exactly the bug: Postman uses `_postman_id` to decide whether an
    // import updates the collection or creates a new one, so a fresh id
    // per run left one extra copy in the workspace every regeneration.
    test("the same project always produces the same info._postman_id", () => {
      const a = buildCollection([], baseConfig);
      const b = buildCollection([], baseConfig);
      expect(a.info._postman_id).toBe(b.info._postman_id);
      expect(a.info._postman_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    test("different projects produce different ids", () => {
      const a = buildCollection([], { ...baseConfig, collectionName: "API A" });
      const b = buildCollection([], { ...baseConfig, collectionName: "API B" });
      expect(a.info._postman_id).not.toBe(b.info._postman_id);
    });

    test("the host's collectionId overrides the derived one", () => {
      const col = buildCollection([], { ...baseConfig, collectionId: "id-fijado-a-mano" });
      expect(col.info._postman_id).toBe("id-fijado-a-mano");
    });

    test("preserves config.variables in the resulting collection", () => {
      const config = {
        ...baseConfig,
        variables: [
          { key: "baseUrl", value: "http://x", type: "string" },
          { key: "token", value: "", type: "string" },
        ],
      };
      const col = buildCollection([], config);
      expect(col.variable).toHaveLength(2);
    });
  });

  // x00056 S1 — Postman exporter materialises the Hono `.all()`
  // sentinel as `ANY` (the only Postman verb that captures "any
  // method"). The mapping lives in `postmanMethodFor` inside
  // `collection-builder.service.ts`.
  describe("Postman materialisation of `method: 'ALL'` (x00056 S1)", () => {
    test("a spec with method='ALL' produces a Postman request with method='ANY'", () => {
      const col = buildCollection(
        [spec({ method: "ALL", uri: "/api/anything" })],
        baseConfig,
      );
      const leaf = findFirstLeaf(col.item);
      expect(leaf, "collection has at least one request").toBeDefined();
      expect(leaf!.request.method).toBe("ANY");
    });

    test("non-ALL methods pass through unchanged (GET stays GET)", () => {
      const col = buildCollection(
        [spec({ method: "GET", uri: "/api/users" })],
        baseConfig,
      );
      const leaf = findFirstLeaf(col.item);
      expect(leaf!.request.method).toBe("GET");
    });
  });
});

/** Walks the item tree and returns the first leaf request found. */
function findFirstLeaf(items: ReadonlyArray<unknown>): { request: { method: string } } | undefined {
  for (const it of items) {
    const item = it as { item?: unknown[]; request?: { method: string } };
    if (item.request) return item as { request: { method: string } };
    if (item.item) {
      const found = findFirstLeaf(item.item);
      if (found) return found;
    }
  }
  return undefined;
}
