/**
 * `dispatcher.ts` — the request router for the Application API
 * (f00016 S3).
 *
 * The dispatcher is the **only** place that knows the names of the
 * 14 handlers. Each host (CLI, HTTP bridge, stdio bridge, Web UI)
 * sends a `(name, input, ctx)` triple and gets back an `ApiResult`.
 * The dispatcher:
 *
 *   1. Validates `input` against the handler's zod input schema.
 *   2. Calls the handler with the parsed input + `IRequestContext`.
 *   3. Wraps thrown errors into `IApiError` envelopes.
 *   4. Returns the discriminated union to the caller.
 *
 * No I/O happens here — the dispatcher is a pure orchestrator. The
 * 14 handlers each take their own I/O dependencies via the
 * `IRequestContext` (see below) so this module stays testable
 * without a real filesystem / event loop.
 *
 * ## Why one big dispatcher instead of N small ones
 *
 * - One place to look up "is this name valid? what does its input
 *   look like? what does it return?". A bridge author reads
 *   `dispatcher.ts` and knows everything.
 * - One place to enforce "validate input, wrap errors". The shape
 *   invariant the bridges rely on (`ApiResult<T>` discriminated by
 *   `ok`) lives here and is checked by every handler through this
 *   path — handlers cannot return raw values to the bridge.
 */

import { ZodError } from "zod";
import type { HandlerRegistry, IHandler, IRequestContext } from "../../contracts/interfaces/core/application-api.interface.js";

import {
  apiError,
  fail,
  fromZodError,
  isApiError,
  ok,
  toApiError,
} from "./error.js";
import type { ApiResult } from "../../contracts/interfaces/core/application-api.interface.js";

/**
 * Caller-provided context that travels with every request.
 *
 * The dispatcher never reads `workspace` / `signal` / `caller` —
 * handlers do. Splitting the surface here keeps the dispatcher
 * agnostic of who is calling (Web UI vs CLI vs Tauri) while still
 * giving handlers everything they need.
 *
 * `AbortSignal` lives on the global `lib.dom.d.ts` in modern TS,
 * but the project's tsconfig.base.json pins `lib: ["ES2022"]` —
 * declared by hand to keep the binary free of `@types/node` at
 * runtime. The minimum subset we need is the `aborted` boolean.
 */
/** Contexto común que el dispatcher entrega a cada handler. */
/** The shape every handler must conform to. */
/**
 * Routes a request through the registered handler.
 *
 * On any non-recoverable failure (unknown handler, invalid input,
 * handler threw) the dispatcher returns the typed error envelope
 * — it never throws. The bridge author wraps this in the wire
 * shape; the CLI prints it; the Web UI surfaces it.
 */
export async function dispatch<TOut = unknown>(
  registry: HandlerRegistry,
  name: string,
  rawInput: unknown,
  ctx: IRequestContext,
): Promise<ApiResult<TOut>> {
  const handler = registry[name];
  if (!handler) {
    return fail(apiError("UNKNOWN_HANDLER", `Handler "${name}" is not registered`));
  }
  return invokeHandler(handler, rawInput, ctx) as Promise<ApiResult<TOut>>;
}

async function invokeHandler(
  handler: IHandler<unknown, unknown>,
  rawInput: unknown,
  ctx: IRequestContext,
): Promise<ApiResult<unknown>> {
  // 1. Aborted before we started — short-circuit.
  if (ctx.signal?.aborted) {
    return fail(apiError("CANCELED", "Request aborted before dispatch"));
  }

  // 2. Validate the input.
  let parsed: unknown;
  try {
    parsed = handler.input.parse(rawInput);
  } catch (err) {
    if (err instanceof ZodError) {
      return fail(fromZodError(err));
    }
    return fail(toApiError(err));
  }

  // 3. Run the handler.
  try {
    const value = await handler.handle(parsed, ctx);
    return ok(value);
  } catch (err) {
    if (isApiError(err)) {
      return fail(err);
    }
    return fail(toApiError(err));
  }
}

/** Re-export the public error surface for handler consumers. */
export type { ApiResult, HandlerRegistry, IHandler, IRequestContext, IAbortSignalLike } from "../../contracts/interfaces/core/application-api.interface.js";
export type { IApiError } from "../../contracts/interfaces/core/application-api.interface.js";
export { apiError, fail, ok, toApiError, fromZodError, isApiError } from "./error.js";