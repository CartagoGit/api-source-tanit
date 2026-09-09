import type { OperationId } from "../stable-ids.interface.js";
import type { IGraphQlTransport } from "./graphql-transport.interface.js";
import type { IGrpcTransport } from "./grpc-transport.interface.js";
import type { IHttpTransport } from "./http-transport.interface.js";
import type { IMessageBrokerTransport } from "./message-broker-transport.interface.js";
import type { ISseTransport } from "./sse-transport.interface.js";
import type { IWebSocketTransport } from "./websocket-transport.interface.js";

type Transport =
  | IHttpTransport
  | IGraphQlTransport
  | IGrpcTransport
  | IWebSocketTransport
  | ISseTransport
  | IMessageBrokerTransport;

export interface IOperationIdContext {
  readonly serviceId?: string;
  readonly operationName?: string;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported transport kind: ${String(value)}`);
}

function stablePart(value: string): string {
  return value.trim().replace(/\s+/g, "-");
}

function requiredPart(value: string, field: string): string {
  const normalized = stablePart(value);
  if (normalized.length === 0) {
    throw new Error(`Invalid transport: ${field} is required`);
  }
  return normalized;
}

export function operationIdFor(
  transport: Transport,
  context: IOperationIdContext = {},
): OperationId {
  const prefix = context.serviceId === undefined ? "" : `${stablePart(context.serviceId)}:`;
  let identity: string;

  switch (transport.kind) {
    case "http":
      identity = `${transport.method}:${requiredPart(transport.path, "path")}`;
      break;
    case "graphql":
      identity = `${transport.operationType}:${requiredPart(transport.operationName, "operationName")}`;
      break;
    case "grpc":
      identity = `${requiredPart(transport.service, "service")}/${requiredPart(transport.rpc, "rpc")}:${transport.streaming}`;
      break;
    case "websocket":
      identity = `${requiredPart(transport.namespace, "namespace")}:${requiredPart(transport.event, "event")}:${transport.direction}`;
      break;
    case "sse":
      identity = `${requiredPart(transport.streamPath, "streamPath")}:${requiredPart(transport.event, "event")}`;
      break;
    case "broker":
      identity = `${transport.broker}:${requiredPart(transport.channel, "channel")}:${transport.direction}`;
      break;
    default:
      return assertNever(transport);
  }

  const operationName = context.operationName === undefined
    ? ""
    : `:${requiredPart(context.operationName, "operationName")}`;
  return Object.freeze({
    kind: "operation",
    value: `${prefix}${identity}${operationName}`,
  });
}