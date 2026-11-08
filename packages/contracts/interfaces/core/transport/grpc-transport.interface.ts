export interface IGrpcTransport {
  readonly kind: "grpc";
  readonly service: string;
  readonly rpc: string;
  readonly streaming: "unary" | "server" | "client" | "bidi";
}

export type GrpcTransport = IGrpcTransport;