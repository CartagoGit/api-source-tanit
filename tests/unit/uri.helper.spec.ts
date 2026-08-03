import { describe, expect, test } from "bun:test";

import {
  normalizeForComparison,
  stripApiPrefix,
} from "../../helper/uri.helper";

describe("uri.helper", () => {
  describe("normalizeForComparison", () => {
    test("colapsa {{path}} Postman a :p", () => {
      expect(normalizeForComparison("/users/{{id}}")).toBe("users/:p");
    });

    test("colapsa {path} Laravel a :p", () => {
      expect(normalizeForComparison("/users/{id}")).toBe("users/:p");
    });

    test("colapsa {path:regex} Laravel a :p", () => {
      expect(normalizeForComparison("/items/{id:\\d+}")).toBe("items/:p");
    });

    test("colapsa :path Express a :p", () => {
      expect(normalizeForComparison("/users/:userId")).toBe("users/:p");
    });

    test("colapsa <int:id> / <str:slug> / <uuid:token> Django a :p", () => {
      expect(normalizeForComparison("/items/<int:id>")).toBe("items/:p");
      expect(normalizeForComparison("/blog/<str:slug>")).toBe("blog/:p");
      expect(normalizeForComparison("/verify/<uuid:token>")).toBe("verify/:p");
    });

    test("colapsa <id> sin tipo Django a :p", () => {
      expect(normalizeForComparison("/items/<id>")).toBe("items/:p");
    });

    test("dos endpoints con igual forma normalizan a la misma cadena", () => {
      expect(normalizeForComparison("/users/{id}")).toBe(
        normalizeForComparison("/users/:id"),
      );
      expect(normalizeForComparison("/users/{id}")).toBe(
        normalizeForComparison("/users/{{id}}"),
      );
    });

    test("elimina slash inicial y trailing", () => {
      expect(normalizeForComparison("/users/")).toBe("users");
      expect(normalizeForComparison("users")).toBe("users");
    });

    test("colapsa // a /", () => {
      expect(normalizeForComparison("/api//users")).toBe("api/users");
    });
  });

  describe("stripApiPrefix", () => {
    test("quita 'api/' cuando la URI lo lleva prepended", () => {
      expect(stripApiPrefix("api/users")).toBe("users");
    });

    test("no toca URIs que no empiezan por 'api/'", () => {
      expect(stripApiPrefix("users")).toBe("users");
      expect(stripApiPrefix("/users")).toBe("/users");
    });
  });
});
