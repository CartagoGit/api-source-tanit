import type { ISchemaGraph } from "./schema.interface.js";
import type { IValidationSource } from "./validation-source.interface.js";
import type { ITransportMeta, TransportKind } from "./transport.interface.js";

/** Endpoint declared in the legacy discovery and exporter pipeline. */
export interface EndpointSpec {
  serviceId?: string;
  name: string;
  method:
    | "GET"
    | "POST"
    | "PUT"
    | "PATCH"
    | "DELETE"
    | "HEAD"
    | "OPTIONS"
    | "TRACE"
    | "ALL";
  uri: string;
  description?: string;
  body?: unknown;
  query?: Array<{ key: string; value: string; description?: string }>;
  headers?: Array<{
    key: string;
    value: string;
    description?: string;
  }>;
  folder?: string;
  auth?: IEndpointAuth;
  /** @deprecated Use `validationSource`. */
  formRequest?: string;
  validationSource?: IValidationSource;
  /** @deprecated Legacy flat view; prefer `schemaGraph`. */
  fields?: ReadonlyArray<IEndpointField>;
  schemaGraph?: ISchemaGraph;
  confidence?: IEndpointConfidence;
  transport?: TransportKind;
  transportMeta?: ITransportMeta;
  responses?: ReadonlyArray<import("./responses.interface.js").IResponseInference>;
}

export interface IEndpointConfidence {
  readonly level: "high" | "medium" | "low";
  readonly reasons: ReadonlyArray<string>;
}

export type IEndpointAuth =
  | { readonly kind: "none" }
  | { readonly kind: "scheme"; readonly scheme: "bearer" | "apiKey" | "oauth2" };

export interface IEndpointField {
  readonly fieldName: string;
  readonly location: "body" | "query" | "path" | "header" | "cookie";
  readonly type: string;
  readonly required: boolean;
  readonly format?: string | undefined;
  readonly enumValues?: ReadonlyArray<string> | undefined;
  readonly minimum?: number | undefined;
  readonly maximum?: number | undefined;
  readonly minLength?: number | undefined;
  readonly maxLength?: number | undefined;
}

/** Route discovered in the legacy Laravel route scanner. */
export interface DiscoveredRoute {
  method: string;
  uri: string;
}