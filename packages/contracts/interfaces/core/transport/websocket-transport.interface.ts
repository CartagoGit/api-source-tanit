export interface IWebSocketTransport {
  readonly kind: "websocket";
  readonly event: string;
  readonly direction: "in" | "out" | "both";
  readonly namespace: string;
}

export type WebSocketTransport = IWebSocketTransport;