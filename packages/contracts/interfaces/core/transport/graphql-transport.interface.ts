export interface IGraphQlTransport {
  readonly kind: "graphql";
  readonly operationType: "query" | "mutation" | "subscription";
  readonly operationName: string;
}

export type GraphQlTransport = IGraphQlTransport;