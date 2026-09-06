/**
 * Postman schema v2.1.0 types.
 * Official documentation: https://schema.getpostman.com/json/collection/v2.1.0/collection.json
 */
import type { ISchemaGraph } from "./schema.interface.js";
import type { IValidationSource } from "./validation-source.interface.js";
import type { ITransportMeta, TransportKind } from "./transport.interface.js";

export interface PostmanUrl {
  raw: string;
  host: string[];
  path: string[];
  query?: Array<{
    key: string;
    value: string;
    description?: string;
    disabled?: boolean;
  }>;
}

/** An HTTP header as Postman stores it. */
export interface PostmanHeader {
  key: string;
  value: string;
  type?: string;
}

/**
 * The body of a request.
 *
 * This project only emits `raw` with JSON: that is what can be derived
 * from validation rules. The other modes exist in the format and are
 * declared so we can read someone else's collection without losing
 * them.
 */
export interface PostmanBody {
  mode: "raw" | "formdata" | "urlencoded" | "file";
  raw?: string;
  options?: { raw?: { language: string } };
}

/**
 * The request of an item: what is sent and where.
 *
 * `method` is `string` and not the verb union because we also read
 * collections not written by this tool here.
 */
export interface PostmanRequest {
  method: string;
  header: PostmanHeader[];
  url: PostmanUrl;
  description?: string;
  body?: PostmanBody;
}

/**
 * A script that Postman runs around the request.
 *
 * `prerequest` runs before sending it; `test`, after receiving the
 * response. `exec` is the script split into lines, which is how the
 * format stores it.
 */
export interface PostmanEvent {
  listen: "test" | "prerequest";
  script: { type: string; exec: string[] };
}

/**
 * A node in the collection tree.
 *
 * It is folder **or** request depending on which field it carries:
 * with `item` it is a folder, with `request` it is a request. The
 * format does not separate them into two types, so we don't either.
 */
export interface PostmanItem {
  name: string;
  item?: PostmanItem[];
  request?: PostmanRequest;
  description?: string;
  event?: PostmanEvent[];
}

/**
 * A collection or environment variable.
 *
 * `type: "secret"` makes Postman hide it in the UI: that's what the
 * token and credentials carry.
 */
export interface PostmanVariable {
  key: string;
  value: string;
  type?: string;
}

/**
 * A complete Postman v2.1.0 collection.
 *
 * The `_postman_id` of `info` is what decides whether reimporting
 * **updates** the collection or creates a new one next to it, so it
 * is derived from the project and not rolled (p00014).
 */
export interface PostmanCollection {
  info: {
    name: string;
    description: string;
    schema: string;
    _postman_id?: string;
  };
  auth?: {
    type: string;
    bearer?: Array<{ key: string; value: string; type?: string }>;
  };
  variable: PostmanVariable[];
  item: PostmanItem[];
}

/** Endpoint declared in build-collection.service.ts (catalogue). */
export interface EndpointSpec {
  /**
   * `serviceId` of the workspace this spec was emitted from.
   *
   * x00028 S3: needed so the cross-service dedupe (and the per-service
   * spec filter) doesn't conflate two endpoints from different
   * workspaces that happen to share `(method, uri)`. Without it,
   * `apps/users` and `apps/orders` both emitting `GET /health` would
   * dedupe each other out of the global catalog, and then each
   * service's collection would lose its own `/health` (or both
   * would see both, depending on the order of operations).
   *
   * Set by `buildSpecsFromScanner` using `deriveServiceId(match)`;
   * downstream consumers (filter, merger, dedupe) read it via
   * `endpointKey`.
   *
   * Empty/missing = flat project (legacy single-service case). The
   * key keeps colliding so the original behaviour is preserved.
   */
  serviceId?: string;
  name: string;
  /**
   * HTTP method.
   *
   * `HEAD`, `OPTIONS`, and `TRACE` enter here because scanners detect
   * them and Postman supports them. Without them, a Fastify
   * `method: ["GET", "HEAD"]`, a Fiber `app.Options()`, or a `trace:`
   * on an OpenAPI path scanned fine and disappeared in the adapter
   * without saying anything.
   *
   * `ALL` is the sentinel emitted by Hono's `.all()` (commit
   * `aad6376`): the scanner records the semantic meaning ("any
   * method") and each exporter materialises it in its own format
   * (Postman `ANY`, OpenAPI/HAR/Bruno expansion to the seven standard
   * verbs). Without `ALL` in this union the adapter dropped the
   * route end-to-end — the second audit 2026-09-06 §6 caught it.
   *
   * The runtime list lives in `SUPPORTED_METHODS` (same package) and
   * is what the adapter consults to decide what to let through:
   * keeping both in sync is the guarantee that adding a verb here
   * takes effect.
   */
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
  /** Relative URI without the `/api` prefix. Starts with `/`. */
  uri: string;
  description?: string;
  /** Literal JSON object for the body. Serialized to pretty JSON. */
  body?: unknown;
  /** Optional query params. */
  query?: Array<{ key: string; value: string; description?: string }>;
  /**
   * Optional custom headers (e.g. `X-API-Key`).
   * The `Authorization` and `Accept` headers are added automatically
   * in collection-builder; this array is ADDITIONAL.
   */
  headers?: Array<{
    key: string;
    value: string;
    description?: string;
  }>;
  /**
   * Explicit folder. If present, used as the folder name instead of
   * the one computed automatically by `topGroupFor(uri)`. Useful for
   * grouping endpoints that live under different prefixes under the
   * same logical folder (e.g. "ERP" contains `erp/*` and
   * `tol/tecdoc/*`).
   */
  folder?: string;
  /**
   * Per-operation override of the collection's auth scheme.
   *
   * Before, the builder injected `Authorization: Bearer {{token}}`
   * into **every** request when the global scheme was bearer —also
   * in `/auth/login`, which is precisely the endpoint that emits
   * the token. Result: a 401 on the first Send, with the blame
   * pointing at a request that is actually what fills the
   * variable.
   *
   * With this field, an endpoint can declare itself public
   * (`auth: { kind: "none" }`) and the builder omits the
   * `Authorization` header for it, without touching the global
   * scheme. Designed for login, /health, /register, /forgot-password
   * and similar.
   *
   * The `scheme` discriminator is reserved for future scheme
   * overrides (apiKey, oauth2) — today the only useful case is
   * `none`.
   *
   * S3.b (a00012). The rule lives in
   * `packages/core/domain/collection-builder.service.ts` →
   * `defaultHeaders()`.
   */
  auth?: IEndpointAuth;
  /**
   * Project-relative path of the associated FormRequest
   * (e.g. `app/Http/Requests/Usuarios/NuevoUsuarioRequest.php`).
   * If present, the enricher uses it directly instead of heuristics.
   *
   * @deprecated Use `validationSource`. The string field was a mix
   * of **provider** and artefact **path** — the adapter wrote it as
   * `"laravel:app/Http/Requests/..."` even though the framework
   * name was the routing data, not an endpoint property. Kept for
   * compat with `enrichCatalogWithFormRequests` and with the tests
   * that still read it; new providers declare their contract in
   * `IValidationSource`. S5 (a00012).
   */
  formRequest?: string;
  /**
   * Framework-agnostic source of the endpoint's validation rules.
   *
   * If present, the adapter has already decided WHICH enricher (not
   * which framework) processes it. The registry
   * (`packages/core/validation/validation-enricher.service.ts`)
   * dispatches by `provider`, and frameworks without an enricher
   * yet are skipped.
   *
   * The adapter (S5) only assigns it when the resolved provider is
   * `"laravel-form-request"`. Any other case —Express, FastAPI,
   * OpenAPI— leaves the field `undefined`, and that closes S5:
   * `enrichCatalogWithFormRequests` is no longer called for
   * non-Laravel projects. Migrating the rest of the frameworks is
   * a follow-up of a00010 S6 and beyond.
   *
   * Kept mutable (no `readonly`) to fit the adapter pattern:
   * `parsed-route-to-spec.adapter.ts` builds the spec with the
   * basic fields and then assigns the rest one by one. Later
   * fields (`auth`, `schemaGraph`) are `readonly` because the
   * `collection-builder` fills them in, not the adapter.
   */
  validationSource?: IValidationSource;
  /**
   * Resolved validation rules for this endpoint.
   *
   * The example `body` comes from here, but so does the field table
   * that goes into the request description: the example shows **one**
   * valid value, and this says which ones are valid. An `age: 30`
   * doesn't tell you the max is 120.
   *
   * It is stored apart from `body` because an example cannot be
   * de-exemplified: from the already-built JSON there is no way to
   * recover what was required or what format each field had.
   *
   * It stays as the flat source of truth while the 21 scanners have
   * not been migrated to the graph (a00010 S6 introduces the graph
   * and leaves this list as a fallback); see `schemaGraph`.
  *
  * @deprecated Legacy flat view. Prefer `schemaGraph` as the source
  * of truth and derive body fields with `bodyFieldsFromGraph()` when
  * an exporter still needs the flat representation.
   */
  fields?: ReadonlyArray<IEndpointField>;
  /**
   * Type graph of the endpoint, if the scanner emits it.
   *
   * When present, exporters that know how to consume it (OpenAPI
   * for now) prefer the graph over `fields`: the graph expresses
   * nested objects, arrays of objects, unions (`oneOf`/`anyOf`),
   * cross-references and recursion, which the flat list cannot
   * represent — the OpenAPI exporter used to emit `items: string`
   * when the real items were an object, for example.
   *
   * `root` points to the node that describes the request body.
   * The other nodes are accessible by id from the `nodes` map.
   *
   * It is optional on purpose: the 21 current scanners still emit
   * only `fields`. Migrating each one is a follow-up of a00010 S7
   * (TypeScript AST) and beyond. In the meantime, exporters that
   * do not yet consume the graph can call `flatten-helper` to
   * rebuild the flat list.
   *
   * @see ./schema.interface.ts
   */
  schemaGraph?: ISchemaGraph;
  /**
   * Confidence the scanner has in this endpoint (audit 2026-09-06
   * §16, §17; proposal `r00015`).
   *
   * Optional on purpose: scanners that already produce a precise
   * signal (App Router `export async function GET`, OpenAPI
   * path+verb, Hono `.get/.post/...`, Fastify `fastify.get(...)`)
   * leave it `undefined` and the exporters default to `high` with
   * no reason. Scanners that combine multiple heuristics
   * (Next.js Pages Router `switch (req.method)` multi-verb,
   * fixtures without types) populate it with `level: "low"` and
   * a human-readable reason so the user sees it in Postman /
   * OpenAPI as `x-tanit-confidence: "low" reason: "..."`.
   *
   * The `IEndpointConfidence` shape lives next to the spec so the
   * two are imported together; `lint:contracts` enforces this.
   */
  confidence?: IEndpointConfidence;
  /**
   * Transport discriminator (audit 2026-09-06 §11, proposal `f00013`).
   *
   * Defaults to `"http"` when absent. Scanners for non-HTTP
   * transports (gRPC today, WebSocket/SSE/AsyncAPI later) fill this
   * in. HTTP-only exporters ignore every spec whose `transport` is
   * not `"http"`; future exporters own the rest.
   */
  transport?: TransportKind;
  /**
   * Transport metadata, populated when `transport` is not
   * `"http"`. Loose on purpose: each scanner fills the subset
   * that applies (see `ITransportMeta`).
   */
  transportMeta?: ITransportMeta;
  /**
   * Inferred response entries (audit 2026-09-06 §10, proposal
   * `f00012`).
   *
   * Populated by the response-inference dispatcher
   * (`packages/frameworks/responses/infer-responses.ts`) after
   * the scanner finished; each framework ships its own
   * `IResponseInferrer` that decorates the spec with zero or
   * more `IResponseInference` entries. Empty (or absent) when
   * no inferrer produced signal — the user sees no `response[]`
   * block in Postman and no `responses.<status>.content` in
   * OpenAPI, which matches today's behaviour.
   *
   * Stable ordering: by `(status asc, confidence desc)`. The
   * Postman exporter renders the first entry as the canonical
   * example; OpenAPI emits `responses.<status>.content` for
   * every entry.
   *
   * @see ./responses.interface.ts
   */
  responses?: ReadonlyArray<import("./responses.interface.js").IResponseInference>;
}

/**
 * Confidence the scanner has in an endpoint.
 *
 * Categorical on purpose (`high` | `medium` | `low`). A numeric
 * score already lives on `IProjectMatch`; here we want one
 * categorical value per endpoint with a list of short reasons
 * the user can read in Postman / OpenAPI.
 *
 * - `high`:   the scanner found a precise, unambiguous signal
 *             (App Router `GET` named export, OpenAPI path+verb,
 *             Hono `app.get`, Fastify `fastify.get`, ASP.NET
 *             `[HttpGet]`).
 * - `medium`: the scanner combined two or more signals but none
 *             is unambiguous. Useful, but worth a second look.
 * - `low`:    the scanner fell back to a wide heuristic — for
 *             example Pages Router emitting five verbs from a
 *             single handler's `switch (req.method)` block. The
 *             `reasons` explain what happened.
 */
export interface IEndpointConfidence {
  readonly level: "high" | "medium" | "low";
  /**
   * Short human-readable reasons, in stable order.
   *
   * One entry per independent signal that contributed to the
   * confidence value. The Postman exporter renders them as
   * bullet points in the request description; OpenAPI emits them
   * as `x-tanit-confidence-reasons: [...]`.
   */
  readonly reasons: ReadonlyArray<string>;
}

/**
 * Re-export the transport types so callers that already import from
 * `./postman.interface.js` get them transitively. Keeps the
 * public surface stable when a downstream consumer adds a new
 * transport later (no need to touch every importer).
 */
export type { TransportKind, ITransportMeta } from "./transport.interface.js";



/**
 * Per-operation override of the collection's auth scheme.
 *
 * It is a discriminated union: the `kind` tags the case. Only `none`
 * is accepted today —the `Authorization` header is not injected—,
 * but the shape is sized to add `scheme: "bearer"|"apiKey"|...`
 * without changing the call site (a00012 S3.b).
 */
export type IEndpointAuth =
  | { readonly kind: "none" }
  | { readonly kind: "scheme"; readonly scheme: "bearer" | "apiKey" | "oauth2" };

/** A validation rule, as documented in the collection. */
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

/** Route discovered in routes/*.php. */
export interface DiscoveredRoute {
  method: string;
  uri: string;
}

/**
 * Postman v2.1.0 environment.
 * https://learning.postman.com/docs/sending-requests/managing-environments/
 */
export interface PostmanEnvironment {
  id: string;
  name: string;
  values: Array<{
    key: string;
    value: string;
    enabled: boolean;
    type?: "default" | "secret";
    description?: string;
  }>;
  _postman_id?: string;
  scope?: "environment";
  /** Color en formato #RRGGBB para distinguir visualmente en Postman. */
  color?: string;
}