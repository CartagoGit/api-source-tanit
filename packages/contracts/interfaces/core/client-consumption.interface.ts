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

/** A static, external template declared by an imported Angular Component decorator. */
export interface IAngularClientTemplateOwner {
  readonly templateUrl: string;
  readonly members: ReadonlySet<string>;
}

export interface IClientConsumptionOptions {
  readonly aliases?: readonly IClientAlias[];
  /** Internal observer for static JSON evidence retained only during comparison. */
  readonly observeJsonRequest?: (location: ILocation, body: string) => void;
  /** Explicitly selected operation catalog for one backend. An empty catalog is valid. */
  readonly backend?: readonly IClientBackendOperation[];
}

export type IClientBackendOperation = Readonly<
  Pick<EndpointSpec, "method" | "uri"> &
  Partial<Pick<EndpointSpec, "name" | "serviceId">> &
  { readonly id?: string; readonly location?: ILocation }
>;

/** An explicitly selected backend service and its HTTP route inventory. */
export interface ISelectedClientBackend {
  readonly id: string;
  /** Canonical URL.host (hostname and any explicit non-default port). */
  readonly host?: string;
  readonly operations: readonly IClientBackendOperation[];
}

export interface IClientLinkCandidate {
  readonly backendId: string;
  readonly operation: IClientBackendOperation;
}

export interface IClientContractSource {
  readonly file: string;
  readonly pointer: string;
}

export interface IDeclaredJsonRequestContract {
  readonly source: IClientContractSource;
  readonly schema: unknown;
}

export interface IJsonRequestCheck {
  readonly verdict: "compatible" | "incompatible" | "unknown";
  readonly reason?: "unsupported-schema" | "invalid-json" | "missing-field" | "unexpected-field" |
    "type-mismatch" | "enum-mismatch" | "unsupported-json" | "missing-client-json" | "missing-backend-schema";
  readonly field?: string;
  readonly source?: IClientContractSource;
}

export interface IClientLinkedCall {
  readonly usage: IClientUsage;
  readonly status: NonNullable<IClientUsage["correlation"]>["status"];
  /** Set when the call matches or is attributable to exactly one selected backend. */
  readonly backendId?: string;
  readonly candidates: readonly IClientLinkCandidate[];
  readonly requestContract?: IJsonRequestCheck;
}

export interface IClientLinkComparisonResult {
  readonly calls: readonly IClientLinkedCall[];
  readonly backends: readonly {
    readonly id: string;
    readonly operationsWithoutConfirmedConsumer: readonly IClientBackendOperation[];
  }[];
}

/** A workspace comparison between explicitly declared frontends and backend services. */
export interface IClientProjectLinksInput {
  readonly compareRequestBodies?: boolean;
  readonly frontends: readonly {
    readonly root: string;
    readonly aliases?: readonly IClientAlias[];
  }[];
  readonly links: readonly {
    readonly frontendRoot: string;
    readonly backendRoot: string;
    readonly serviceId: string;
    /** Optional canonical URL.host of the selected backend. */
    readonly host?: string;
  }[];
}

export interface IClientProjectLinksReport {
  readonly frontends: readonly {
    readonly root: string;
    readonly diagnostics: IClientConsumptionResult["diagnostics"];
    readonly calls: IClientLinkComparisonResult["calls"];
    readonly backends: readonly {
      readonly id: string;
      readonly root: string;
      readonly serviceId: string;
      readonly operationsWithoutConfirmedConsumer: readonly IClientBackendOperation[];
    }[];
  }[];
}

export type ClientProjectRole = "frontend" | "backend";

/** The concrete workspace folders or discovered backend services a host can offer for selection. */
export type ClientProjectCandidates =
  | {
      readonly role: "frontend";
      readonly root: string;
      readonly projects: readonly { readonly root: string; readonly relativePath: string }[];
    }
  | {
      readonly role: "backend";
      readonly root: string;
      readonly services: readonly {
        readonly serviceId: string;
        readonly relativePath: string;
        readonly framework: string;
        readonly httpOperationCount: number;
      }[];
    };

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
    readonly recognizer: "fetch" | "axios" | "angular-http-client" | "configured-alias";
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
    readonly reason: "unsupported-template" | "unsupported-script" | "parse-failed";
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
