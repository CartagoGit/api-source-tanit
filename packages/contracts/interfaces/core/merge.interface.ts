/**
 * Endpoint fusion for hybrid projects.
 *
 * A hybrid project is one where detection finds **two or more**
 * frameworks at once —a repo with legacy Express alongside a new
 * OpenAPI, a PHP monolith with FastAPI documentation next to it—.
 * Each scanner contributes a piece: one has the route, another the
 * body, another the auth, another the description. Before, the
 * pipeline's `dedupeSpecs` kept the first one and discarded the
 * rest, so the collection ended up with only the winning scanner's
 * information and silently lost everything else.
 *
 * This contract introduces **explicit fusion**: given N candidates
 * for the same endpoint (identity = method + normalised uri), the
 * merger picks piece by piece which one to keep and leaves a trace
 * of who contributed what (`provenance`).
 *
 * It does not replace the legacy `dedupeSpecs`: that is still the
 * first cut for identities that do NOT collide (the common case).
 * The merger kicks in when two scanners DO declare the same
 * operation and reconciliation is needed.
 */
import type { IDetectedAuthScheme } from "./discovery.interface.js";
import type { IValidationSpec } from "./scanner.interface.js";
import type { IEndpointField } from "./postman.interface.js";

/**
 * Per-piece confidence — a number between 0 and 1.
 *
 * It comes from the scanner (not the merger): the merger is
 * agnostic, it only compares. The implicit table is kept by the
 * concrete service that knows the frameworks (`EndpointMerger`);
 * other consumers can pass their own `confidenceFor` to keep it
 * portable.
 */
export type Confidence = number;

/**
 * Which scanner produced each piece of a fused endpoint.
 *
 * `route` is required because the endpoint has to exist for some
 * reason. The rest are optional: if scanner A only contributes the
 * route and no body, `body` stays `undefined` and the merger has
 * nothing to compare (which means the body winner is decided by
 * the other piece of the puzzle, not by the absence).
 *
 * `evidence` is the raw text that motivated the detection
 * (`detectAuthScheme` exposes it; scanners fill it in). It goes
 * into the CLI warning: an automatic detection that cannot be
 * cross-checked is one you have to take on faith.
 */
export interface IEndpointProvenance {
  /** Who discovered the route (method + uri). */
  readonly route: { framework: string; confidence: Confidence };
  /** Who contributed the body / validation. */
  readonly body?: { framework: string; confidence: Confidence };
  /** Who contributed the auth. */
  readonly auth?: { framework: string; evidence: string };
  /** Who contributed the description. */
  readonly description?: { framework: string };
  /**
   * Frameworks that declared this endpoint but **lost** the
   * piece-by-piece comparison. Useful for the UI: "OpenAPI said
   * this, Fastify confirmed it, but Fastify won because its schema
   * was more detailed". Empty in the single-candidate case.
   */
  readonly contributors: ReadonlyArray<string>;
}

/**
 * A fused endpoint, with its per-piece provenance.
 *
 * The merger operates on a group of candidates and returns ONE of
 * these. The piece that survives (body, auth, description) is the
 * one that won the comparison; the others stay only in
 * `provenance` so the trace is not lost.
 *
 * `fields` is the restrictive union of every candidate's fields:
 * if A says `required: true` and B says `required: false`, `true`
 * wins. If A says `integer` and B says `string`, `integer` wins
 * (because `integer` rejects strings, not the other way around).
 *
 * `name` is preserved from the winning candidate — it is part of
 * the identity (GraphQL/tRPC), not a piece to fuse.
 *
 * `confidence` is the weighted average of the pieces, with the
 * weights `route 0.4 / body 0.3 / auth 0.2 / description 0.1`.
 * When a piece is missing, its weight is redistributed
 * proportionally among the present ones — a route-only endpoint
 * shouldn't end up with 0.6 confidence just because it has no
 * body.
 */
export interface IMergedEndpoint {
  readonly method: string;
  readonly uri: string;
  /** Endpoint name (preserved from the winner). */
  readonly name?: string;
  /** The highest-confidence piece when there are several. */
  readonly body?: unknown;
  /** Fields declared by some scanner. */
  readonly fields?: ReadonlyArray<IValidationSpec | IEndpointField>;
  /** The highest-confidence auth. */
  readonly authScheme?: IDetectedAuthScheme;
  /** The longest description. */
  readonly description?: string;
  /** Explicit per-piece provenance. */
  readonly provenance: IEndpointProvenance;
  /** Endpoint's overall confidence (0–1). */
  readonly confidence: Confidence;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers so that `IMergedEndpoint.fields` accepts both the
// agnostic `IValidationSpec` from scanners and the `IEndpointField`
// values already carried in `EndpointSpec.fields` after the adapter.
// ─────────────────────────────────────────────────────────────────────

/**
 * What the merger expects in `fields` per candidate: the union of
 * the two existing shapes. The adapter (`parsed-route-to-spec.adapter.ts`)
 * converts `IValidationSpec → IEndpointField` when producing the
 * spec; the merger accepts both so the pipeline doesn't have to
 * remember which side of the boundary it is on. They are
 * structurally compatible on `fieldName`, `location`, `type`,
 * `required`, `format`, `enumValues`, `minimum`, `maximum`,
 * `minLength`, `maxLength`.
 */

/**
 * An endpoint candidate: ONE scanner's contribution for ONE identity
 * (method + uri).
 *
 * The merger groups by identity and compares the candidates in each
 * group. The optional fields are the ones not every scanner
 * contributes: a regex-based one only has the route; OpenAPI has
 * the body and the auth; Fastify has the schema.
 *
 * `method`, `uri`, and `name` are the candidate's **identity**, not
 * pieces to fuse: two candidates with the same identity are
 * candidates to fuse. The merger requires them to produce an
 * `IMergedEndpoint` with a stable identity. `name` distinguishes
 * the GraphQL/tRPC case where there is **one** endpoint
 * (`POST /graphql`) and what differentiates one operation from
 * another is the name.
 */
export interface IEndpointMergeCandidate {
  readonly framework: string;
  /** Detector score (0-1). Used as tiebreaker. */
  readonly scannerScore: Confidence;
  /** HTTP method (uppercased on output). */
  readonly method: string;
  /** Postman-normalised URI (`{{param}}`). */
  readonly uri: string;
  /** Endpoint name (key for GraphQL/tRPC). */
  readonly name?: string;
  readonly body?: unknown;
  readonly fields?: ReadonlyArray<IValidationSpec | IEndpointField>;
  readonly authScheme?: IDetectedAuthScheme;
  readonly description?: string;
  /**
   * Identity of the workspace / service this candidate belongs to.
   *
   * Audit 2nd review #3: in a monorepo with `apps/users-api` and
   * `apps/payments-api`, two `GET /health` from different
   * workspaces are not the same operation. The merger must include
   * this in its identity key (via `endpointKey`) to NOT fuse them.
   *
   * Empty string = flat project (no workspaces). This is the
   * default and keeps compatibility with non-monorepo callers.
   */
  readonly serviceId?: string;
}

/**
 * The merger: given N detections of the same endpoint, returns one.
 *
 * It is an interface on purpose: the default `EndpointMerger` lives
 * in `packages/core`, but a project might want one that applies
 * different rules (e.g. always prioritising OpenAPI without
 * looking at the rest). Passing it as an abstraction lets the
 * tests inject one without spinning up the real `EndpointMerger`.
 *
 * `merge()` returns an `IMergeResult` that combines the fused
 * endpoint with the **conflicts** the merger resolved (empty enum
 * intersection, incompatible formats, etc.). `IMergedEndpoint`
 * only carries the result; the warnings travel separately because
 * in the pipeline they are aggregated into `IMergeOutcome.warnings`,
 * which also collects the auth conflicts — mixing both into
 * `IMergedEndpoint` would make each endpoint responsible for its
 * own audit, which is the opposite of a pipeline.
 */
export interface IEndpointMerger {
  merge(
    candidates: ReadonlyArray<IEndpointMergeCandidate>,
  ): IMergeResult;
}

/**
 * Output of `IEndpointMerger.merge`: the fused endpoint and the
 * list of conflicts the merger **could not resolve on its own**.
 *
 * Each conflict is a human-readable line suitable for CLI/UI. The
 * caller decides where to put it (pipeline warnings, log, popup).
 * The merger does not print it: that would couple the domain to
 * `console.log`, which already bit the detection helpers.
 */
export interface IMergeResult {
  readonly merged: IMergedEndpoint;
  /**
   * Conflicts resolved with a warning: empty enum intersection,
   * divergent formats/patterns, type mismatch between scanners,
   * etc. Empty on the happy path.
   */
  readonly conflicts: ReadonlyArray<string>;
}

/**
 * Flat provenance entry per endpoint, so that
 * `IGenerationResult.provenance` does not have to nest objects.
 *
 * This is what the UI / `summary` consumes to show "this endpoint
 * came from Express with body from OpenAPI".
 */
export interface IEndpointProvenanceEntry {
  readonly method: string;
  readonly uri: string;
  readonly provenance: IEndpointProvenance;
  readonly confidence: Confidence;
}

/**
 * Weights of the global confidence.
 *
 * The total sums to 1.0. When a piece is missing, its weight is
 * redistributed among the present ones. Constants so the
 * calculation is traceable from the tests.
 */
export const ENDPOINT_CONFIDENCE_WEIGHTS = {
  route: 0.4,
  body: 0.3,
  auth: 0.2,
  description: 0.1,
} as const;

/**
 * What `mergeEndpoints` produces when it groups candidates by
 * identity and fuses them. The pipeline-level result.
 */
export interface IMergeOutcome {
  /** Fused endpoints, in the order their groups appeared. */
  readonly specs: ReadonlyArray<IMergedEndpoint>;
  /** Flat provenance, indexable by `method + uri`. */
  readonly provenance: ReadonlyArray<IEndpointProvenanceEntry>;
  /** Warnings the merger could not resolve on its own. */
  readonly warnings: ReadonlyArray<string>;
}

/** Merger options at the pipeline level. */
export interface IMergeEndpointsOptions {
  /**
   * Per-framework confidence table. Useful for tests and for a
   * consumer that wants its own policy.
   */
  readonly frameworkConfidence?: Readonly<Record<string, Confidence>>;
}
