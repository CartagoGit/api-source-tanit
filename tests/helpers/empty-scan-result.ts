/**
 * `EMPTY_SCAN_RESULT` — an empty `IScanResult` for tests that only
 * need to satisfy the provider's contract.
 *
 * From a00010 S2 on, `IValidationSpecProvider.supports/resolve`
 * receives `scanResult` as the third argument. Providers that do not
 * derive rules from what the scanner collected (the twelve that are
 * not Fastify/Hono/Fiber/Rust) ignore it, but the contract does not
 * allow passing `undefined`. This module gives a value that satisfies
 * the shape and keeps the tests focused on what they are testing.
 *
 * Fastify/Hono/Fiber/Rust tests must use the real `scanResult`
 * returned by their scanner: those do look inside.
 *
 * Never `@deprecated`: this helper is intentional, not temporary.
 */
import type { IScanResult } from "../../packages/contracts/interfaces/core/scanner.interface";

export const EMPTY_SCAN_RESULT: IScanResult = Object.freeze({
  routes: Object.freeze([]) as ReadonlyArray<never>,
});
