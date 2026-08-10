import { describe, expect, test } from "vitest";

import {
  countItems,
  pathToSegments,
  uriFromRaw,
  walkCollection,
} from "../../projects/core/helpers/postman.helper";
import type {
  PostmanCollection,
  PostmanItem,
} from "../../projects/contracts/interfaces/core/postman.interface";

/** Construye una mini-colección para tests. */
function fixtureCollection(): PostmanCollection {
  return {
    info: {
      name: "test",
      description: "",
      schema:
        "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    variable: [],
    item: [
      {
        name: "users",
        item: [
          {
            name: "list users",
            request: {
              method: "GET",
              url: { raw: "{{baseUrl}}/api/users" },
            },
          } as PostmanItem,
          {
            name: "create user",
            request: {
              method: "POST",
              url: { raw: "{{baseUrl}}/api/users" },
            },
          } as PostmanItem,
        ],
      },
      {
        name: "logout",
        request: {
          method: "POST",
          url: { raw: "{{baseUrl}}/api/auth/logout" },
        },
      } as PostmanItem,
    ],
  };
}

describe("postman.helper", () => {
  describe("pathToSegments", () => {
    test("elimina {{baseUrl}} y devuelve segmentos", () => {
      expect(pathToSegments("{{baseUrl}}/api/users")).toEqual(["api", "users"]);
    });

    test("ignora host cuando es https://", () => {
      expect(pathToSegments("https://example.com/api/users")).toEqual([
        "api",
        "users",
      ]);
    });

    test("ignora host cuando es http://", () => {
      expect(pathToSegments("http://example.com/api/users")).toEqual([
        "api",
        "users",
      ]);
    });

    test("omite segmentos vacíos", () => {
      expect(pathToSegments("{{baseUrl}}//api///users/")).toEqual([
        "api",
        "users",
      ]);
    });
  });

  describe("uriFromRaw", () => {
    test("recompone la URI relativa con /", () => {
      expect(uriFromRaw("{{baseUrl}}/api/users/123")).toBe("api/users/123");
    });
  });

  describe("walkCollection", () => {
    test("aplana una colección con carpetas", () => {
      const flat = walkCollection(fixtureCollection());
      expect(flat).toHaveLength(3);
      expect(flat[0]).toEqual({
        method: "GET",
        uri: "api/users",
        name: "list users",
        folder: "users",
      });
      expect(flat[1]).toEqual({
        method: "POST",
        uri: "api/users",
        name: "create user",
        folder: "users",
      });
      expect(flat[2]).toEqual({
        method: "POST",
        uri: "api/auth/logout",
        name: "logout",
        folder: "",
      });
    });

    test("anida carpetas con ' > '", () => {
      const col: PostmanCollection = {
        info: {
          name: "x",
          description: "",
          schema:
            "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        variable: [],
        item: [
          {
            name: "outer",
            item: [
              {
                name: "inner",
                item: [
                  {
                    name: "leaf",
                    request: {
                      method: "GET",
                      url: { raw: "{{baseUrl}}/x" },
                    },
                  } as PostmanItem,
                ],
              },
            ],
          },
        ],
      };
      const flat = walkCollection(col);
      expect(flat[0]?.folder).toBe("outer > inner");
    });
  });

  describe("countItems", () => {
    test("cuenta requests y carpetas", () => {
      const c = countItems(fixtureCollection());
      expect(c).toEqual({ requests: 3, folders: 1 });
    });

    test("colección vacía devuelve 0/0", () => {
      const empty: PostmanCollection = {
        info: {
          name: "x",
          description: "",
          schema:
            "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        variable: [],
        item: [],
      };
      expect(countItems(empty)).toEqual({ requests: 0, folders: 0 });
    });
  });
});
