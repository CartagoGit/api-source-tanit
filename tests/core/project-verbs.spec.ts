/**
 * The three services the CLI and the app now share.
 *
 * ## Why this test exists
 *
 * `check`, `validate` and `stats` were **CLI-only**: the comparison,
 * the invariants and the counting all lived inside the command
 * scripts. The app had a screen for each of them, and each screen
 * could only ever say "not available yet".
 *
 * The logic moved to the core so both faces could run it. These tests
 * pin the behaviour of the moved logic, because "moved" is exactly
 * when a behaviour changes by accident: the CLI's numbers have to be
 * the app's numbers, and the only way to know that is to check.
 */
import { describe, expect, test } from "vitest";

import { compareRoutesWithCollection } from "../../packages/core/domain/drift-check.service.js";
import { validatePostmanCollection } from "../../packages/core/domain/collection-validator.service.js";
import { computeCollectionStats } from "../../packages/core/domain/collection-stats.service.js";
import { POSTMAN_SCHEMA_URL } from "../../packages/contracts/constants/core/postman.constant.js";
import type { PostmanCollection } from "../../packages/contracts/interfaces/core/postman.interface.js";
import type { ProjectConfig } from "../../packages/contracts/interfaces/core/project-config.interface.js";

/** A collection with two requests, for the tests to look at. */
function collectionWith(
  requests: ReadonlyArray<{ readonly method: string; readonly uri: string; readonly name: string }>,
): PostmanCollection {
  return {
    info: {
      name: "Test",
      description: "",
      schema: POSTMAN_SCHEMA_URL,
      _postman_id: "id",
    },
    variable: [{ key: "baseUrl", value: "http://localhost", type: "string" }],
    item: requests.map((request) => ({
      name: request.name,
      request: {
        method: request.method,
        header: [{ key: "Accept", value: "application/json" }],
        url: {
          raw: request.uri,
          host: ["localhost"],
          path: request.uri.split("/").filter(Boolean),
        },
      },
    })),
  } as PostmanCollection;
}

/** A configuration with one zone, for the counting to use. */
function config(): ProjectConfig {
  return {
    name: "test",
    collectionName: "Test",
    collectionDescription: "",
    baseUrl: "http://localhost",
    variables: [],
    filePrefixes: {},
    zones: [["api", "api"]],
    zoneOrder: ["api"],
    defaultZone: "other",
    authDescriptions: {},
    loginEndpointName: "",
  };
}

describe("the drift comparison", () => {
  test("says the collection is in sync when both sides carry the same routes", () => {
    const collection = collectionWith([
      { method: "GET", uri: "/api/users", name: "Get Users" },
      { method: "POST", uri: "/api/users", name: "Create User" },
    ]);

    const report = compareRoutesWithCollection(
      [
        { method: "GET", uri: "/api/users", name: "Get Users" },
        { method: "POST", uri: "/api/users", name: "Create User" },
      ],
      collection,
      "/tmp/test.postman_collection.json",
    );

    expect(report.inSync).toBe(true);
    expect(report.routesInSource).toBe(2);
    expect(report.requestsInCollection).toBe(2);
    expect(report.missingInCollection).toHaveLength(0);
    expect(report.missingInSource).toHaveLength(0);
    expect(report.collectionPath).toBe("/tmp/test.postman_collection.json");
  });

  test("says which routes the collection is missing", () => {
    const collection = collectionWith([
      { method: "GET", uri: "/api/users", name: "Get Users" },
    ]);

    const report = compareRoutesWithCollection(
      [
        { method: "GET", uri: "/api/users", name: "Get Users" },
        { method: "DELETE", uri: "/api/users/{id}", name: "Delete User" },
      ],
      collection,
      "/tmp/test.postman_collection.json",
    );

    expect(report.inSync).toBe(false);
    expect(report.missingInCollection).toHaveLength(1);
    expect(report.missingInCollection[0]?.method).toBe("DELETE");
    expect(report.missingInCollection[0]?.uri).toBe("/api/users/{id}");
  });

  test("says which requests the code does not declare", () => {
    const collection = collectionWith([
      { method: "GET", uri: "/api/users", name: "Get Users" },
      { method: "GET", uri: "/api/ghost", name: "Get Ghost" },
    ]);

    const report = compareRoutesWithCollection(
      [{ method: "GET", uri: "/api/users", name: "Get Users" }],
      collection,
      "/tmp/test.postman_collection.json",
    );

    expect(report.inSync).toBe(false);
    expect(report.missingInSource).toHaveLength(1);
    expect(report.missingInSource[0]?.uri).toBe("/api/ghost");
  });

  test("does not call the auth probe drift", () => {
    // The exporter adds a request to prove the collection
    // authenticates. It is not a route in the code, and reporting it
    // as drift would make every project say "one extra request,
    // always" — a warning that is always true is a warning nobody
    // reads.
    const collection = collectionWith([
      { method: "GET", uri: "/api/users", name: "Get Users" },
      { method: "GET", uri: "/auth-test", name: "auth-test" },
    ]);

    const report = compareRoutesWithCollection(
      [{ method: "GET", uri: "/api/users", name: "Get Users" }],
      collection,
      "/tmp/test.postman_collection.json",
    );

    expect(report.inSync).toBe(true);
  });

  test("counts the name only when two routes share method and URI", () => {
    // GraphQL: one endpoint, several operations. Without the name
    // they would collapse into one and the drift would be invisible.
    const collection = collectionWith([
      { method: "POST", uri: "/graphql", name: "GetUser" },
      { method: "POST", uri: "/graphql", name: "GetOrder" },
    ]);

    const report = compareRoutesWithCollection(
      [
        { method: "POST", uri: "/graphql", name: "GetUser" },
        { method: "POST", uri: "/graphql", name: "GetOrder" },
      ],
      collection,
      "/tmp/test.postman_collection.json",
    );

    expect(report.routesInSource).toBe(2);
    expect(report.inSync).toBe(true);
  });
});

describe("the collection validator", () => {
  test("accepts a well-formed collection", () => {
    const result = validatePostmanCollection(
      collectionWith([{ method: "GET", uri: "/api/users", name: "Get Users" }]),
      "/tmp/test.postman_collection.json",
    );

    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.requests).toBe(1);
    expect(result.variables).toBe(1);
  });

  test("says what is wrong, and how bad it is", () => {
    const broken = collectionWith([{ method: "GET", uri: "/api/users", name: "Get Users" }]);
    broken.info.schema = "https://example.com/not-postman";

    const result = validatePostmanCollection(broken, "/tmp/test.postman_collection.json");

    expect(result.ok).toBe(false);
    expect(result.errors.some((issue) => issue.message.includes("info.schema"))).toBe(true);
  });

  test("a warning does not make the collection invalid", () => {
    const collection = collectionWith([{ method: "GET", uri: "/api/users", name: "Get Users" }]);
    delete (collection.info as { _postman_id?: string })._postman_id;

    const result = validatePostmanCollection(collection, "/tmp/test.postman_collection.json");

    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test("an empty collection is an error, not a warning", () => {
    const empty = collectionWith([]);
    empty.item = [];

    const result = validatePostmanCollection(empty, "/tmp/test.postman_collection.json");

    expect(result.ok).toBe(false);
    expect(result.errors.some((issue) => issue.message.includes("collection.item"))).toBe(true);
  });
});

describe("the collection statistics", () => {
  test("counts the requests per method and per zone", () => {
    const collection = collectionWith([
      { method: "GET", uri: "/api/users", name: "Get Users" },
      { method: "GET", uri: "/api/orders", name: "Get Orders" },
      { method: "POST", uri: "/api/users", name: "Create User" },
    ]);

    const stats = computeCollectionStats(collection, config(), "/tmp/test.postman_collection.json");

    expect(stats.total).toBe(3);
    expect(stats.byMethod.map((entry) => entry.method)).toEqual(["GET", "POST"]);
    expect(stats.byMethod[0]?.count).toBe(2);
    expect(stats.zones.length).toBeGreaterThan(0);
  });

  test("an empty collection has no counts and no zones", () => {
    const empty = collectionWith([]);
    empty.item = [];

    const stats = computeCollectionStats(empty, config(), "/tmp/test.postman_collection.json");

    expect(stats.total).toBe(0);
    expect(stats.byMethod).toHaveLength(0);
    expect(stats.zones).toHaveLength(0);
  });
});
