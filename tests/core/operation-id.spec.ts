import { describe, expect, it } from "vitest";
import type { Transport } from "../../packages/contracts/index.js";
import { operationIdFor } from "../../packages/core/transport/operation-id.service.js";

describe("operationIdFor", () => {
  const transports: Transport[] = [
    { kind: "http", method: "GET", path: "/users" },
    { kind: "graphql", operationType: "query", operationName: "Users" },
    { kind: "grpc", service: "Greeter", rpc: "SayHello", streaming: "unary" },
    { kind: "websocket", event: "message", direction: "both", namespace: "/chat" },
    { kind: "sse", event: "tick", streamPath: "/events" },
    { kind: "broker", broker: "kafka", channel: "orders.created", direction: "publish" },
  ];

  it.each(transports)("derives a stable id for $kind", (transport) => {
    expect(operationIdFor(transport, { serviceId: "users" })).toEqual(
      operationIdFor(transport, { serviceId: "users" }),
    );
  });

  it("includes the service and optional operation context", () => {
    expect(
      operationIdFor(
        { kind: "http", method: "GET", path: "/users" },
        { serviceId: "users", operationName: "listUsers" },
      ),
    ).toEqual({
      kind: "operation",
      value: "users:GET:/users:listUsers",
    });
  });

  it("rejects a gRPC transport without a service", () => {
    expect(() =>
      operationIdFor({
        kind: "grpc",
        service: "",
        rpc: "SayHello",
        streaming: "unary",
      }),
    ).toThrow("Invalid transport: service is required");
  });
});