/**
 * Acumulacion de `routesByService` desde la lista de scanners que el
 * pipeline ha corrido. x00025.
 *
 * Por que existe
 * - Antes, `generation.pipeline.ts` construia el mapa asi:
 *
 *     routesByService: new Map(
 *       perScanner.map(({ serviceId, scannerSpecs }) => [
 *         serviceId,
 *         routes.filter(r => scannerSpecs.some(s => s.method === r.method && s.uri === r.uri)),
 *       ]),
 *     );
 *
 *   El `new Map([...])` con la misma `serviceId` duplicada **sobrescribe**
 *   la entrada del primer scanner. Caso real: proyecto hibrido
 *   Express + GraphQL bajo el mismo `frameworkSearchRoot` -> las rutas
 *   del primer scanner se pierden silenciosamente y la coleccion sale
 *   incompleta.
 * - Ademas, dos scanners pueden emitir la **misma** ruta (la vieron
 *   ambos); sin dedupe, la misma `ParsedRoute` aparece dos veces en
 *   el array final.
 *
 * Contrato
 * - Devuelve un `Map<serviceId, ParsedRoute[]>` con **union** de todas
 *   las rutas de los scanners que comparten `serviceId`, **deduplicadas**
 *   por tupla `(method, uri, sourceFile)` (los tres campos que
 *   identifican una operacion de forma estable; el `name` no porque
 *   se deriva).
 * - El caller pasa `perScanner` con la forma minima que necesita este
 *   helper (`{ serviceId, scannerSpecs }`) para no acoplarse a la
 *   `IPerScanner` interna de `generation.pipeline.ts`. Si en el futuro
 *   `IPerScanner` crece, este helper no se entera.
 * - Pure: no toca disco, no lee `process.*`, no muta los argumentos.
 *
 * Test surface
 * - `tests/core/accumulate-routes-by-service.spec.ts` cubre los tres
 *   casos del proposal x00025 S1: dos scanners mismo serviceId, dedupe
 *   intra-key, e hibrido Express + GraphQL.
 */
import type { EndpointSpec } from "../../contracts/interfaces/core/postman.interface.js";
import type { ParsedRoute } from "../../contracts/interfaces/core/scanner.interface.js";

/**
 * Acumula y deduplica rutas por `serviceId`.
 *
 * Orden estable: para cada scanner se concatena `existing` (lo ya
 * acumulado de scanners anteriores con el mismo serviceId) seguido de
 * `fresh` (las rutas que este scanner vio, filtradas por sus
 * `scannerSpecs`). La primera vez que aparece una tupla
 * `(method, uri, sourceFile)` gana.
 *
 * El parametro `perScanner` toma solo los dos campos que el helper
 * necesita (`serviceId`, `scannerSpecs`) para no acoplarse al
 * `IPerScanner` interno de `generation.pipeline.ts` (que tiene
 * `framework`, `scannerScore`, etc.). La forma se declara inline en
 * lugar de exportar un `interface` desde `core/discovery/` — el gate
 * `lint:contracts` exige que los tipos vivan en `contracts/` para no
 * obligar a los consumidores a importar la funcion solo para tipar.
 *
 * @param perScanner Lo que el pipeline recoge por scanner.
 * @param routes     Todas las rutas que el pipeline ha producido.
 * @returns          Mapa `serviceId` -> union deduplicada de rutas.
 */
export function accumulateRoutesByService(
  perScanner: ReadonlyArray<{
    readonly serviceId: string;
    readonly scannerSpecs: ReadonlyArray<EndpointSpec>;
  }>,
  routes: ReadonlyArray<ParsedRoute>,
): Map<string, ParsedRoute[]> {
  const out = new Map<string, ParsedRoute[]>();
  for (const { serviceId, scannerSpecs } of perScanner) {
    const existing = out.get(serviceId) ?? [];
    const fresh = routes.filter((r) =>
      scannerSpecs.some((s) => s.method === r.method && s.uri === r.uri),
    );
    const seen = new Set<string>();
    const merged: ParsedRoute[] = [];
    for (const r of [...existing, ...fresh]) {
      const key = `${r.method}|${r.uri}|${r.sourceFile}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(r);
    }
    out.set(serviceId, merged);
  }
  return out;
}
