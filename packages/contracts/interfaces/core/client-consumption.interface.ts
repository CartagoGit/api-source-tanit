import type { ILocation } from "../language-ir/location.interface.js";
import type { EndpointSpec } from "./endpoint-legacy.interface.js";

export interface IClientAlias {
  /** Identifier or member expression such as "http" or "this.http". */
  readonly receiver: string;
  /** Exact import specifier when this configuration vouches for an imported binding. */
  readonly source?: string;
  /** Explicitly records wrappers or SDKs whose request semantics are unavailable. */
  readonly kind?: "http" | "unsupported";
}

export interface IClientConsumptionOptions {
  readonly aliases?: readonly IClientAlias[];
  /** Explicitly selected operation catalog for one backend. An empty catalog is valid. */
  readonly backend?: readonly IClientBackendOperation[];
}

export type IClientBackendOperation = Readonly<
  Pick<EndpointSpec, "method" | "uri"> &
  Partial<Pick<EndpointSpec, "name" | "serviceId">> &
  { readonly id?: string; readonly location?: ILocation }
>;

export type ClientUnresolvedReason =
  | "shadowed-client"
  | "unresolved-alias"
  | "unsupported-call"
  | "dynamic-url"
  | "invalid-url"
  | "relative-url"
  | "dynamic-method"
  | "unknown-options";

export interface IClientUsage {
  readonly method?: string;
  readonly url?: string;
  readonly path?: string;
  /** Hostname with explicit non-default port, if present. */
  readonly host?: string;
  readonly location: ILocation;
  readonly evidence: {
    readonly recognizer: "fetch" | "axios" | "configured-alias";
    readonly callee: string;
    readonly staticUrl?: "literal" | "expression";
  };
  readonly confidence: "high" | "medium" | "low";
  readonly unresolvedReason?: ClientUnresolvedReason;
  readonly correlation?: {
    readonly status: "matched" | "missing" | "ambiguous" | "unknown";
    readonly candidates: readonly IClientBackendOperation[];
  };
}

export interface IClientConsumptionResult {
  readonly usages: readonly IClientUsage[];
  readonly diagnostics: readonly {
    readonly file: string;
    readonly reason: "unsupported-template" | "parse-failed";
  }[];
  readonly counts: {
    readonly resolved: number;
    readonly unresolved: number;
    readonly matched: number;
    readonly missing: number;
    readonly ambiguous: number;
  };
  /** Includes operations with no unique match, including possible matches in ambiguous calls. */
  readonly operationsWithoutConfirmedConsumer?: readonly IClientBackendOperation[];
}
