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
    test("exact match against a prefix", () => {
      expect(zoneForUri("/api/users", baseConfig)).toBe("Users");
    });

    test("matches by descent (child segment)", () => {
      expect(zoneForUri("/api/users/123/profile", baseConfig)).toBe("Users");
    });

    test("accepts a URI with the /api/ prefix and normalizes it", () => {
      expect(zoneForUri("/api/auth/login", baseConfig)).toBe("Auth");
    });

    test("accepts a URI with the api/ prefix (without the leading slash)", () => {
      expect(zoneForUri("api/users", baseConfig)).toBe("Users");
    });

    test("returns defaultZone when there is no match", () => {
      expect(zoneForUri("/api/products", baseConfig)).toBe("Other");
    });

    test("root URI → defaultZone", () => {
      expect(zoneForUri("/", baseConfig)).toBe("Other");
    });

    test("empty URI → defaultZone", () => {
      expect(zoneForUri("", baseConfig)).toBe("Other");
    });
  });
});
