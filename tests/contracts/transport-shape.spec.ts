import { describe, expect, it } from "vitest";
import {
  isGraphQlTransport,
  isGrpcTransport,
  isHttpTransport,
  isMessageBrokerTransport,
  isSseTransport,
  isWebSocketTransport,
} from "../../packages/core/transport/transport-narrow.guard.js";
import type { Transport } from "../../packages/contracts/index.js";

describe("transport contracts", () => {
  it("narrows every discriminated transport", () => {
    const transports: Transport[] = [
      { kind: "http", method: "GET", path: "/health" },
      { kind: "graphql", operationType: "query", operationName: "Health" },
      { kind: "grpc", service: "Health", rpc: "Check", streaming: "unary" },
      { kind: "websocket", event: "health", direction: "out", namespace: "/system" },
      { kind: "sse", event: "health", streamPath: "/events" },
      { kind: "broker", broker: "nats", channel: "health", direction: "subscribe" },
    ];

    expect(transports.filter(isHttpTransport)).toHaveLength(1);
    expect(transports.filter(isGraphQlTransport)).toHaveLength(1);
    expect(transports.filter(isGrpcTransport)).toHaveLength(1);
    expect(transports.filter(isWebSocketTransport)).toHaveLength(1);
    expect(transports.filter(isSseTransport)).toHaveLength(1);
    expect(transports.filter(isMessageBrokerTransport)).toHaveLength(1);
  });

  it("rejects an incomplete gRPC payload at runtime", () => {
    expect(
      isGrpcTransport({ kind: "grpc", rpc: "Check", streaming: "unary" }),
    ).toBe(false);
  });
});