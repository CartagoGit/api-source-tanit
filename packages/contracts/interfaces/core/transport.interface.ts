/**
 * Transport kinds — gRPC, WebSockets, SSE, AsyncAPI / brokers, and HTTP.
 *
 * Today `EndpointSpec` is HTTP-centric: every endpoint is a tuple
 * `(method, path)` produced by a framework scanner. Audit
 * 2026-09-06 §11 (`f00013`) extends that model so Tanit can
 * describe gRPC services (`.proto`), WebSocket handlers
 * (`socket.emit` / `socket.on`), SSE streams and AsyncAPI /
 * pub-sub channels — without breaking the HTTP scanners that
 * today produce 100% of the output.
 *
 * `"http"` stays the default. HTTP-only consumers ignore every
 * spec whose `transport` is anything else; future exporters
 * (`postman.grpc`, `openapi.asyncapi`, etc.) will own the rest.
 */
export type TransportKind =
  | "http"
  | "grpc"
  | "ws"
  | "sse"
  | "kafka"
  | "rabbitmq"
  | "nats"
  | "mqtt"
  | string;

/**
 * Transport metadata attached to an `EndpointSpec` when it is not
 * plain HTTP. The fields are intentionally loose on purpose:
 * scanners for different transports will fill different subsets.
 *
 * For `"grpc"`:
 *   - `service`:    the service name (`Greeter`).
 *   - `method`:     the method name (`SayHello`).
 *   - `streaming`:  `"unary" | "server-stream" | "client-stream" | "bidi"`.
 *
 * For `"ws"` / `"sse"`:
 *   - `event`:      the event name (`"chat"`, `"tick"`).
 *   - `direction`:  `"in" | "out"` (server-received vs server-sent).
 *
 * For `"kafka"` / `"rabbitmq"` / `"nats"` / `"mqtt"`:
 *   - `channel`:    the channel / topic / queue (`orders.created`).
 */
export interface ITransportMeta {
  readonly service?: string;
  readonly method?: string;
  readonly streaming?: "unary" | "server-stream" | "client-stream" | "bidi";
  readonly event?: string;
  readonly direction?: "in" | "out";
  readonly channel?: string;
}
