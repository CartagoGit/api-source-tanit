/**
 * `EndpointMerger`: the endpoint reconciler for hybrid projects.
 *
 * For each identity (method + normalized uri), it receives contributions
 * from N scanners and returns ONE `IMergedEndpoint` with the best piece
 * of each type and complete provenance.
 * The result includes the full provenance trail for every contribution.
 *
 * ## Rules
 *
 * Rules are listed in priority order. Ties document a tie-breaker; when
 * none exists, the candidate that arrived first wins—in the pipeline,
 * the one with the highest `scannerScore` (the orchestrator already sorts
 * by confidence).
 * The orchestrator sorts scanners by confidence before this pass.
 *
 * 1. **Identity**: `method` (uppercased) + `uri` normalized through
 *    `endpointKey` (the same formula as `dedupeSpecs`). This is the only
 *    identity: two candidates with the same identity are candidates to merge.
 *    They are merged into one endpoint during the merge pass.
 * 2. **Body**: the highest-confidence candidate wins. At equal confidence,
 *    OpenAPI > schema-based (Fastify/Hono) > everything else. At equal source
 *    type, the first candidate wins.
 *    The same source type uses arrival order as its final tie-breaker.
 * 3. **Fields**: union by `fieldName`, retaining the most restrictive
 *    (`required: true` > `required: false`, `integer` > `number` > `string`,
 *    a non-empty `format` wins over empty). If both say the same thing, the
 *    first wins (the candidate with the strongest body, or the first in order
 *    if neither provides a body).
 * 4. **Auth**: the highest-confidence candidate wins. If both are explicit
 *    and disagree (one says `bearer`, the other `apikey`), add a warning. If
 *    only one is explicit, it wins without a warning.
 * 5. **Description**: the longest wins (in chars). Ties go to the first.
 * 6. **Global confidence**: weighted mean
 *    (`route 0.4 / body 0.3 / auth 0.2 / description 0.1`), redistributing
 *    weights among the pieces that are present.
 *
 * ## Framework confidence
 *
 * `FRAMEWORK_CONFIDENCE` is the only place where framework → confidence
 * is mapped. It is intentionally internal: any other mapping (for example,
 * by source type) would be a service detail. If it ever needs expansion,
 * the change belongs here and the tests catch it.
 *
 * ## What it does NOT do
 *
 * - It does not normalize URIs beyond `endpointKey`—the pipeline already does
 *   that. This service CONSUMES that key.
 * - It does not invent fields. If nobody provided `body`, `body` remains
 *   `undefined` (the framework-agnostic adapter fills it later).
 *   Missing fields stay missing until a later adapter supplies them.
 * - It does not detect field conflicts at the **value** level: if A says
 *   `minLength: 3` and B says `minLength: 5`, the more restrictive value (5)
 *   wins. This is intentional: frameworks rarely declare contradictory rules
 *   on purpose, and when they do, the strictest rule is what the real API will
 *   reject.
 */
import { normalizeForComparison } from "../helpers/uri.helper.js";
import {
  ENDPOINT_CONFIDENCE_WEIGHTS,
  type Confidence,
  type IEndpointMergeCandidate,
  type IEndpointMerger,
  type IEndpointProvenance,
  type IEndpointProvenanceEntry,
  type IMergeEndpointsOptions,
  type IMergeOutcome,
  type IMergeResult,
  type IMergedEndpoint,
} from "../../contracts/interfaces/core/merge.interface.js";
import type { IDetectedAuthScheme } from "../../contracts/interfaces/core/discovery.interface.js";
import type { IValidationSpec } from "../../contracts/interfaces/core/scanner.interface.js";

/**
 * Confidence by framework. The table is intentionally closed: when a new
 * scanner is added, decide its value here rather than letting the merger
 * guess.
 * The merger never infers a value for an unknown framework.
 *
 * - **0.95** — OpenAPI: authors declare it manually, and it is usually the
 *   most carefully maintained source.
 * - **0.85** — Schemas declared in code (Fastify JSON Schema, Hono zod,
 *   Fiber/Rust structs): the validators are part of the executable binary.
 * - **0.5** — Regex heuristic over source code: common in the remaining
 *   scanners; it works but guarantees nothing.
 */
const FRAMEWORK_CONFIDENCE: Readonly<Record<string, Confidence>> = {
  openapi: 0.95,
  fastify: 0.85,
  hono: 0.85,
  fiber: 0.85,
  rust: 0.85,
};

/** Default confidence when the framework is not in the table. */
const DEFAULT_FRAMEWORK_CONFIDENCE: Confidence = 0.5;

/**
 * Frameworks that multiplex operations through a single endpoint.
 *
 * A pure RPC implementation (GraphQL, tRPC) usually has **one** endpoint—`POST
 * /graphql`, `POST /trpc/<path>`—and the name distinguishes one operation from
 * another. The "which framework does this?" question is answered by **id**
 * here, not by route shape as in the identity package's
 * `needsNameToDisambiguate(routes)` helper (which answers "do these routes
 * collide by uri?").
 *
 * OpenAPI is excluded by default: even when it declares `operationId`, the
 * most common convention is one route per operation (`/users`,
 * `/users/{id}`), not multiplexing through a single POST. If support for
 * `oneOf`/`anyOf` by `operationId` is added in the future, the change belongs
 * here and the tests catch it.
 */
const RPC_MULTIPLEXED_FRAMEWORKS: ReadonlySet<string> = new Set([
  "graphql",
  "trpc",
]);

/**
 * Returns `true` when the framework multiplexes operations by name instead
 * of URI. This was the missing piece for resolving the a00010 ↔ a00011
 * B-rev-3 confusion: two candidates from the same framework with the same
 * `(method, uri)` and different names must end up in separate groups rather
 * than being merged by mistake.
 */
function frameworkMultiplexesByName(framework: string): boolean {
  return RPC_MULTIPLEXED_FRAMEWORKS.has(framework);
}

/**
 * Default `IEndpointMerger` implementation. Stateless: state lives in
 * `merge()` (the candidates), not in the instance. Reusable across concurrent
 * calls.
 */
export class EndpointMerger implements IEndpointMerger {
  private readonly confidence: Readonly<Record<string, Confidence>>;

  constructor(options: IMergeEndpointsOptions = {}) {
    this.confidence = options.frameworkConfidence ?? FRAMEWORK_CONFIDENCE;
  }

  merge(candidates: ReadonlyArray<IEndpointMergeCandidate>): IMergeResult {
    if (candidates.length === 0) {
      throw new Error(
        "EndpointMerger.merge: no se puede fusionar una lista vacía.",
      );
    }

    const sorted = sortCandidates(candidates, this.confidence);

    const method = sorted[0]!.method.toUpperCase();
    const uri = identityUri(sorted);
    const name = pickName(sorted);
    const winningRoute = pickRoute(sorted);

    // x00028 S3: the merger groups candidates by `(serviceId, method,
    // uri)` (see `mergeKey` below). All candidates in one group
    // share the same `serviceId` — otherwise they would not have
    // landed in the same bucket. We take the first one's value as
    // the authoritative one (empty string for flat projects) and
    // stamp it on the merged endpoint so downstream consumers
    // (`filterSpecsForService`, the dedupe, the spec catalog)
    // see the workspace identity the adapter gave each spec.
    const serviceId = sorted[0]!.serviceId ?? "";

    const bodyWinner = pickBody(sorted, this.confidence);
    const {
      fields: fieldsWinner,
      conflicts: fieldConflicts,
    } = pickFields(sorted, bodyWinner?.framework, this.confidence);
    const authWinner = pickAuth(sorted, this.confidence);
    const descriptionWinner = pickDescription(sorted);

    const provenance: IEndpointProvenance = {
      route: {
        framework: winningRoute.framework,
        confidence: confidenceFor(winningRoute.framework, this.confidence),
      },
      ...(bodyWinner
        ? {
            body: {
              framework: bodyWinner.framework,
              confidence: confidenceFor(bodyWinner.framework, this.confidence),
            },
          }
        : {}),
      ...(authWinner
        ? { auth: { framework: authWinner.framework, evidence: authWinner.evidence } }
        : {}),
      ...(descriptionWinner
        ? { description: { framework: descriptionWinner.framework } }
        : {}),
      contributors: sorted.map((c) => c.framework),
    };

    const merged: IMergedEndpoint = {
      method,
      uri,
      ...(serviceId ? { serviceId } : {}),
      ...(name ? { name } : {}),
      ...(bodyWinner?.body !== undefined ? { body: bodyWinner.body } : {}),
      ...(fieldsWinner ? { fields: fieldsWinner } : {}),
      ...(authWinner?.authScheme
        ? { authScheme: authWinner.authScheme }
        : {}),
      ...(descriptionWinner?.description !== undefined
        ? { description: descriptionWinner.description }
        : {}),
      provenance,
      confidence: computeConfidence(provenance, this.confidence),
    };

    return { merged, conflicts: fieldConflicts };
  }
}

/**
 * Punto de entrada de pipeline: recibe la lista plana de candidatos
 * y devuelve los endpoints fusionados + provenance + warnings.
 *
 * Los candidatos ya vienen ordenados por `scannerScore` descendente
 * (es lo que hace `discoverSpecs`); el merger los re-ordena dentro
 * de cada grupo por `frameworkConfidence` y desempata por el orden
 * de llegada, que coincide con el del orquestador.
 */
export function mergeEndpoints(
  candidates: ReadonlyArray<IEndpointMergeCandidate>,
  options: IMergeEndpointsOptions = {},
): IMergeOutcome {
  if (candidates.length === 0) {
    return { specs: [], provenance: [], warnings: [] };
  }

  const merger = new EndpointMerger(options);
  const groups = groupByIdentity(candidates);
  const specs: IMergedEndpoint[] = [];
  const provenance: IEndpointProvenanceEntry[] = [];
  const warnings: string[] = [];

  for (const group of groups.values()) {
    const { merged, conflicts: fieldConflicts } = merger.merge(group);
    specs.push(merged);
    provenance.push({
      method: merged.method,
      uri: merged.uri,
      provenance: merged.provenance,
      confidence: merged.confidence,
    });
    for (const c of fieldConflicts) warnings.push(c);
    const conflict = detectAuthConflict(group);
    if (conflict) warnings.push(conflict);
  }

  return { specs, provenance, warnings };
}

/**
 * Wrapper for consuming candidates from `EndpointSpec[]` (the adapter's
 * output). It preserves each candidate's `framework` from spec metadata: the
 * pipeline marks the spec with `formRequest` or the controller name, but the
 * most reliable source is an explicit `framework` (as `discoverSpecs` does
 * when iterating over the `usable` items).
 * This adapter shape is consumed by the merger pipeline.
 */
export function candidatesFromSpecs(
  scannerScore: ReadonlyMap<string, Confidence>,
): (
  specs: ReadonlyArray<{
    name: string;
    method: string;
    uri: string;
    framework?: string;
    body?: unknown;
    fields?: ReadonlyArray<IValidationSpec>;
    authScheme?: IDetectedAuthScheme;
    description?: string;
  }>,
) => IEndpointMergeCandidate[] {
  return (specs) =>
    specs.map((spec) => {
      const framework = spec.framework ?? "unknown";
      return {
        framework,
        scannerScore: scannerScore.get(framework) ?? 0.5,
        method: spec.method,
        uri: spec.uri,
        ...(spec.name !== undefined && spec.name !== ""
          ? { name: spec.name }
          : {}),
        ...(spec.body !== undefined ? { body: spec.body } : {}),
        ...(spec.fields ? { fields: spec.fields } : {}),
        ...(spec.authScheme ? { authScheme: spec.authScheme } : {}),
        ...(spec.description !== undefined ? { description: spec.description } : {}),
      };
    });
}

/**
 * Inverse of `candidatesFromSpecs`: converts an `IMergedEndpoint` back to
 * `EndpointSpec` so the pipeline continues using the shape consumed by the
 * other services.
 *
 * Copies the fields selected by the merger: identity (method, uri, name) and
 * the winning pieces (body, fields, description, auth).
 * The auth branch is mapped without changing its semantic type.
 *
 * Audit 2026-09-04 P1 #6 + second review #16 #17: the per-operation auth
 * scheme override must survive the merger. `spec.auth` maps to the candidate's
 * `authScheme` in generation.pipeline.ts, and the merger carries the winner
 * back here. The reverse conversion covers **all** branches of the
 * `IEndpointAuth` union:
 *
 *   - `type: "none"` → `auth: { kind: "none" }` (public override).
 *   - `type: "bearer"` → `auth: { kind: "scheme", scheme: "bearer" }`.
 *   - `type: "apikey"` → `auth: { kind: "scheme", scheme: "apiKey" }`.
 *   - `type: "oauth2"` → `auth: { kind: "scheme", scheme: "oauth2" }`.
 *
 * Previously only the `none` branch was translated. A per-op
 * `bearer`/`apiKey`/`oauth2` override was discarded, and `detectAuthScheme`
 * recalculated auth at collection level—losing the override.
 */
export function endpointSpecFromMerged(m: IMergedEndpoint): {
  name: string;
  method: import("../../contracts/interfaces/core/postman.interface.js").EndpointSpec["method"];
  uri: string;
  /**
   * x00028 S3: the merged endpoint carries the workspace identity
   * (or empty string for flat projects) so downstream consumers
   * (`filterSpecsForService`, the dedupe key in
   * `endpoint-merger.service > mergeKey`) can route each spec to
   * the right service descriptor. Without this, the merger would
   * strip the stamp the adapter put on each spec and the filter
   * helper would see `serviceId === undefined` for every spec,
   * falling back to the legacy full-catalog behaviour — which is
   * exactly what x00028 set out to fix.
   */
  serviceId?: string;
  body?: unknown;
  fields?: ReadonlyArray<
    IValidationSpec | import("../../contracts/interfaces/core/postman.interface.js").IEndpointField
  >;
  description?: string;
  /** Per-op override derived from the merger. Present only when applicable. */
  auth?: import("../../contracts/interfaces/core/postman.interface.js").IEndpointAuth;
} {
  return {
    name: m.name ?? "",
    method: m.method as import("../../contracts/interfaces/core/postman.interface.js").EndpointSpec["method"],
    uri: m.uri,
    ...(m.serviceId !== undefined ? { serviceId: m.serviceId } : {}),
    ...(m.body !== undefined ? { body: m.body } : {}),
    ...(m.fields !== undefined ? { fields: m.fields } : {}),
    ...(m.description !== undefined ? { description: m.description } : {}),
    ...(m.authScheme ? { auth: authFromAuthScheme(m.authScheme) } : {}),
  };
}

/**
 * Converts `IDetectedAuthScheme` (known to the merger) to the `IEndpointAuth`
 * union (consumed by the builder and exporter). This is the semantic inverse of
 * `authSchemeFromEndpointAuth` in generation.pipeline.ts; both must stay in
 * sync.
 */
function authFromAuthScheme(
  scheme: NonNullable<import("../../contracts/interfaces/core/discovery.interface.js").IDetectedAuthScheme>,
): import("../../contracts/interfaces/core/postman.interface.js").IEndpointAuth {
  switch (scheme.type) {
    case "none":
      return { kind: "none" };
    case "bearer":
      return { kind: "scheme", scheme: "bearer" };
    case "apikey":
      return { kind: "scheme", scheme: "apiKey" };
    case "oauth2":
      return { kind: "scheme", scheme: "oauth2" };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────

/**
 * Sorts candidates within a group by `frameworkConfidence` (highest wins),
 * then `scannerScore`, then arrival order. Arrival order is the final
 * tie-breaker—the pipeline already delivers them ordered by `scannerScore`.
 * The first two criteria are framework confidence and scanner score.
 *
 * `confidence` is the table injected by the caller (constructor or
 * `mergeEndpoints`). Previously this read the global
 * `FRAMEWORK_CONFIDENCE` constant, so a test supplying its own table did not
 * see the ordering effect (closed in a00011 B-rev-15).
 * The injected table keeps custom confidence values testable.
 */
function sortCandidates(
  candidates: ReadonlyArray<IEndpointMergeCandidate>,
  confidence: Readonly<Record<string, Confidence>>,
): IEndpointMergeCandidate[] {
  return [...candidates].sort((a, b) => {
    const confDiff =
      confidenceFor(b.framework, confidence) -
      confidenceFor(a.framework, confidence);
    if (confDiff !== 0) return confDiff;
    const scoreDiff = b.scannerScore - a.scannerScore;
    if (scoreDiff !== 0) return scoreDiff;
    return 0;
  });
}

/** Normalized URI for the merged endpoint (the winner's URI). */
function identityUri(
  sorted: ReadonlyArray<IEndpointMergeCandidate>,
): string {
  return sorted[0]!.uri;
}

/**
 * Merged endpoint name: the winner's name. It is identity, not a piece to
 * merge—GraphQL and tRPC depend on it to distinguish operations.
 * The name is retained for the merged endpoint.
 */
function pickName(
  sorted: ReadonlyArray<IEndpointMergeCandidate>,
): string | undefined {
  return sorted[0]!.name;
}

/**
 * The route always comes from the first candidate: the route is the identity,
 * so there is nothing to compare. The first candidate has the highest
 * confidence, so provenance wins with it.
 */
function pickRoute(
  sorted: ReadonlyArray<IEndpointMergeCandidate>,
): IEndpointMergeCandidate {
  return sorted[0]!;
}

interface IBodyWinner {
  framework: string;
  body: unknown;
}

/**
 * Selects the highest-confidence body. Only candidates that provided a body
 * (`c.body !== undefined`) count. If nobody provides a body, return `null`.
 * A missing body remains `null` until another stage adds one.
 */
function pickBody(
  sorted: ReadonlyArray<IEndpointMergeCandidate>,
  confidence: Readonly<Record<string, Confidence>>,
): IBodyWinner | null {
  let winner: IBodyWinner | null = null;
  let winnerConfidence = -1;
  for (const c of sorted) {
    if (c.body === undefined) continue;
    const cConfidence = confidenceFor(c.framework, confidence);
    if (cConfidence > winnerConfidence) {
      winner = { framework: c.framework, body: c.body };
      winnerConfidence = cConfidence;
    }
  }
  return winner;
}

interface IFieldSource {
  framework: string;
  fields: ReadonlyArray<IValidationSpec>;
}

/**
 * Merges fields from all candidates by the composite key
 * `${location}:${fieldName}`, retaining the most restrictive version.
 * Location and field name form the stable identity.
 *
 * The composite key prevents the a00011 B-rev-4 collision: `path.id`,
 * `query.id`, `body.id`, and `header.id` are distinct fields even though they
 * share `fieldName`. If a scanner reports the same `fieldName` in a different
 * `location`, they merge separately: each belongs to a different endpoint field.
 * Equal names in different locations therefore remain distinct.
 *
 * The first candidate with a body is the tie-break reference: when two
 * candidates have the same field and equal restrictiveness, the body winner
 * wins because it is the most complete candidate for that endpoint. If nobody
 * provides a body, the first candidate in order wins.
 * Body completeness is the preferred tie-break reference.
 *
 * Returns `{ fields, conflicts }`: field-level conflicts (an empty enum
 * intersection, a type mismatch, or divergent format/pattern) travel to the
 * pipeline as warnings; they are not printed here.
 * Conflicts are returned separately for pipeline warnings.
 */
function pickFields(
  sorted: ReadonlyArray<IEndpointMergeCandidate>,
  bodyWinnerFramework: string | undefined,
  confidence: Readonly<Record<string, Confidence>>,
): { fields: ReadonlyArray<IValidationSpec> | null; conflicts: string[] } {
  const sources: IFieldSource[] = sorted
    .filter((c): c is IEndpointMergeCandidate & { fields: ReadonlyArray<IValidationSpec> } =>
      c.fields !== undefined && c.fields.length > 0,
    )
    .map((c) => ({ framework: c.framework, fields: c.fields }));
  if (sources.length === 0) return { fields: null, conflicts: [] };

  sources.sort((a, b) => {
    if (bodyWinnerFramework) {
      if (a.framework === bodyWinnerFramework) return -1;
      if (b.framework === bodyWinnerFramework) return 1;
    }
    return 0;
  });

  const byKey = new Map<string, { field: IValidationSpec; firstFramework: string }>();
  const ordered: string[] = [];
  const conflicts: string[] = [];

  for (const src of sources) {
    for (const field of src.fields) {
      const compositeKey = `${field.location}:${field.fieldName}`;
      const existing = byKey.get(compositeKey);
      if (!existing) {
        byKey.set(compositeKey, { field, firstFramework: src.framework });
        ordered.push(compositeKey);
        continue;
      }
      const result = mergeFieldSpecs(existing.field, field, {
        a: confidenceFor(existing.firstFramework, confidence),
        b: confidenceFor(src.framework, confidence),
      });
      byKey.set(compositeKey, { field: result.field, firstFramework: existing.firstFramework });
      if (result.conflict) {
        conflicts.push(
          `${compositeKey}: ${result.conflict} (entre ${existing.firstFramework} y ${src.framework})`,
        );
      }
    }
  }
  return {
    fields: ordered
      .map((k) => byKey.get(k)?.field)
      .filter((f): f is IValidationSpec => f !== undefined),
    conflicts,
  };
}

interface IAuthWinner {
  framework: string;
  authScheme: IDetectedAuthScheme | undefined;
  evidence: string;
}

/**
 * Recognizes whether an `authScheme` comes from an explicit per-operation
 * override (generated by `authSchemeFromEndpointAuth` in
 * generation.pipeline.ts) or from the framework's global auth.
 *
 * Audit second review #18: an EXPLICIT per-operation override must take
 * semantic precedence over the schema's global auth, regardless of `type` or
 * framework confidence. If the user or scanner said "this endpoint IS public /
 * uses apiKey / uses oauth2", the schema's inherited auth must not override it.
 * The contract does not expose a `scope` field so the stable
 * `IDetectedAuthScheme` shape remains intact. Instead, it uses evidence as a
 * heuristic generated only by the helper that performs the pipeline → merger
 * translation, so it is reliable.
 */
function isExplicitOverride(scheme: IDetectedAuthScheme | undefined): boolean {
  if (!scheme) return false;
  return scheme.evidence.includes("per-op override");
}

/**
 * Selects the highest-confidence auth. If two candidates disagree in `type`
 * (bearer vs apikey), return the winner and let the caller
 * add a warning. We do not want the merger to lose the loser's
 * context, nor couple it to warning logic here. The caller owns
 * that side effect.
 *
 * Audit 2026-09-04 P1 #6 + second review #18: an EXPLICIT per-operation
 * override always wins over the schema's global auth, regardless of `type`.
 * If a scanner declares "this endpoint is public" (common
 * for `/auth/login` and `/health`) or "this endpoint uses apiKey"
 * (common for `/internal/stats` with X-API-Key), the schema's
 * global auth (bearer) must not override it. Without this rule,
 * the token-issuing endpoint requests the token, and the first
 * request returns 401.
 *
 * The rule is implemented in two passes:
 *   1. Any explicit override wins.
 *   2. If no overrides exist, the highest framework confidence wins.
 *
 * If multiple overrides exist (several scanners declared different
 * auth for the same endpoint), the first one in arrival order wins,
 * consistent with the rest of the merger.
 */
function pickAuth(
  sorted: ReadonlyArray<IEndpointMergeCandidate>,
  confidence: Readonly<Record<string, Confidence>>,
): IAuthWinner | null {
  // First pass: any EXPLICIT per-operation override wins over inherited
  // schema auth.
  for (const c of sorted) {
    const scheme = c.authScheme;
    if (scheme && isExplicitOverride(scheme)) {
      return {
        framework: c.framework,
        authScheme: scheme,
        evidence: scheme.evidence,
      };
    }
  }
  // Second pass: select the highest framework confidence.
  let winner: IAuthWinner | null = null;
  let winnerConfidence = -1;
  for (const c of sorted) {
    if (c.authScheme === undefined) continue;
    const cConfidence = confidenceFor(c.framework, confidence);
    if (cConfidence > winnerConfidence) {
      winner = {
        framework: c.framework,
        authScheme: c.authScheme,
        evidence: c.authScheme.evidence,
      };
      winnerConfidence = cConfidence;
    }
  }
  return winner;
}

interface IDescriptionWinner {
  framework: string;
  description: string;
}

/** The longest description wins (in chars). Ties go to the first. */
function pickDescription(
  sorted: ReadonlyArray<IEndpointMergeCandidate>,
): IDescriptionWinner | null {
  let winner: IDescriptionWinner | null = null;
  for (const c of sorted) {
    if (c.description === undefined) continue;
    if (!winner || c.description.length > winner.description.length) {
      winner = { framework: c.framework, description: c.description };
    }
  }
  return winner;
}

/**
 * Returns a warning when two candidates have different
 * `authScheme` values and both are explicit (non-empty evidence).
 * An `evidence: ""` value is considered implicit and ignored
 * in the conflict.
 */
function detectAuthConflict(
  group: ReadonlyArray<IEndpointMergeCandidate>,
): string | null {
  const explicit = group.filter(
    (c) => c.authScheme !== undefined && c.authScheme.evidence.length > 0,
  );
  if (explicit.length < 2) return null;
  const types = new Set(explicit.map((c) => c.authScheme!.type));
  if (types.size < 2) return null;
  return (
    `Conflicto de auth en ${explicit[0]!.authScheme!.type}/${[...types].join(",")}: ` +
    `los frameworks ${explicit.map((c) => c.framework).join(", ")} declaran ` +
    `esquemas distintos (${[...types].join(" vs ")}). Gana el de mayor confianza.`
  );
}

/**
 * Merger grouping key.
 *
 * It does not use the helper's `endpointKey()`: the question is which
 * candidates represent **the same endpoint**? The answer depends on
 * **the framework**:
 *
 * - **REST** (Express, OpenAPI, Fastify, etc.): `(method, uri)`. The name,
 *   if present, is decoration: two POST `/users` endpoints with different names
 *   are the same merged endpoint, and `pickName` decides which name wins.
 * - **Multiplexed RPC** (GraphQL, tRPC): `(method, uri, name)`. Here,
 *   `POST /graphql` with `name: "OpA"` and `name: "OpB"` are **two different
 *   endpoints**; merging them would lose an entire operation without warning
 *   (closed in a00011 B-rev-3).
 *
 * If the candidate is RPC and has no `name`, include it anyway: its key lands
 * in a separate group and is reported upstream. Do not reject it because that
 * would discard the entire operation; an empty-endpoint warning is preferable
 * to a ghost endpoint.
 */
function mergeKey(c: IEndpointMergeCandidate): string {
  const method = c.method.toUpperCase();
  const uri = normalizeForComparison(c.uri);
  // Audit second review #3: in multi-workspace monorepos, two endpoints with
  // the same (method, uri) but different `serviceId` values are NOT the same
  // operation. Include `serviceId` (the empty string for flat projects) in the
  // merge key.
  const serviceId = c.serviceId ?? "";
  if (frameworkMultiplexesByName(c.framework)) {
    return `${serviceId}::${method} ${uri} ${c.name ?? ""}`;
  }
  return `${serviceId}::${method} ${uri}`;
}

/** Groups candidates by contextual identity (REST or RPC). */
function groupByIdentity(
  candidates: ReadonlyArray<IEndpointMergeCandidate>,
): Map<string, IEndpointMergeCandidate[]> {
  const groups = new Map<string, IEndpointMergeCandidate[]>();
  for (const c of candidates) {
    const key = mergeKey(c);
    const existing = groups.get(key);
    if (existing) existing.push(c);
    else groups.set(key, [c]);
  }
  return groups;
}

/** Framework confidence with fallback. */
function confidenceFor(
  framework: string,
  table: Readonly<Record<string, Confidence>>,
): Confidence {
  return table[framework] ?? DEFAULT_FRAMEWORK_CONFIDENCE;
}

/**
 * Compares two `IValidationSpec` values for the **same** field (the caller
 * already grouped them by the composite key `${location}:${fieldName}`) and
 * returns the most restrictive result, along with a possible `conflict` when
 * the information is insufficient and the user must be warned.
 *
 * Rules, in order:
 *
 *   1. **`required`**: if A says `true`, `true` wins. There is no
 *      conflict: a scanner that requires the field always wins over one
 *      that leaves it optional.
 *   2. **`type`**: if they match, keep the matching type. If they **differ**
 *      (disjoint domains—`string` vs `object`—), the old
 *      "integer > number > string" heuristic is not restrictiveness;
 *      the types are not compatible, so the domains are not interchangeable.
 *      - If one confidence is strictly higher, it wins and there is no
 *        conflict (the more reliable source speaks more strongly).
 *      - If confidence is equal, do not invent: A wins. It is the
 *        first caller-order candidate, belonging to the body winner,
 *        and we emit `conflict: "type mismatch"`.
 *   3. **`format`**: if both exist and differ, warn and keep A. If only one
 *      exists, keep it without warning.
 *   4. **`minimum` / `maximum`**: highest floor / lowest ceiling.
 *   5. **`minLength` / `maxLength`**: highest floor / lowest ceiling.
 *   6. **`pattern`**: if both exist and differ, warn and keep A. If only one
 *      exists, keep it without warning.
 *   7. **`enumValues`**: intersection. If the result is empty, **warn** (no
 *      value satisfies both; determine which scanner is more reliable) and
 *      retain the enum from the side with higher
 *      `confidence`/provenance—publishing `[]` would discard the entire domain.
 *   8. **`description`**: the longest wins.
 *   9. **`example`**: the first wins (the body winner's).
 *
 * `location` and `fieldName` **must** match—the caller already grouped by the
 * composite key. Otherwise it is a caller bug, so throw to make the bug visible
 * rather than silently ignore it.
 *
 * The `confidence` parameter is injected from `pickFields`, which already has
 * the merger table. This prevents the pure `mergeFieldSpecs` function from
 * importing the global table, which broke a00011 B-rev-5 (the previous
 * implementation read the constant).
 */
function mergeFieldSpecs(
  a: IValidationSpec,
  b: IValidationSpec,
  confidence: { readonly a: number; readonly b: number },
): { readonly field: IValidationSpec; readonly conflict?: string } {
  if (a.fieldName !== b.fieldName || a.location !== b.location) {
    throw new Error(
      `mergeFieldSpecs: location:fieldName mismatch (${a.location}:${a.fieldName} vs ${b.location}:${b.fieldName}); el caller debe agrupar por la clave compuesta.`,
    );
  }

  // required: true wins over false.
  const required = a.required || b.required;

  // type: exact match, dominant domain by confidence, or "do not invent +
  // warning" when neither has a clear advantage.
  let type: IValidationSpec["type"] = a.type;
  let typeConflict: string | undefined;
  if (a.type !== b.type) {
    if (confidence.a > confidence.b) {
      type = a.type;
    } else if (confidence.b > confidence.a) {
      type = b.type;
    } else {
      type = a.type;
      typeConflict = `type mismatch: ${a.type} vs ${b.type}`;
    }
  }

  // format: the existing value wins; warn when both exist and differ.
  let format: string | undefined;
  let formatConflict: string | undefined;
  if (a.format !== undefined && b.format !== undefined) {
    format = a.format;
    if (a.format !== b.format) formatConflict = `format mismatch: ${a.format} vs ${b.format}`;
  } else {
    format = a.format ?? b.format;
  }

  // minimum: max of the minima. maximum: min of the maxima.
  const minimum = mergeBound(a.minimum, b.minimum, Math.max);
  const maximum = mergeBound(a.maximum, b.maximum, Math.min);
  // minLength: max. maxLength: min.
  const minLength = mergeBound(a.minLength, b.minLength, Math.max);
  const maxLength = mergeBound(a.maxLength, b.maxLength, Math.min);

  // pattern: the existing value wins; warn when both exist and differ.
  let pattern: string | undefined;
  let patternConflict: string | undefined;
  if (a.pattern !== undefined && b.pattern !== undefined) {
    pattern = a.pattern;
    if (a.pattern !== b.pattern)
      patternConflict = `pattern mismatch: ${a.pattern} vs ${b.pattern}`;
  } else {
    pattern = a.pattern ?? b.pattern;
  }

  // enumValues: intersection; warn when the result is empty.
  let enumValues: ReadonlyArray<string> | undefined;
  let enumConflict: string | undefined;
  if (a.enumValues !== undefined && b.enumValues !== undefined) {
    const intersection = a.enumValues.filter((v) =>
      b.enumValues!.includes(v),
    );
    if (intersection.length === 0) {
      // Empty intersection means both scanners describe disjoint domains; no
      // request could satisfy both if `[]` were published. Discarding the
      // entire enum (or publishing an empty one) is worse than trusting the
      // more reliable source: retain the higher-confidence side and report
      // both domains so the operator can decide (a00011 B-rev-5 contract).
      enumValues = confidence.b > confidence.a ? b.enumValues : a.enumValues;
      enumConflict = `enum intersection empty: [${a.enumValues.join(",")}] vs [${b.enumValues.join(",")}] — se conserva el enum de mayor confianza`;
    } else {
      enumValues = intersection;
    }
  } else {
    enumValues = a.enumValues ?? b.enumValues;
  }

  // description: the longest wins (in chars).
  let description: string | undefined;
  if (a.description !== undefined && b.description !== undefined) {
    description = a.description.length >= b.description.length ? a.description : b.description;
  } else {
    description = a.description ?? b.description;
  }

  // example: the first one (the body winner's, in `pickFields` order).
  const example = a.example !== undefined ? a.example : b.example;

  const conflicts: string[] = [];
  if (typeConflict) conflicts.push(typeConflict);
  if (formatConflict) conflicts.push(formatConflict);
  if (patternConflict) conflicts.push(patternConflict);
  if (enumConflict) conflicts.push(enumConflict);

  const field: IValidationSpec = {
    fieldName: a.fieldName,
    location: a.location,
    type,
    required,
    ...(format !== undefined ? { format } : {}),
    ...(minimum !== undefined ? { minimum } : {}),
    ...(maximum !== undefined ? { maximum } : {}),
    ...(minLength !== undefined ? { minLength } : {}),
    ...(maxLength !== undefined ? { maxLength } : {}),
    ...(pattern !== undefined ? { pattern } : {}),
    ...(enumValues !== undefined ? { enumValues } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(example !== undefined ? { example } : {}),
  };

  if (conflicts.length === 0) return { field };
  return { field, conflict: conflicts.join("; ") };
}

/**
 * Combines two bounds (minima or maxima) using the corresponding comparator
 * (`Math.max` for `minimum`/`minLength`, `Math.min` for
 * `maximum`/`maxLength`).
 *
 * Returns `undefined` when both sides are `undefined`. If only one exists,
 * it wins. If both exist, apply the comparator.
 */
function mergeBound(
  a: number | undefined,
  b: number | undefined,
  combine: (x: number, y: number) => number,
): number | undefined {
  if (a !== undefined && b !== undefined) return combine(a, b);
  return a ?? b;
}

/**
 * Weighted mean of the pieces that are present. Redistribute the weights of
 * missing pieces among the present ones so an endpoint with only a route does
 * not receive a 0.4 confidence penalty for lacking a body.
 */
function computeConfidence(
  provenance: IEndpointProvenance,
  confidence: Readonly<Record<string, Confidence>>,
): Confidence {
  const pieces: Array<{ weight: number; value: number }> = [];
  const routeConf = confidenceFor(provenance.route.framework, confidence);
  pieces.push({ weight: ENDPOINT_CONFIDENCE_WEIGHTS.route, value: routeConf });
  if (provenance.body) {
    const bodyConf = confidenceFor(provenance.body.framework, confidence);
    pieces.push({
      weight: ENDPOINT_CONFIDENCE_WEIGHTS.body,
      value: bodyConf,
    });
  }
  if (provenance.auth) {
    // With no numeric confidence for auth, use the framework confidence as
    // a proxy: the detector that found auth has its own confidence.
    const authConf = confidenceFor(provenance.auth.framework, confidence);
    pieces.push({ weight: ENDPOINT_CONFIDENCE_WEIGHTS.auth, value: authConf });
  }
  if (provenance.description) {
    const descConf = confidenceFor(provenance.description.framework, confidence);
    pieces.push({
      weight: ENDPOINT_CONFIDENCE_WEIGHTS.description,
      value: descConf,
    });
  }
  const totalWeight = pieces.reduce((acc, p) => acc + p.weight, 0);
  if (totalWeight === 0) return 0;
  const sum = pieces.reduce((acc, p) => acc + (p.weight * p.value), 0);
  return round(sum / totalWeight, 4);
}

function round(n: number, decimals: number): number {
  const m = 10 ** decimals;
  return Math.round(n * m) / m;
}
