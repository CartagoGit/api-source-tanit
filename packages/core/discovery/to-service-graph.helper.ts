/**
 * toServiceGraph - a00013 S2.
 *
 * Ensambla un IServiceGraph a partir del resultado de discoverSpecs
 * SIN tocar el flujo del pipeline. Hoy el merger ya distingue por
 * serviceId (a00010); este helper formaliza esa identidad en un
 * IServiceGraph reutilizable y deja la puerta abierta a S3 y S4
 * (consumo real desde buildFor y desde la CLI).
 *
 * Por que existe sin que buildFor lo consuma todavia
 * - S2 es deliberadamente adyacente: anade el adaptador, lo prueba
 * y lo deja listo. S3 lo conectara a buildFor y añadira el flag
 * --combine-services en la CLI; S4 lo conectara al discriminante
 * de auth por servicio.
 * - Si S2 metiera el wiring de golpe, S3 y S4 tocarian los mismos
 * archivos en tres slices consecutivos, y el conflicto entre S2
 * y S3 ya estaba marcado por el propio parser de propuestas como
 * disjointness warning (los tres slices quieren generation.pipeline.ts).
 * - El helper es puro: no lee del filesystem, no toca process.cwd(),
 * no lee process.argv. Su unica dependencia del estado del pipeline
 * es el IDiscovery que recibe como argumento.
 *
 * Contrato
 * - Proyecto plano (cero workspaces detectados): un unico servicio
 * con serviceId derivado del match.frameworkSearchRoot (cae a
 * framework@projectRoot si esta ausente). combined === false.
 * Es el camino del 100% de los ejemplos de examples/example-asterix/.
 * - Monorepo multi-workspace (>= 2 matches): un servicio por match.
 * combined === false por defecto. El caller decide si pasa
 * combined: true (futuro --combine-services).
 * - Monorepo sin workspaces enumerados: grafo vacio (no se
 * inventa un servicio). Mismo comportamiento que groupByService
 * con detectedMonorepo: true.
 *
 * Estado
 * El baseUrl y auth por servicio aun no se derivan desde
 * ProjectConfig - eso es trabajo de S3/S4, que necesitaran mover
 * la carga de config al descriptor del servicio. Por ahora son
 * null/undefined respectivamente: el caller que quiera override
 * los rellena antes de consumir el grafo.
 */

import type { ParsedRoute } from "../../contracts/interfaces/core/scanner.interface.js";
import type { IEndpointAuth } from "../../contracts/interfaces/core/postman.interface.js";
import type {
  IServiceDescriptor,
  IServiceGraph,
  IToServiceGraphInput,
} from "../../contracts/interfaces/core/service-graph.interface.js";
import { deriveServiceId, groupByService } from "./group-by-service.helper.js";

/**
 * Forma el IServiceGraph desde el estado actual del discovery.
 *
 * El helper no infiere nada que no venga en el input. Si el caller
 * aun no popula routesByService/authByService/etc., devuelve un
 * grafo con la identidad de cada servicio y arrays vacios - que es
 * exactamente lo que S2 quiere: el shape del grafo listo para que
 * S3/S4 lo rellenen sin tener que cambiar el contrato.
 */
export function toServiceGraph(input: IToServiceGraphInput): IServiceGraph {
  // x00025 S1: antes `routesByMatch.set(serviceId, routes)` sobrescribia
  // si el caller metia dos entradas con la misma `serviceId` en
  // `input.routesByService`. La pipeline ya no produce eso (el helper
  // `accumulateRoutesByService` deduplica), pero este helper es la
  // frontera entre el pipeline y el IServiceGraph y queremos que el
  // contrato sea localmente correcto: union + dedupe aqui tambien.
  const routesByMatch = new Map<string, ParsedRoute[]>();
  for (const [serviceId, routes] of input.routesByService) {
    const existing = routesByMatch.get(serviceId) ?? [];
    const seen = new Set<string>();
    const merged: ParsedRoute[] = [];
    for (const r of [...existing, ...routes]) {
      const key = `${r.method}|${r.uri}|${r.sourceFile}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(r);
    }
    routesByMatch.set(serviceId, merged);
  }
  for (const match of input.matches) {
    const serviceId = deriveServiceId(match);
    if (!routesByMatch.has(serviceId)) {
      routesByMatch.set(serviceId, []);
    }
  }
  return groupByService({
    matches: input.matches,
    routesByMatch,
    detectedMonorepo: input.monorepoDetection?.isMonorepo === true,
    combined: input.combined ?? false,
    authByService: input.authByService,
    baseUrlByService: input.baseUrlByService,
  });
}

/**
 * Variante de toServiceGraph que aplica los overrides del caller
 * sobre cada descriptor despues de haberlos calculado. Util cuando
 * el caller quiere producir un IServiceGraph decorado sin tener
 * que re-implementar la propagacion de auth/baseUrl/variables.
 *
 * Por ahora vive aqui mismo porque solo se usa desde S2 y los
 * tests; si S3 o S4 lo necesitan mas, se promociona a helper
 * independiente.
 */
export function decorateServices(
  graph: IServiceGraph,
  overrides: {
    readonly baseUrlByService?: ReadonlyMap<string, string | null> | undefined;
    readonly authByService?: ReadonlyMap<string, IEndpointAuth | undefined> | undefined;
    readonly variablesByService?:
      | ReadonlyMap<
        string,
        ReadonlyArray<{ readonly key: string; readonly value: string }>
      >
      | undefined;
  },
): IServiceGraph {
  const services: IServiceDescriptor[] = graph.services.map((service) => ({
    serviceId: service.serviceId,
    match: service.match,
    endpoints: service.endpoints,
    baseUrl: overrides.baseUrlByService?.get(service.serviceId) ?? service.baseUrl,
    auth: overrides.authByService?.get(service.serviceId) ?? service.auth,
    variables: overrides.variablesByService?.get(service.serviceId) ?? service.variables,
  }));
  return { services, combined: graph.combined };
}
