/**
 * `error.ts` — typed errors for the Application API (f00016 S3).
 *
 * Every handler may fail; the dispatcher wraps every result in a
 * discriminated union so the caller never has to read two different
 * error shapes. `IApiError` is the canonical envelope — the same
 * shape the bridges (`stdio-bridge`, `http-bridge`, S4) carry over
 * the wire, and the same shape the Web UI consumes.
 *
 * Codes are stable strings (not numbers) so a log scraper can grep
 * them without parsing context, and so a Postman script that wants
 * to react to a specific failure can match `error.code` directly.
 *
 * The bridge-side rule of "every tool returns either a success
 * payload or `{ ok: false, error: ... }`" is **not** repeated here:
 * each handler returns a *typed* payload that already encodes its
 * own success/failure. The dispatcher wraps that in the wire
 * envelope on the way out.
 */

import type { ZodError } from "zod";
import type { ApiErrorCode, ApiResult, IApiError } from "../../contracts/interfaces/core/application-api.interface.js";

/**
 * Stable error codes the API may return. Keep additions additive —
 * callers match on these strings, so a renumbering would be a
 * silent break.
 */
/** Builds an `IApiError` — the only sanctioned constructor. */
export function apiError(
  code: ApiErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): IApiError {
  if (details) {
    return { code, message, details };
  }
  return { code, message };
}

/** Type guard: is `value` an `IApiError`? */
export function isApiError(value: unknown): value is IApiError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { code?: unknown; message?: unknown };
  return (
    typeof candidate.code === "string" &&
    typeof candidate.message === "string"
  );
}

/**
 * Converts a Zod parse failure into the `INVALID_INPUT` envelope.
 *
 * The `details` carry the flattened field map — `{ "<path>": "<msg>" }` —
 * so a UI can highlight the offending input directly without a
 * second round-trip.
 */
export function fromZodError(err: ZodError): IApiError {
  const flat = err.flatten();
  return apiError("INVALID_INPUT", "Input did not match the handler schema", {
    fieldErrors: flat.fieldErrors,
    formErrors: flat.formErrors,
  });
}

/**
 * Discriminated union the dispatcher returns: either the handler's
 * success payload (typed via the generic) or an `IApiError`.
 *
 * The bridges treat this union the same way: success on `ok=true`,
 * error on `ok=false`. The bridge-side wrapper is **not** part of
 * the API surface — handlers and dispatcher speak this union.
 */
/** Wraps a successful value into the union. */
export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

/** Wraps an error into the union. */
export function fail(err: IApiError): ApiResult<never> {
  return { ok: false, error: err };
}

export type { ApiErrorCode, ApiResult, IApiError } from "../../contracts/interfaces/core/application-api.interface.js";

/**
 * Standard `unknown` catcher: turns thrown errors into typed
 * envelopes. `ApiError` already-shaped values pass through with
 * their envelope; everything else becomes `EXECUTION_FAILED`.
 */
export function toApiError(err: unknown): IApiError {
  if (isApiError(err)) return err;
  if (err instanceof Error) {
    return apiError("EXECUTION_FAILED", err.message, { name: err.name });
  }
  return apiError("EXECUTION_FAILED", String(err));
}