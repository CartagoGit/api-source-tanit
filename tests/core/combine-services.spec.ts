import { describe, expect, test } from "vitest";
import type { IOperation } from "../../packages/contracts/interfaces/core/operation.interface.js";
import type { IServiceDescriptor } from "../../packages/contracts/interfaces/core/service.interface.js";
import { combineServices } from "../../packages/core/merge/combine-services.service.js";
import { perOperationResolver } from "../../packages/core/merge/per-operation-resolver.service.js";

const operation = (serviceId: string, id: string): IOperation => ({
  id: { kind: "operation", value: id },
  serviceId,
  transport: { kind: "http", method: "GET", path: "/" },
  serverRef: { id: { kind: "server", value: "legacy" }, url: "http://legacy" },
  authRef: { id: { kind: "auth", value: "legacy" }, type: "none" },
  request: {},
  responses: [],
  provenance: { sourceFile: "test" },
});

const service = (
  id: string,
  baseUrl: string,
  auth: IServiceDescriptor["auth"],
  endpoint: IOperation,
): IServiceDescriptor => ({
  id,
  baseUrl,
  auth,
  variables: [],
  transport: { kind: "http", method: "GET", path: "/" },
  endpoints: [endpoint],
});

describe("combineServices", () => {
  test("keeps a single service unchanged apart from its per-operation refs", () => {
    const result = combineServices([
      service("users", "https://users.example.com", { kind: "scheme", scheme: "oauth2" }, operation("users", "users-list")),
    ]);

    expect(result.variables).toContainEqual({ key: "baseUrl_users", value: "https://users.example.com" });
    expect(result.operations[0]?.serverRef.url).toBe("https://users.example.com");
    expect(result.operations[0]?.authRef.type).toBe("oauth2");
  });

  test("combines services without inheriting the first service context", () => {
    const result = combineServices([
      service("users", "https://users.example.com", { kind: "scheme", scheme: "oauth2" }, operation("users", "users-list")),
      service("billing", "https://billing.example.com", { kind: "scheme", scheme: "apiKey" }, operation("billing", "billing-invoices")),
    ]);

    expect(result.variables).toEqual([
      { key: "baseUrl_users", value: "https://users.example.com" },
      { key: "baseUrl_billing", value: "https://billing.example.com" },
    ]);
    expect(result.operations.map(({ serviceId, serverRef, authRef }) => ({ serviceId, url: serverRef.url, auth: authRef.type }))).toEqual([
      { serviceId: "users", url: "https://users.example.com", auth: "oauth2" },
      { serviceId: "billing", url: "https://billing.example.com", auth: "apiKey" },
    ]);
  });

  test("resolves by operation.serviceId and rejects unknown services", () => {
    const services = [
      service("users", "https://users.example.com", { kind: "none" }, operation("users", "users-list")),
      service("billing", "https://billing.example.com", { kind: "none" }, operation("billing", "billing-invoices")),
    ];

    expect(perOperationResolver.resolve(operation("billing", "billing-invoices"), services).serverRef.url).toBe("https://billing.example.com");
    expect(() => perOperationResolver.resolve(operation("missing", "missing"), services)).toThrow("Unknown serviceId: missing");
  });
});