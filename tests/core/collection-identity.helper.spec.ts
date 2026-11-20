import { describe, expect, test } from "vitest";
import { collectionIdFor, environmentIdFor, stableUuid } from "../../packages/core/helpers/collection-identity.helper";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("stableUuid", () => {
  test("is deterministic: same seed, same UUID", () => {
    expect(stableUuid("mi-api")).toBe(stableUuid("mi-api"));
  });

  test("different seeds give different UUIDs", () => {
    expect(stableUuid("mi-api")).not.toBe(stableUuid("otra-api"));
  });

  test("has the shape of a canonical UUID", () => {
    expect(stableUuid("mi-api")).toMatch(UUID_RE);
  });

  // Postman rejects IDs that do not satisfy RFC 4122.
  test("is a version 5 UUID", () => {
    expect(stableUuid("mi-api")[14]).toBe("5");
  });

  test("has the RFC 4122 variant (10xx in the first nibble of group 4)", () => {
    expect(["8", "9", "a", "b"]).toContain(stableUuid("mi-api")[19]);
  });

  test("normalizes uppercase and stray spaces", () => {
    expect(stableUuid("Mi  API")).toBe(stableUuid("mi api"));
    expect(stableUuid("  mi-api  ")).toBe(stableUuid("mi-api"));
  });

  test("normalizes accents", () => {
    expect(stableUuid("Catálogo")).toBe(stableUuid("catalogo"));
  });

  test("an empty seed still produces a valid UUID", () => {
    expect(stableUuid("")).toMatch(UUID_RE);
  });
});

describe("collectionIdFor", () => {
  test("respects the explicit id from the host", () => {
    expect(collectionIdFor({ explicitId: "fijado-a-mano" })).toBe("fijado-a-mano");
  });

  test("ignores an explicit id that is empty or whitespace", () => {
    expect(collectionIdFor({ explicitId: "   ", collectionName: "API" })).toMatch(UUID_RE);
  });

  test("the same project always yields the same id", () => {
    const identity = { collectionName: "Mi API", projectName: "mi-api", framework: "express" };
    expect(collectionIdFor(identity)).toBe(collectionIdFor({ ...identity }));
  });

  test("two different projects do not collide", () => {
    expect(collectionIdFor({ collectionName: "API A" })).not.toBe(
      collectionIdFor({ collectionName: "API B" }),
    );
  });

  // Two teams with a folder called `backend/` must not collide.
  test("the framework breaks ties for projects with the same name", () => {
    expect(collectionIdFor({ projectName: "backend", framework: "express" })).not.toBe(
      collectionIdFor({ projectName: "backend", framework: "django" }),
    );
  });

  test("with no hints returns a fixed id, not a random one", () => {
    expect(collectionIdFor({})).toBe(collectionIdFor({}));
    expect(collectionIdFor({})).toMatch(UUID_RE);
  });
});

describe("environmentIdFor", () => {
  test("is deterministic", () => {
    expect(environmentIdFor("col-1", "Local")).toBe(environmentIdFor("col-1", "Local"));
  });

  test("distinguishes environments within the same collection", () => {
    expect(environmentIdFor("col-1", "Local")).not.toBe(environmentIdFor("col-1", "Prod"));
  });

  test("distinguishes the same environment across different collections", () => {
    expect(environmentIdFor("col-1", "Local")).not.toBe(environmentIdFor("col-2", "Local"));
  });

  test("never matches the id of its collection", () => {
    const collectionId = stableUuid("mi-api");
    expect(environmentIdFor(collectionId, "Local")).not.toBe(collectionId);
  });

  test("has the shape of a canonical UUID", () => {
    expect(environmentIdFor("col-1", "Local")).toMatch(UUID_RE);
  });
});
