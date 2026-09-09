export type {
  IOperation,
  IRequestSpec,
  IResponseSpec,
} from "./interfaces/core/operation.interface.js";
export type { IServerRef, ServerRef } from "./interfaces/core/server-ref.interface.js";
export type { IAuthRef, AuthRef } from "./interfaces/core/auth-ref.interface.js";
export type { IProvenance } from "./interfaces/core/provenance.interface.js";
export type { AuthRef as StableAuthRef, OperationId, ServerRef as StableServerRef } from "./interfaces/core/stable-ids.interface.js";
export type {
  Transport,
  TransportKind,
  IHttpTransport,
  HttpTransport,
  IGraphQlTransport,
  GraphQlTransport,
  IGrpcTransport,
  GrpcTransport,
  IWebSocketTransport,
  WebSocketTransport,
  ISseTransport,
  SseTransport,
  IMessageBrokerTransport,
  MessageBrokerTransport,
  IOperationIdContext,
} from "./interfaces/core/transport/index.js";
export type {
  ICombinedDescriptor,
  IResolvedOperationContext,
  IServiceDescriptor,
} from "./interfaces/core/service.interface.js";
export type {
  IGroupByServiceInput,
  IServiceGraph,
  IServiceGraphNode,
  IToServiceGraphInput,
} from "./interfaces/core/service-graph.interface.js";