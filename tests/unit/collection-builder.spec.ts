import { describe, expect, test } from "bun:test";

import {
  attachLoginAutoToken,
  buildCollection,
} from "../../service/collection-builder.service";
import type {
  EndpointSpec,
  PostmanCollection,
  PostmanItem,
} from "../../contract/postman.interface";
import type { ProjectConfig } from "../../contract/project-config.interface";

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
    test("colección vacía produce una sola carpeta vacía", () => {
      const col = buildCollection([], baseConfig);
      expect(col.info.name).toBe("T Collection");
      expect(col.info.description).toBe("Test collection");
      expect(col.variable).toHaveLength(1);
      expect(col.item).toEqual([]);
    });

    test("autorellena auth bearer con {{token}}", () => {
      const col = buildCollection([], baseConfig);
      expect(col.auth).toEqual({
        type: "bearer",
        bearer: [{ key: "token", value: "{{token}}", type: "string" }],
      });
    });

    test("agrupa endpoints por topFolder", () => {
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

    test("respeta uriGroupOverrides", () => {
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

    test("emite ids únicos para info._postman_id", () => {
      const a = buildCollection([], baseConfig);
      const b = buildCollection([], baseConfig);
      expect(a.info._postman_id).not.toBe(b.info._postman_id);
    });

    test("preserva la config.variables en la colección resultante", () => {
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

  describe("attachLoginAutoToken", () => {
    function itemWithRequest(name: string): PostmanItem {
      return {
        name,
        request: {
          method: "POST",
          url: { raw: "{{baseUrl}}/auth" },
        },
      };
    }

    function findItem(
      items: PostmanItem[],
      name: string,
    ): PostmanItem | undefined {
      for (const item of items) {
        if (item.name === name) return item;
        if (item.item) {
          const found = findItem(item.item, name);
          if (found) return found;
        }
      }
      return undefined;
    }

    test("inyecta test script en el endpoint que matchea por hints", () => {
      const col: PostmanCollection = {
        info: {
          name: "x",
          schema:
            "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        item: [itemWithRequest("Login")],
      };
      attachLoginAutoToken(col, { tokenResponsePath: "access_token" });
      const login = findItem(col.item, "Login");
      expect(login?.event).toBeDefined();
      expect(login?.event?.[0]?.listen).toBe("test");
      const exec = login?.event?.[0]?.script?.exec?.join("\n") ?? "";
      expect(exec).toContain("pm.collectionVariables.set('token'");
    });

    test("no inyecta nada cuando no hay match", () => {
      const col: PostmanCollection = {
        info: {
          name: "x",
          schema:
            "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        item: [itemWithRequest("List users")],
      };
      attachLoginAutoToken(col, { tokenResponsePath: "access_token" });
      const list = findItem(col.item, "List users");
      expect(list?.event).toBeUndefined();
    });

    test("no inyecta nada cuando tokenResponsePath está vacío", () => {
      const col: PostmanCollection = {
        info: {
          name: "x",
          schema:
            "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        item: [itemWithRequest("Login")],
      };
      attachLoginAutoToken(col, { tokenResponsePath: "" });
      const login = findItem(col.item, "Login");
      expect(login?.event).toBeUndefined();
    });

    test("loginEndpointName explícito matchea case-sensitive", () => {
      const col: PostmanCollection = {
        info: {
          name: "x",
          schema:
            "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        item: [itemWithRequest("obtain-token")],
      };
      attachLoginAutoToken(col, {
        tokenResponsePath: "data.access_token",
        loginEndpointName: "obtain-token",
      });
      const target = findItem(col.item, "obtain-token");
      expect(target?.event).toBeDefined();
    });

    test("navega por dot-path en el script generado", () => {
      const col: PostmanCollection = {
        info: {
          name: "x",
          schema:
            "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        item: [itemWithRequest("Login")],
      };
      attachLoginAutoToken(col, { tokenResponsePath: "data.token" });
      const login = findItem(col.item, "Login");
      const exec = login?.event?.[0]?.script?.exec?.join("\n") ?? "";
      expect(exec).toContain("json.data");
      expect(exec).toContain("token");
    });
  });
});
