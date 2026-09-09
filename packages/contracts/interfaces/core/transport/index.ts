import type { IGraphQlTransport } from "./graphql-transport.interface.js";
import type { IGrpcTransport } from "./grpc-transport.interface.js";
import type { IHttpTransport } from "./http-transport.interface.js";
import type { IMessageBrokerTransport } from "./message-broker-transport.interface.js";
import type { ISseTransport } from "./sse-transport.interface.js";
import type { IWebSocketTransport } from "./websocket-transport.interface.js";

export type { HttpMethod, IHttpTransport, HttpTransport } from "./http-transport.interface.js";
export type { IGraphQlTransport, GraphQlTransport } from "./graphql-transport.interface.js";
export type { IGrpcTransport, GrpcTransport } from "./grpc-transport.interface.js";
export type { IWebSocketTransport, WebSocketTransport } from "./websocket-transport.interface.js";
export type { ISseTransport, SseTransport } from "./sse-transport.interface.js";
export type { IMessageBrokerTransport, MessageBrokerTransport } from "./message-broker-transport.interface.js";

export type Transport =
  | IHttpTransport
  | IGraphQlTransport
  | IGrpcTransport
  | IWebSocketTransport
  | ISseTransport
  | IMessageBrokerTransport;

export type TransportKind = Transport["kind"];

export type { OperationId } from "../stable-ids.interface.js";
export type { IOperationIdContext } from "./operation-id.service.js";
export { operationIdFor } from "./operation-id.service.js";
export {
  isHttpTransport,
  isGraphQlTransport,
  isGrpcTransport,
  isWebSocketTransport,
  isSseTransport,
  isMessageBrokerTransport,
} from "./transport-narrow.guard.js";