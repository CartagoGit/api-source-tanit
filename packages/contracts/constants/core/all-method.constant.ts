/**
 * Constants for the `method: "ALL"` sentinel that Hono's `.all()`
 * produces (commit `aad6376`, audit 2026-09-06 §13).
 *
 * Lives here — not in `packages/core/helpers/` — because every
 * exporter imports it: if it lived in `core/`, the MCP surface
 * would have to drag the whole pipeline just to declare an
 * `x-tanit-source` extension. `lint:contracts` enforces the split.
 */

/**
 * Marker attached to every operation that originated as
 * `method: "ALL"`. Carries through the OpenAPI extension
 * `x-tanit-source: "hono.all"` and is the only way the user (or a
 * downstream tool) can tell that the seven operations came from a
 * single `app.all('/x', h)` and were not declared individually.
 */
export const ALL_METHOD_MARKER = "hono.all" as const;

/**
 * The seven HTTP verbs `ALL` expands to, in stable order.
 *
 * Stable order is required so two runs of Tanit over the same
 * project produce the same OpenAPI / HAR / Bruno / Insomnia output,
 * and so `diff` between collections is meaningful across regenerations.
 */
export const ALL_METHOD_VERBS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;
