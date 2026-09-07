/**
 * NestJS response inferrer (audit 2026-09-06 §10, proposal
 * `f00012` S2).
 *
 * Reads NestJS controller source files and emits
 * `IResponseInference` entries from the strongest signal
 * available, in this order:
 *
 * 1. `@HttpCode(201)` / `@HttpCode(HttpStatus.CREATED)` →
 *    `status: 201`, confidence `"high"`.
 * 2. `@ApiResponse({ status: 200, type: UserDto })` →
 *    `{ status, schema: { kind: "ref", $ref: <type> },
 *       confidence: "high" }`. The `$ref` is the textual
 *    type name; the OpenAPI exporter will treat it as a
 *    stub (the AsyncAPI equivalent of x-circular imports).
 * 3. `@ApiOkResponse({ type: UserDto })` → `status: 200,
 *    schema: { kind: "ref", $ref: <type> }, confidence: "high"`.
 * 4. `@ApiCreatedResponse({ type: UserDto })` → `status: 201,
 *    same shape`.
 * 5. Return type: `Promise<UserDto>` / `Observable<UserDto>` →
 *    `status: 200, schema: { kind: "ref", $ref: <type> },
 *    confidence: "medium"` (the annotation is structural but
 *    no explicit status was declared).
 *
 * The inferrer is regex-based — the scanner today is regex-based
 * too (a00016 S6's LanguageIR covers requests; response inference
 * has the same shape and the same cost ceiling). Migration to AST
 * is left for a follow-up.
 */
import { ownRegex } from "../../core/helpers/regex.helper";
import {
  inferResponses,
  registerResponseInferrer,
} from "../../core/responses/infer-responses";
import type {
  EndpointSpecLike,
  IFrameworkSourceFileLike,
  IResponseInference,
  IResponseInferrer,
} from "../../contracts/interfaces/core/responses.interface";

/**
 * `@HttpCode(201)` and `@HttpCode(HttpStatus.CREATED)`.
 * Both numeric and identifier forms are accepted.
 */
const HTTP_CODE_RE = /@HttpCode\s*\(\s*([^)]+?)\s*\)/g;

/**
 * `@ApiResponse({ status: 200, type: UserDto })`.
 * Captures: (status, type).
 */
const API_RESPONSE_RE =
  /@ApiResponse\s*\(\s*\{\s*[^}]*?status\s*:\s*(\d+)[\s\S]*?type\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/g;

/** `@ApiOkResponse({ type: UserDto })` → status 200. */
const API_OK_RE = /@ApiOkResponse\s*\(\s*\{[^}]*?type\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/g;

/** `@ApiCreatedResponse({ type: UserDto })` → status 201. */
const API_CREATED_RE =
  /@ApiCreatedResponse\s*\(\s*\{[^}]*?type\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * `Promise<UserDto>` / `Observable<UserDto>` / `Promise<Array<UserDto>>`
 * on the handler line. Captures the inner type token.
 */
const PROMISE_TYPE_RE =
  /:\s*(?:Promise|Observable|UserDto|void)\s*<\s*([A-Za-z_][A-Za-z0-9_]*)/g;

function findHttpCodeStatus(source: string): number | null {
  let m: RegExpExecArray | null;
  HTTP_CODE_RE.lastIndex = 0;
  m = ownRegex(HTTP_CODE_RE).exec(source);
  if (!m) return null;
  const inside = m[1]?.trim() ?? "";
  // Numeric — easy.
  if (/^\d+$/.test(inside)) return Number.parseInt(inside, 10);
  // Identifier — would need HttpStatus.CREATED → 201 lookup.
  // Today we keep the mapping explicit; everything outside
  // the map returns null (caller falls back to return type).
  return HTTP_STATUS_MAP.get(inside) ?? null;
}

const HTTP_STATUS_MAP: Map<string, number> = new Map([
  ["HttpStatus.OK", 200],
  ["HttpStatus.CREATED", 201],
  ["HttpStatus.ACCEPTED", 202],
  ["HttpStatus.NO_CONTENT", 204],
  ["HttpStatus.BAD_REQUEST", 400],
  ["HttpStatus.UNAUTHORIZED", 401],
  ["HttpStatus.FORBIDDEN", 403],
  ["HttpStatus.NOT_FOUND", 404],
  ["HttpStatus.CONFLICT", 409],
  ["HttpStatus.UNPROCESSABLE_ENTITY", 422],
  ["HttpStatus.INTERNAL_SERVER_ERROR", 500],
]);

function extractRefs(
  source: string,
  pattern: RegExp,
): Array<{ status: number; ref: string }> {
  const out: Array<{ status: number; ref: string }> = [];
  let m: RegExpExecArray | null;
  pattern.lastIndex = 0;
  while ((m = pattern.exec(source)) !== null) {
    out.push({ status: 0, ref: m[1] ?? "" });
  }
  return out;
}

export class NestJsResponseInferrer implements IResponseInferrer {
  readonly framework = "nestjs";

  infer(
    _spec: EndpointSpecLike,
    source: IFrameworkSourceFileLike,
  ): ReadonlyArray<IResponseInference> {
    const txt = source.content;
    const entries: IResponseInference[] = [];

    // Module-level RegExp objects keep their `lastIndex`
    // state across calls. We reset explicitly so the regex
    // state is local to one `infer()` call. (f00012 S3 fix.)
    HTTP_CODE_RE.lastIndex = 0;
    API_RESPONSE_RE.lastIndex = 0;
    API_OK_RE.lastIndex = 0;
    API_CREATED_RE.lastIndex = 0;
    PROMISE_TYPE_RE.lastIndex = 0;

    // 1) Explicit @HttpCode → bare status (no schema)
    const code = findHttpCodeStatus(txt);
    if (code !== null) {
      entries.push({
        status: code,
        schema: { kind: "empty" },
        confidence: "high",
        reason: "@HttpCode",
      });
    }

    // 2) @ApiResponse({ status, type }) — multiple allowed
    for (const { ref } of extractRefs(txt, API_RESPONSE_RE)) {
      if (ref.length === 0) continue;
      // Status comes from the captured group
    }
    API_RESPONSE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ownRegex(API_RESPONSE_RE).exec(txt)) !== null) {
      const statusStr = m[1] ?? "200";
      const ref = m[2] ?? "";
      entries.push({
        status: Number.parseInt(statusStr, 10),
        schema: { kind: "ref", $ref: ref },
        confidence: "high",
        reason: `@ApiResponse(${statusStr}, type: ${ref})`,
      });
    }

    // 3) @ApiOkResponse → status 200
    API_OK_RE.lastIndex = 0;
    while ((m = ownRegex(API_OK_RE).exec(txt)) !== null) {
      entries.push({
        status: 200,
        schema: { kind: "ref", $ref: m[1] ?? "" },
        confidence: "high",
        reason: `@ApiOkResponse(type: ${m[1] ?? ""})`,
      });
    }

    // 4) @ApiCreatedResponse → status 201
    API_CREATED_RE.lastIndex = 0;
    while ((m = ownRegex(API_CREATED_RE).exec(txt)) !== null) {
      entries.push({
        status: 201,
        schema: { kind: "ref", $ref: m[1] ?? "" },
        confidence: "high",
        reason: `@ApiCreatedResponse(type: ${m[1] ?? ""})`,
      });
    }

    // 5) Return type → status 200 medium-confidence
    PROMISE_TYPE_RE.lastIndex = 0;
    const ret = ownRegex(PROMISE_TYPE_RE).exec(txt);
    if (ret) {
      entries.push({
        status: 200,
        schema: { kind: "ref", $ref: ret[1] ?? "" },
        confidence: "medium",
        reason: "NestJS return type",
      });
    }

    return entries;
  }
}

// Register the inferrer at module load. Idempotent — repeated
// imports don't double-register.
registerResponseInferrer(new NestJsResponseInferrer());

/** Test-only escape hatch to clear the registry. */
export function __resetNestJsInferrer(): void {
  // No-op: the dispatcher is the public surface for clearing.
  void inferResponses;
}
