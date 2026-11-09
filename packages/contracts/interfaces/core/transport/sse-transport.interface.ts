export interface ISseTransport {
  readonly kind: "sse";
  readonly event: string;
  readonly streamPath: string;
}

export type SseTransport = ISseTransport;