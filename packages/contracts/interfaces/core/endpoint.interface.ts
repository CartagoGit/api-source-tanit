/**
 * The endpoint, as the app sees it.
 *
 * ## What this is
 *
 * A **view model**: what the endpoint explorer draws. Every field
 * here comes from the Application API — from the summary the
 * backend answers with, or from the detail it fetches when an
 * endpoint is selected. Nothing is made up.
 *
 * ## What it used to be
 *
 * A shape the app filled in itself, from a generator that produced
 * five thousand endpoints out of nothing. It had an `auth` scheme
 * nobody detected, a `confidence` no scanner had measured, a
 * `sourceFile` that pointed at files that did not exist, and a
 * `code` snippet written by the generator itself. The screens looked
 * finished and every number on them was fiction.
 *
 * ## What is missing, and why
 *
 *   · There is no per-endpoint `diagnostics`. The snapshot's
 *     diagnostics are **per scan**, not per operation: they say
 *     "the OpenAPI file could not be read", not "this endpoint is
 *     wrong". Putting them on an endpoint would be a lie about
 *     their scope.
 *   · There is no `code`. The API serves *data* about an endpoint,
 *     not the text of the file it came from — the browser has no
 *     business reading the user's source, and the desktop app can
 *     open the file itself from `sourceFile` and `line`.
 *   · `responses` and `parameters` are empty until the endpoint is
 *     selected. They live in the detail, and the detail is fetched
 *     on demand: loading every schema of every endpoint of a large
 *     project to draw a list would be slow for nothing.
 */
import type { TransportKind } from "./transport.interface.js";

export type { TransportKind };

/**
 * The transports the product knows.
 *
 * `"http"` is the default and the only one every scanner produces
 * today. The others are there because the model has room for them,
 * not because a scanner fills them yet.
 */
export const ENDPOINT_TRANSPORTS = [
  "http",
  "grpc",
  "ws",
  "sse",
  "kafka",
  "rabbitmq",
  "nats",
  "mqtt",
] as const;

export type EndpointTransport = TransportKind;

/** How sure the scanner is about an endpoint. */
export const ENDPOINT_CONFIDENCES = ["high", "medium", "low"] as const;
export type EndpointConfidence = (typeof ENDPOINT_CONFIDENCES)[number];

export interface EndpointParameter {
  readonly name: string;
  readonly location: "path" | "query" | "header" | "body";
  readonly required: boolean;
  readonly type: string;
}

export interface EndpointResponse {
  readonly status: string;
  readonly description: string;
  readonly schema?: unknown;
}

/** One endpoint, as the explorer draws it. */
export interface EndpointRecord {
  /** Stable identity: the method and the URI. */
  readonly id: string;
  /** The name the scanner gave the operation. */
  readonly operationId: string;
  /**
   * The service (workspace) it belongs to.
   *
   * Absent when the scanner did not name one. The app used to write
   * `"default"`, which is a service nobody ever saw.
   */
  readonly service?: string;
  /**
   * The framework that recognized it.
   *
   * Absent when no framework claimed it. The app used to write
   * `"unknown"`, which reads like a framework named *unknown*.
   */
  readonly framework?: string;
  /**
   * The transport it speaks.
   *
   * Absent when it was not reported. The app used to write `"http"`,
   * which is a claim about a route nobody looked at.
   */
  readonly transport?: EndpointTransport;
  readonly method: string;
  readonly path: string;
  readonly description: string;
  /**
   * The authentication the spec declares — `"bearer"`, `"apiKey"`,
   * `"oauth2"` — whatever the spec says.
   *
   * Absent when the spec declares none. The app used to write
   * `"none"`, which says the route is open; not knowing is not the
   * same as knowing there is no auth.
   */
  readonly auth?: string;
  /**
   * The validation provider, when one was detected.
   *
   * Absent when none was. Same reasoning as `auth`.
   */
  readonly validation?: string;
  /** The response statuses, comma separated. */
  readonly responseSummary: string;
  /** Filled in when the endpoint is selected. */
  readonly responses: readonly EndpointResponse[];
  /** Filled in when the endpoint is selected. */
  readonly parameters: readonly EndpointParameter[];
  /**
   * The request schema, once the endpoint is selected.
   *
   * `undefined` when there is none: the app used to answer with a
   * made-up `{ kind: "none" }`, a schema-shaped object nobody
   * produced.
   */
  readonly requestSchema?: unknown;
  /** Where it was declared, when the scanner knew. */
  readonly sourceFile?: string;
  /** The line of the declaration, when the scanner knew. */
  readonly line?: number;
  /** How sure the scanner is. */
  readonly confidence?: EndpointConfidence;
}

/**
 * The filters the explorer offers.
 *
 * Every one of them is answered by the backend: the list is not
 * filtered in the client, because a client-side filter over a page
 * of a large list answers "is it in this page", not "does it exist".
 */
export interface EndpointQuery {
  readonly service?: string;
  readonly framework?: string;
  readonly transport?: EndpointTransport;
  readonly method?: string;
  readonly auth?: string;
  readonly validation?: string;
  /** A status, matched against the endpoint's responses. */
  readonly responses?: string;
  readonly confidence?: EndpointConfidence;
  /** A path fragment of the declaring file. */
  readonly sourceFile?: string;
  /** Free text over the method, the URI and the name. */
  readonly search?: string;
}

/** The answer of the endpoint list. */
export interface EndpointListResponse {
  readonly endpoints: readonly EndpointRecord[];
  /** How many endpoints match the filter. */
  readonly total: number;
  /** How many endpoints the project has, filtered or not. */
  readonly indexedTotal: number;
}
