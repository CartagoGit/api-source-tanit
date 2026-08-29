import { describe, expect, test } from "vitest";

import { zoneForUri } from "../../packages/core/helpers/zone.helper";
import type { ProjectConfig } from "../../packages/contracts/interfaces/core/project-config.interface";

const baseConfig: ProjectConfig = {
  name: "t",
  collectionName: "T",
  collectionDescription: "T",
  baseUrl: "http://x",
  variables: [],
  filePrefixes: {},
  zones: [
    ["auth", "Auth"],
    ["users", "Users"],
  ],
  zoneOrder: ["Auth", "Users"],
  defaultZone: "Other",
  authDescriptions: {},
  loginEndpointName: "Login",
};

describe("zone.helper", () => {
  describe("zoneForUri", () => {
    test("match exacto contra un prefix", () => {
      expect(zoneForUri("/api/users", baseConfig)).toBe("Users");
    });

    test("match por descendencia (segmento hijo)", () => {
      expect(zoneForUri("/api/users/123/profile", baseConfig)).toBe("Users");
    });

    test("acepta URI con prefijo /api/ y lo normaliza", () => {
      expect(zoneForUri("/api/auth/login", baseConfig)).toBe("Auth");
    });

    test("acepta URI con prefijo api/ (sin slash inicial)", () => {
      expect(zoneForUri("api/users", baseConfig)).toBe("Users");
    });

    test("devuelve defaultZone cuando no hay match", () => {
      expect(zoneForUri("/api/products", baseConfig)).toBe("Other");
    });

    test("URI raíz → defaultZone", () => {
      expect(zoneForUri("/", baseConfig)).toBe("Other");
    });

    test("URI vacía → defaultZone", () => {
      expect(zoneForUri("", baseConfig)).toBe("Other");
    });
  });
});
