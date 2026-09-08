/**
 * `json-rpc-protocol.ts` — the wire shape shared by every bridge.
 *
 * Both `stdio-bridge.server.ts` and `http-bridge.server.ts` speak the
 * same language over their respective carriers:
 *
 *   - `stdio`: newline-delimited JSON-RPC 2.0 over stdin / stdout.
 *   - `http`:  JSON-RPC 2.0 payloads inside the body of `POST /api`.
 *
 * Keeping the protocol here, in one file, means the bridges have
 * **zero duplicated parsing logic**: each one delegates to the
 * helpers below to build requests and responses, and the dispatcher
 * in `application-api/dispatcher.ts` is unaware of which carrier
 * reached it.
 *
 * ## Why JSON-RPC 2.0
 *
 * - **Id-keyed responses** let the stdio carrier multiplex many
 *   concurrent requests over a single line stream (the request id
 *   tells the client which response belongs to which call).
 * - **`$/cancelRequest` is a standard method** that maps cleanly onto
 *   the `IAbortSignalLike` the Application API already uses.
 * - **Notifications** (no `id`) let the server push events — the
 *   watch handler (`watch.handlers.ts`) will eventually emit
 *   `snapshot-ready` / `snapshot-stale` notifications back over the
 *   same carrier, with no protocol bump.
 *
 * ## Why newline-delimited (stdIO)
 *
 * The Tauri sidecar speaks line-buffered stdin/stdout: each line is
 * one JSON object. Reading a frame is `bufio.Scanner` over a
 * `Readable`; writing is the inverse. No HTTP, no length prefix, no
 * Content-Length negotiation.
 */

import type { IApiError, ApiResult } from "../application-api/error.js";

/**
 * A JSON-RPC 2.0 identifier.
 *
 * The spec allows numbers and strings; we accept both because the
 * Application API's watch subscriptions already mint opaque ids
 * (`sub:xxx`), and a future caller may want numeric ids.
 */
export type JsonRpcId = number | string;

/**
 * A JSON-RPC 2.0 request from the client.
 *
 * Either `params` (object) or no `params` is accepted; the protocol
 * is lenient on the wire shape and strict on the Application API's
 * zod schemas.
 */
export interface IJsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

/**
 * A JSON-RPC 2.0 notification (no id, no response expected).
 *
 * The stdio bridge emits `$/cancelRequest` notifications from the
 * client to cancel an in-flight request; the server emits
 * `snapshot-ready` / `snapshot-stale` notifications back to the
 * client once the watch layer is wired.
 */
export interface IJsonRpcNotification {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

/**
 * A JSON-RPC 2.0 success response.
 */
export interface IJsonRpcSuccessResponse {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly result: unknown;
}

/**
 * A JSON-RPC 2.0 error response.
 *
 * `code` is one of the standard JSON-RPC codes OR a stable
 * `ApiErrorCode` mirrored into the JSON-RPC `data.code` slot so the
 * caller can pattern-match on it without parsing `message`.
 */
export interface IJsonRpcErrorResponse {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId | null;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: Readonly<Record<string, unknown>>;
  };
}

/** The discriminator the wire uses. */
export type IJsonRpcResponse =
  | IJsonRpcSuccessResponse
  | IJsonRpcErrorResponse;

/** Anything the wire can carry. */
export type IJsonRpcFrame =
  | IJsonRpcRequest
  | IJsonRpcNotification
  | IJsonRpcResponse;

/* ────────────────────────────────────────────────────────────────────── *
 * JSON-RPC 2.0 standard error codes                                     *
 * ────────────────────────────────────────────────────────────────────── *
 * Negative matches the spec; positive is for application-specific    *
 * codes mirrored in `data.code` (see `bridge-error.ts`).              *
 * ────────────────────────────────────────────────────────────────────── */

export const JSON_RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/** Standard JSON-RPC error code — see the spec. */
export type StandardJsonRpcErrorCode =
  (typeof JSON_RPC_ERROR_CODES)[keyof typeof JSON_RPC_ERROR_CODES];

/* ────────────────────────────────────────────────────────────────────── *
 * Builders — typed helpers so callers never spell out the literals.    *
 * ────────────────────────────────────────────────────────────────────── */

/** Builds a typed success response. */
export function jsonRpcSuccess(
  id: JsonRpcId,
  result: unknown,
): IJsonRpcSuccessResponse {
  return { jsonrpc: "2.0", id, result };
}

/**
 * Builds a typed error response.
 *
 * `data` carries the application's `IApiError` envelope so the
 * caller can recover `code` + `details` without re-parsing
 * `message`. `code` is the JSON-RPC standard code; the
 * application-specific code lives at `data.code`.
 *
 * Accepts a `number` (not narrowed to `StandardJsonRpcErrorCode`)
 * so bridges that propagate carrier-specific HTTP statuses (403,
 * 499, ...) can still emit a JSON-RPC envelope without casting.
 */
export function jsonRpcError(
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: Readonly<Record<string, unknown>>,
): IJsonRpcErrorResponse {
  return data
    ? { jsonrpc: "2.0", id, error: { code, message, data } }
    : { jsonrpc: "2.0", id, error: { code, message } };
}

/** Builds a `$/cancelRequest` notification carrying an in-flight id. */
export function jsonRpcCancel(requestId: JsonRpcId): IJsonRpcNotification {
  return {
    jsonrpc: "2.0",
    method: "$/cancelRequest",
    params: { id: requestId },
  };
}

/* ────────────────────────────────────────────────────────────────────── *
 * Parser — newline-delimited JSON over a readable byte stream.         *
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Pulls one frame per non-empty line.
 *
 * Lines starting with `//` are treated as comments and skipped.
 * Blank lines are skipped. Anything that does not parse as JSON
 * surfaces a `PARSE_ERROR` to the caller; the bridge surfaces it as
 * a JSON-RPC error response (the in-flight `id` is `null` because no
 * valid request identified it).
 *
 * Accepts an async iterable so the stdio bridge can drive the
 * parser directly off `Bun.stdin.stream()`. Sync iterables work
 * too — the function awaits each yield via `for await`.
 */
export async function* parseFrames(
  source: AsyncIterable<string> | Iterable<string>,
): AsyncGenerator<
  | { readonly ok: true; readonly frame: IJsonRpcFrame }
  | { readonly ok: false; readonly error: string }
> {
  for await (const raw of source) {
    const line = raw.trim();
    if (line === "" || line.startsWith("//")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      yield {
        ok: false,
        error: `PARSE_ERROR: ${(err as Error).message}`,
      };
      continue;
    }
    if (!isJsonRpcFrame(parsed)) {
      yield {
        ok: false,
        error: "PARSE_ERROR: frame is not a JSON-RPC 2.0 envelope",
      };
      continue;
    }
    yield { ok: true, frame: parsed };
  }
}

/**
 * Type guard for the wire shape.
 *
 * We accept both requests (`id` present, `method` present) and
 * notifications (`method` present, `id` absent), as well as
 * responses (`id` + `result` OR `id` + `error`). Anything that does
 * not match one of those shapes is rejected; the bridge surfaces a
 * `PARSE_ERROR` to the caller.
 */
export function isJsonRpcFrame(value: unknown): value is IJsonRpcFrame {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as { jsonrpc?: unknown; id?: unknown; method?: unknown; result?: unknown; error?: unknown };
  if (obj.jsonrpc !== "2.0") return false;

  if (typeof obj.method === "string") {
    // request or notification
    if (obj.id === undefined) return true;
    return isValidId(obj.id);
  }

  if (isValidId(obj.id) && (obj.result !== undefined || obj.error !== undefined)) {
    return true;
  }
  return false;
}

function isValidId(id: unknown): id is JsonRpcId {
  return typeof id === "string" || typeof id === "number";
}

/* ────────────────────────────────────────────────────────────────────── *
 * Application envelope ⇄ JSON-RPC mapper.                              *
 * ────────────────────────────────────────────────────────────────────── *
 * The bridges speak JSON-RPC on the wire; the Application API      *
 * speaks `ApiResult<T>` internally. The two helpers below are the  *
 * only place that knows about both, keeping the bridges pure.      *
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Wraps an `ApiResult` (the Application API's discriminated union)
 * into the JSON-RPC response shape for a given `id`.
 *
 * On success: a `{ result: value }` response — the value is the
 * `ApiResult` itself so the bridge author does not have to unwrap.
 * On failure: a JSON-RPC error whose `data.code` mirrors the
 * application code (`INVALID_INPUT`, `SESSION_NOT_FOUND`, ...).
 */
export function wrapApiResult(
  id: JsonRpcId,
  result: ApiResult<unknown>,
): IJsonRpcResponse {
  if (result.ok) {
    return jsonRpcSuccess(id, result);
  }
  return wrapApiError(id, result.error);
}

/**
 * Wraps an `IApiError` directly (used when the bridge fails before
 * reaching the dispatcher — wrong path, malformed input, ...).
 */
export function wrapApiError(
  id: JsonRpcId | null,
  error: IApiError,
): IJsonRpcErrorResponse {
  return jsonRpcError(id, JSON_RPC_ERROR_CODES.INTERNAL_ERROR, error.message, {
    code: error.code,
    ...(error.details ? { details: error.details } : {}),
  });
}