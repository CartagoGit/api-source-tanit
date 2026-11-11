/**
 * `bridge-error.ts` — typed errors shared by every transport bridge.
 *
 * The Application API (`packages/core/application-api/`) speaks the
 * `IApiError` envelope (f00016 S3). The wire shape (stdio, HTTP)
 * speaks JSON-RPC 2.0 (see `json-rpc-protocol.ts`). This module is
 * the **bridge between the two** — it knows the Application codes
 * and the JSON-RPC codes, and provides:
 *
 *   - `BridgeError` — a typed exception the bridge code `throw`s
 *     when it cannot reach the dispatcher (e.g. token rejected,
 *     malformed envelope, internal failure that isn't a handler
 *     error). The bridge catches it and emits the right
 *     JSON-RPC error response.
 *
 *   - `httpErrorFromApi()` / `httpErrorFromBridge()` — HTTP status
 *     mappers so the HTTP bridge surfaces a sane status code
 *     alongside the JSON body. The body is the same JSON-RPC error
 *     envelope either way, so a curl caller can debug without a
 *     library.
 *
 * The Application API's `IApiError` is a runtime union, not a class;
 * throwing `apiError(...)` from the dispatcher returns a `fail()`
 * which the bridge wraps. The bridges themselves throw `BridgeError`
 * only on carrier-level failures (security rejected the request,
 * line could not be framed, ...).
 */

import type { IApiError, ApiErrorCode } from "../application-api/error.js";
import { apiError } from "../application-api/error.js";

/**
 * A carrier-level failure the bridge raises when it cannot reach
 * the dispatcher.
 *
 * `public` — the JSON-RPC code the wire surface uses (typically
 * `INVALID_PARAMS` or `INTERNAL_ERROR`).
 * `app` — the `IApiError` envelope to embed into `data`.
 *
 * The constructor is the only sanctioned path. Bridges catch this
 * type and emit a JSON-RPC error response without ever re-throwing
 * to the client.
 */
export class BridgeError extends Error {
  readonly public: number;
  readonly app: IApiError;
  constructor(opts: { code: number; app: IApiError }) {
    super(opts.app.message);
    this.name = "BridgeError";
    this.public = opts.code;
    this.app = opts.app;
  }
}

/** Convenience: build a `BridgeError` from an `IApiError` + code. */
export function bridgeError(
  publicCode: number,
  appError: IApiError,
): BridgeError {
  return new BridgeError({ code: publicCode, app: appError });
}

/** Convenience: build a `BridgeError` directly from primitives. */
export function bridgeFailure(
  publicCode: number,
  code: ApiErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): BridgeError {
  return new BridgeError({
    code: publicCode,
    app: details ? apiError(code, message, details) : apiError(code, message),
  });
}

/* ────────────────────────────────────────────────────────────────────── *
 * HTTP status mapping.                                                  *
 *                                                                       *
 * The Application API's error codes map cleanly onto HTTP statuses:   *
 * the ones below are the cases a caller can react to. Anything else  *
 * (an unexpected internal failure) is `500`.                           *
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Picks the HTTP status the `http-bridge.server.ts` returns for an
 * `IApiError`. The bridge always emits the JSON-RPC error envelope
 * in the body too — the status is for HTTP-aware callers.
 *
 *   - `INVALID_INPUT`        → 400 (caller sent malformed data).
 *   - `UNKNOWN_HANDLER`      → 404 (the path is unknown).
 *   - `SESSION_NOT_FOUND`    → 404 (the session is unknown).
 *   - `SERVICE_NOT_FOUND`    → 404.
 *   - `OPERATION_NOT_FOUND`  → 404.
 *   - `CANCELED`             → 499 (client closed request; nginx-style).
 *   - `EXPORT_FAILED`        → 422 (semantically unprocessable).
 *   - `EXECUTION_FAILED`     → 500.
 */
export function httpStatusFromApi(app: IApiError): number {
  switch (app.code) {
    case "INVALID_INPUT":
      return 400;
    case "UNKNOWN_HANDLER":
    case "SESSION_NOT_FOUND":
    case "SERVICE_NOT_FOUND":
    case "OPERATION_NOT_FOUND":
      return 404;
    case "CANCELED":
      return 499;
    case "EXPORT_FAILED":
      return 422;
    case "EXECUTION_FAILED":
    default:
      return 500;
  }
}

/** Same as above, but for carrier-level `BridgeError` values. */
export function httpStatusFromBridge(err: BridgeError): number {
  return err.public >= 400 && err.public < 600 ? err.public : 500;
}