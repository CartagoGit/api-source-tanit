import type { IGraphQlTransport } from "./graphql-transport.interface.js";
import type { IGrpcTransport } from "./grpc-transport.interface.js";
import type { IHttpTransport } from "./http-transport.interface.js";
import type { IMessageBrokerTransport } from "./message-broker-transport.interface.js";
import type { ISseTransport } from "./sse-transport.interface.js";
import type { IWebSocketTransport } from "./websocket-transport.interface.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isHttpTransport(transport: unknown): transport is IHttpTransport {
  return isRecord(transport) && transport.kind === "http" && typeof transport.method === "string" && typeof transport.path === "string" && transport.path.trim().length > 0;
}

export function isGraphQlTransport(transport: unknown): transport is IGraphQlTransport {
  return isRecord(transport) && transport.kind === "graphql" && ["query", "mutation", "subscription"].includes(String(transport.operationType)) && typeof transport.operationName === "string" && transport.operationName.trim().length > 0;
}

export function isGrpcTransport(transport: unknown): transport is IGrpcTransport {
  return isRecord(transport) && transport.kind === "grpc" && typeof transport.service === "string" && transport.service.trim().length > 0 && typeof transport.rpc === "string" && transport.rpc.trim().length > 0 && ["unary", "server", "client", "bidi"].includes(String(transport.streaming));
}

export function isWebSocketTransport(transport: unknown): transport is IWebSocketTransport {
  return isRecord(transport) && transport.kind === "websocket" && typeof transport.event === "string" && transport.event.trim().length > 0 && ["in", "out", "both"].includes(String(transport.direction)) && typeof transport.namespace === "string";
}

export function isSseTransport(transport: unknown): transport is ISseTransport {
  return isRecord(transport) && transport.kind === "sse" && typeof transport.event === "string" && transport.event.trim().length > 0 && typeof transport.streamPath === "string" && transport.streamPath.trim().length > 0;
}

export function isMessageBrokerTransport(transport: unknown): transport is IMessageBrokerTransport {
  return isRecord(transport) && transport.kind === "broker" && ["kafka", "rabbitmq", "nats", "mqtt"].includes(String(transport.broker)) && typeof transport.channel === "string" && transport.channel.trim().length > 0 && ["publish", "subscribe"].includes(String(transport.direction));
}