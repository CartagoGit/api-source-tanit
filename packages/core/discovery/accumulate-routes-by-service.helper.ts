/**
 * Accumulates `routesByService` from the per-scanner slice the pipeline
 * has produced. x00025.
 *
 * Why it exists
 * - Before this helper, `generation.pipeline.ts` built the map like:
 *
 *     routesByService: new Map(
 *       perScanner.map(({ serviceId, scannerSpecs }) => [
 *         serviceId,
 *         routes.filter(r => scannerSpecs.some(s => s.method === r.method && s.uri === r.uri)),
 *       ]),
 *     );
 *
 *   Two distinct problems hidden in that line:
 *
 *   1. `new Map([...])` with the same `serviceId` twice **overwrites**
 *      the first entry. Real case: hybrid Express + GraphQL under the
 *      same `frameworkSearchRoot` → the first scanner's routes are
 *      silently dropped and the collection comes out incomplete.
 *
 *   2. The `routes.filter(...)` clause uses `(method, uri)` as the
 *      identity of a route. That identity is **not stable across
 *      services**: two services that happen to expose `GET /health`
 *      (very common — liveness probes, ingress controllers, sidecar
 *      patterns) both match the predicate, and the helper attributes
 *      the cross-service route to whichever key it reaches first.
 *      Real case: monorepo with `apps/users` and `apps/orders`,
 *      each defining `GET /health` from its own scanner → both keys
 *      end up with both routes, mixing the two collections.
 *
 * The fix
 * - Pass the routes per scanner (`scannerRoutes`) instead of asking
 *   the helper to re-derive attribution from a global routes array.
 *   Each scanner already knows which routes it emitted; no
 *   `(method, uri)` re-attribution is needed.
 * - For the dedupe, the stable identity is `(method, uri, sourceFile)`:
 *   the same scanner emits the same route twice if the input file
 *   repeats the operation; different scanners may emit routes that
 *   collide on `(method, uri)` but never on `sourceFile`. We keep
 *   the first occurrence (stable order).
 *
 * Contract
 * - Returns a `Map<serviceId, ParsedRoute[]>` with the **union** of
 *   the routes from all the scanners that share `serviceId`,
 *   **deduplicated** by `(method, uri, sourceFile)`.
 * - The caller passes `perScanner` with the minimum shape this helper
 *   needs (`{ serviceId, scannerRoutes }`); no coupling to the
 *   internal `IPerScanner` type of `generation.pipeline.ts`. If that
 *   type grows later, this helper does not need to change.
 * - Pure: no disk, no `process.*`, no mutation of arguments.
 *
 * Test surface
 * - `tests/core/accumulate-routes-by-service.spec.ts` covers the
 *   five cases of x00025 S1: two scanners same `serviceId`,
 *   dedupe intra-key, hybrid Express + GraphQL, two services same
 *   `(method, uri)` (the original bug), and scanner with no
 *   matching routes.
 */
import type { ParsedRoute } from "../../contracts/interfaces/core/scanner.interface.js";

/**
 * Accumulates and deduplicates routes by `serviceId`.
 *
 * Order is stable: for each scanner entry, we concatenate `existing`
 * (what previous scanners with the same `serviceId` already
 * contributed) followed by `scannerRoutes` (what this scanner
 * emitted). The first occurrence of each `(method, uri, sourceFile)`
 * tuple wins.
 *
 * The `perScanner` parameter takes only the two fields the helper
 * needs (`serviceId`, `scannerRoutes`) so it does not couple to
 * `IPerScanner` (which also carries `framework`, `scannerScore`,
 * `scannerSpecs`). The shape is declared inline because the gate
 * `lint:contracts` requires types to live in `contracts/` — making
 * the helper importable for typing alone would defeat that.
 *
 * @param perScanner What the pipeline collected per scanner.
 * @returns          Map `serviceId` -> deduplicated union of routes.
 */
export function accumulateRoutesByService(
  perScanner: ReadonlyArray<{
    readonly serviceId: string;
    readonly scannerRoutes: ReadonlyArray<ParsedRoute>;
  }>,
): Map<string, ParsedRoute[]> {
  const out = new Map<string, ParsedRoute[]>();
  for (const { serviceId, scannerRoutes } of perScanner) {
    const existing = out.get(serviceId) ?? [];
    const seen = new Set<string>();
    const merged: ParsedRoute[] = [];
    for (const r of [...existing, ...scannerRoutes]) {
      const key = `${r.method}|${r.uri}|${r.sourceFile}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(r);
    }
    out.set(serviceId, merged);
  }
  return out;
}
