/**
 * Maps a Tanit `EndpointSpec.method` (or any `string`) to the literal
 * the Postman v2.1.0 schema accepts in `request.method`.
 *
 * `ALL` (the Hono `.all()` sentinel — see `aad6376` and the audit
 * 2026-09-06 second pass §6) maps to `ANY`, the only Postman verb
 * that captures "any HTTP method". Older Postman versions ignore
 * `ANY` and fall back to a GET; that is acceptable — it is the
 * same fallback the previous `app.all('/x', h) → GET` mapping
 * produced, but with the original semantics preserved instead of
 * lost.
 *
 * Exported (and given a stable name) so the CLI's bidirectional
 * coverage check can use the same translation: without it, a source
 * route with `method: "ALL"` and a collection request with
 * `method: "ANY"` look like two different endpoints to the validator
 * and it aborts the generation. Single helper, single source of
 * truth.
 *
 * Accepts `string` (not `EndpointSpec["method"]`) so callers that
 * only have the raw `ParsedRoute.method` can use it without
 * casting.
 */
export function postmanMethodFor(method: string): string {
  return method === "ALL" ? "ANY" : method;
}