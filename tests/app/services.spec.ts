import { describe, expect, it, vi } from "vitest";
import { ServicesClient } from "../../packages/app/src/app/core/api/services.client";

describe("ServicesClient", () => {
  it("lists rich service projections", async () => {
    const bridge = { request: vi.fn().mockResolvedValue({ services: [{ serviceId: "api", framework: "express", transports: ["http"], auth: { kind: "bearer" }, baseUrl: "http://localhost", operationCount: 1, operations: [] }] }) };
    const result = await new ServicesClient(bridge as never).list("/workspace");
    expect(result[0]).toMatchObject({ serviceId: "api", framework: "express", operationCount: 1 });
  });

  it("resolves a service detail by id", async () => {
    const bridge = { request: vi.fn().mockResolvedValue({ service: { serviceId: "api", framework: "express", transports: ["http"], auth: null, serverRef: "server-api", authRef: "auth-api", operationCount: 0, operations: [{ operationId: "get", method: "GET", path: "/", serverRef: "server-op", authRef: "auth-op" }] } }) };
    const result = await new ServicesClient(bridge as never).detail("/workspace", "api");
    expect(result.serviceId).toBe("api");
    expect(bridge.request).toHaveBeenCalledWith("service-detail", { projectRoot: "/workspace", serviceId: "api" });
    expect(result.operations[0]).toMatchObject({ serverRef: "server-op", authRef: "auth-op" });
  });
});