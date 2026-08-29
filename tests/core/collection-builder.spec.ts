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
    test("colección vacía produce una sola carpeta vacía", () => {
      const col = buildCollection([], baseConfig);
      expect(col.info.name).toBe("T Collection");
      expect(col.info.description).toBe("Test collection");
      expect(col.variable).toHaveLength(1);
      expect(col.item).toEqual([]);
    });

    // El bloque `auth` sale de lo que hace la API, no de una constante.
    // Antes este test comprobaba que una colección VACÍA salía con
    // bearer — o sea, exigía la mentira: sin endpoints no hay forma de
    // saber que la API use bearer, ni de que use nada.
    test("sin ninguna señal de auth, no se inventa un bloque", () => {
      const col = buildCollection([], baseConfig);
      expect(col.auth).toBeUndefined();
    });

    test("con un endpoint de login, bearer con {{token}}", () => {
      const col = buildCollection([spec({ method: "POST", uri: "/auth/login" })], baseConfig, {
        type: "bearer",
        evidence: "test",
      });
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

    // Este test exigía lo contrario ("ids únicos"), que es justo el bug:
    // Postman usa `_postman_id` para decidir si un import actualiza la
    // colección o crea otra, así que un id nuevo por ejecución dejaba una
    // copia más en el workspace cada vez que se regeneraba.
    test("el mismo proyecto produce siempre el mismo info._postman_id", () => {
      const a = buildCollection([], baseConfig);
      const b = buildCollection([], baseConfig);
      expect(a.info._postman_id).toBe(b.info._postman_id);
      expect(a.info._postman_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    test("proyectos distintos producen ids distintos", () => {
      const a = buildCollection([], { ...baseConfig, collectionName: "API A" });
      const b = buildCollection([], { ...baseConfig, collectionName: "API B" });
      expect(a.info._postman_id).not.toBe(b.info._postman_id);
    });

    test("collectionId del host manda sobre el derivado", () => {
      const col = buildCollection([], { ...baseConfig, collectionId: "id-fijado-a-mano" });
      expect(col.info._postman_id).toBe("id-fijado-a-mano");
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

});
