export interface IMessageBrokerTransport {
  readonly kind: "broker";
  readonly broker: "kafka" | "rabbitmq" | "nats" | "mqtt";
  readonly channel: string;
  readonly direction: "publish" | "subscribe";
}

export type MessageBrokerTransport = IMessageBrokerTransport;