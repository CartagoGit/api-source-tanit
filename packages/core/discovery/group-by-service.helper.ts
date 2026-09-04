/**
 * `groupByService` — a00013 S1.
 *
 * Convierte el resultado del descubrimiento en un `IServiceGraph`
 * donde cada servicio lleva su propio `match`, sus `endpoints`, su
 * `baseUrl` y su `auth` (override). Hasta esta propuesta, el pipeline
 * cargaba **una** `ProjectConfig` y mezclaba las `ParsedRoute` de
 * todos los workspaces en un único array; el merger las identificaba
 * por `serviceId` (introducido en a00010), pero `baseUrl`, `auth` y
 * `variables` seguían siendo globales. Aquí modelamos la unidad
 * natural: un servicio = un `match` + una config + una lista de
 * rutas.
 *
 * ## Contrato
 *
 * - El helper es **puro**: no lee del sistema de archivos, no toca
 *   `process.cwd()`, no hace red. `lint:no-process-cwd` /
 *   `lint:no-instance-mutable-maps-in-scanners` no le dicen nada.
 * - `serviceId` se deriva, por defecto, de `match.frameworkSearchRoot`
 *   (a00010). Si no hay `frameworkSearchRoot`, cae a
 *   `match.framework + "@" + projectRoot`. Esa cascada garantiza
 *   que **dos workspaces con la misma carpeta pero distinto
 *   framework no colisionan** — caso real: `apps/payments-api/` con
 *   dos frameworks en subcarpetas separadas. La normalización a
 *   `[A-Za-z0-9_-]` evita que un id inválido escape a nombres de
 *   colección Postman.
 * - `detectedMonorepo === false` produce un grafo con `length === 1`
 *   y `combined === false`. La invariante "todo grafo tiene al
 *   menos un servicio" **se valida con un test** explícito, no se
 *   deja solo al consumidor.
 * - El parámetro `combined` del caller es **opcional**. Default
 *   `false` = una colección por servicio (modelo nuevo). Cuando el
 *   caller quiera el comportamiento legacy, pasa `true`
 *   (`--combine-services` en la CLI).
 * - El helper no muta la `ParsedRoute[]` que recibe. Los escaneos
 *   son stateless entre invocaciones (a00010 B-06), y este helper
 *   preserva esa invariante.
 *
 * ## Por qué existe
 *
 * El `IServiceGraph` se introduce junto con este helper; en a00013
 * S2-S4 el `generation.pipeline.ts` y `loadProject()` migrarán a
 * consumir esta forma. Mientras tanto, el helper se usa solo desde
 * los tests del S1 — no es un dead-on-arrival.
 *
 * @see ./service-graph.interface.ts para la forma del grafo.
 */

import type { IProjectMatch } from "../../contracts/interfaces/core/scanner.interface.js";
import type {
  IGroupByServiceInput,
  IServiceDescriptor,
  IServiceGraph,
} from "../../contracts/interfaces/core/service-graph.interface.js";

/** Caracteres permitidos en un `serviceId` que vaya a un nombre Postman. */
const SERVICE_ID_SAFE = /[^A-Za-z0-9_-]/g;

/**
 * Normaliza el id: recorta caracteres no permitidos y reemplaza
 * secuencias de subrayados por un solo guion. Vacío después de
 * normalizar → `"default"`.
 */
function normalizeServiceId(raw: string): string {
  const trimmed = raw.replace(SERVICE_ID_SAFE, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return trimmed.length === 0 ? "default" : trimmed;
}

/**
 * Deriva el id estable de un match. Dos matches con el mismo
 * `frameworkSearchRoot` producen el mismo id.
 *
 * - Si hay `frameworkSearchRoot`, se usa como base del id (que es
 *   exactamente la regla que introdujo a00010).
 * - Si no, cae a `<framework>@<projectRoot>` para evitar
 *   colisiones entre un servicio single-framework en dos raíces
 *   distintas.
 */
export function deriveServiceId(match: IProjectMatch): string {
  const base =
    match.frameworkSearchRoot !== undefined && match.frameworkSearchRoot !== ""
      ? match.frameworkSearchRoot
      : `${match.framework}@${match.projectRoot}`;
  return normalizeServiceId(base);
}

/**
 * Forma un `IServiceGraph` a partir de los matches y rutas del
 * discovery.
 *
 * Lanza `Error` si:
 * - Falta una entrada en `routesByMatch` para un match.
 * - `matches` está vacío y `detectedMonorepo === false` (un
 *   proyecto que no es monorepo **debe** tener al menos un match,
 *   si no el caller no entendió los contratos). El caller puede
 *   silenciar este chequeo pasando `detectedMonorepo === true` con
 *   un array vacío — es el caso "monorepo declarado pero sin
 *   workspaces enumerados".
 */
export function groupByService(input: IGroupByServiceInput): IServiceGraph {
  const combined = input.combined ?? false;
  if (input.matches.length === 0) {
    if (input.detectedMonorepo === true) {
      return { services: [], combined };
    }
    throw new Error(
      "groupByService requires at least one match when detectedMonorepo === false",
    );
  }

  const services: IServiceDescriptor[] = [];
  for (const match of input.matches) {
    const serviceId = deriveServiceId(match);
    const routes = input.routesByMatch.get(serviceId) ?? [];
    if (!input.routesByMatch.has(serviceId)) {
      throw new Error(
        `groupByService is missing routes for service '${serviceId}' (framework=${match.framework})`,
      );
    }
    services.push({
      serviceId,
      match,
      endpoints: routes,
      baseUrl: input.baseUrlByService?.get(serviceId) ?? null,
      auth: input.authByService?.get(serviceId) ?? undefined,
      variables: input.variablesByService?.get(serviceId) ?? [],
    });
  }
  return { services, combined };
}
