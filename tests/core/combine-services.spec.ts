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

  test("rejects duplicate service IDs and duplicate variable keys", () => {
    const users = service("users", "https://users.example.com", { kind: "none" }, operation("users", "users-list"));
    expect(() => combineServices([users, users])).toThrow("Duplicate service id: users");

    const withDuplicateVariable = {
      ...users,
      variables: [{ key: "baseUrl_users", value: "other" }],
    };
    expect(() => combineServices([withDuplicateVariable])).toThrow("Duplicate variable key: baseUrl_users");
  });

  test("keeps services without endpoints in the combined descriptor", () => {
    const empty = {
      ...service("empty", "https://empty.example.com", { kind: "none" }, operation("empty", "unused")),
      endpoints: [],
    };
    const result = combineServices([empty]);
    expect(result.operations).toEqual([]);
    expect(result.variables).toEqual([{ key: "baseUrl_empty", value: "https://empty.example.com" }]);
  });

  test("rejects a service without an id", () => {
    const anonymous = service("", "https://anon.example.com", { kind: "none" }, operation("", "anon"));

    expect(() => combineServices([anonymous])).toThrow("Service id must not be empty");
  });

  test("rejects two services that publish the same variable key", () => {
    const users = {
      ...service("users", "https://users.example.com", { kind: "none" }, operation("users", "users-list")),
      variables: [{ key: "shared", value: "from-users" }],
    };
    const billing = {
      ...service("billing", "https://billing.example.com", { kind: "none" }, operation("billing", "billing-invoices")),
      variables: [{ key: "shared", value: "from-billing" }],
    };

    expect(() => combineServices([users, billing])).toThrow("Duplicate variable key: shared");
  });

  test("rejects a service whose variable collides with another service's baseUrl variable", () => {
    const users = service("users", "https://users.example.com", { kind: "none" }, operation("users", "users-list"));
    const billing = {
      ...service("billing", "https://billing.example.com", { kind: "none" }, operation("billing", "billing-invoices")),
      variables: [{ key: "baseUrl_users", value: "https://elsewhere.example.com" }],
    };

    expect(() => combineServices([users, billing])).toThrow("Duplicate variable key: baseUrl_users");
  });

  test("the first service is not special: the merge does not depend on the order", () => {
    const users = service("users", "https://users.example.com", { kind: "scheme", scheme: "oauth2" }, operation("users", "users-list"));
    const billing = service("billing", "https://billing.example.com", { kind: "scheme", scheme: "apiKey" }, operation("billing", "billing-invoices"));

    const forward = combineServices([users, billing]);
    const backward = combineServices([billing, users]);

    // The variables are published in the order the services came in,
    // but their CONTENT does not depend on that order: the same two
    // variables, each pointing at its own service.
    expect([...backward.variables].sort((left, right) => left.key.localeCompare(right.key))).toEqual(
      [...forward.variables].sort((left, right) => left.key.localeCompare(right.key)),
    );
    expect(backward.operations.map(({ serviceId, serverRef, authRef }) => ({ serviceId, url: serverRef.url, auth: authRef.type }))).toEqual(
      [...forward.operations].reverse().map(({ serviceId, serverRef, authRef }) => ({ serviceId, url: serverRef.url, auth: authRef.type })),
    );
  });
});