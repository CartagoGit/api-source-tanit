/**
 * Multi-service graph: la unidad de descubrimiento tras el
 * `serviceId` introducido en a00010/x00013.
 *
 * Hasta esta propuesta, un monorepo (`apps/users-api` +
 * `apps/payments-api`) terminaba en una sola colección con una sola
 * `baseUrl`, una sola auth global y un set de endpoints mezclado por
 * coincidencia de `METHOD+URI`. `serviceId` permite distinguir los
 * endpoints; este contrato eleva esa distinción a modelo de primera
 * clase para que el pipeline —no solo el merger— pueda respetarlo.
 *
 * Por qué **aquí** y no al lado del orquestador: `IServiceDescriptor`
 * reusa `IProjectMatch`, `ParsedRoute` y `IEndpointAuth`, tres tipos
 * que ya viven en `contracts/`. Si esto viviera en `core/`,
 * cualquier consumidor del plugin MCP que quisiera importarlo
 * arrastraría el pipeline entero (lo que ya pasó con
 * `IProjectSummary`). `lint:contracts` lo exige.
 *
 * No introduce un barrel `packages/contracts/index.ts` — el README
 * de `contracts/` es explícito sobre no añadirlo. Los importadores
 * usan path relativo canónico.
 *
 * Forma parte de a00013 (Multi-service para monorepos). S1 deja solo
 * el shape; S2-S4 lo enchufan al pipeline.
 */

import type { IProjectMatch, ParsedRoute } from "./scanner.interface.js";
import type { IEndpointAuth } from "./postman.interface.js";

/**
 * El descriptor de un servicio individual dentro de un proyecto
 * multi-service.
 *
 * Tres bloques:
 *
 * 1. Identidad (de dónde sale) — `serviceId`, `match`, `evidence`.
 * 2. Configuración propia (la que anula la global del monorepo).
 * 3. Las rutas del servicio, en el formato neutro del pipeline.
 *
 * Los tres bloques viven en el mismo objeto a propósito: cada
 * servicio tiene un solo `match`, una sola config y un solo set de
 * rutas. Separarlos reintroduciría el problema que esta propuesta
 * ataca — que `loadProject()` cargue una config y los scanners
 * terminen viendo otra.
 *
 * `serviceId` se calcula por defecto a partir de
 * `match.frameworkSearchRoot` (a00010 ya lo introdujo así). Cuando
 * el caller quiera forzar uno explícito (p. ej. para mantener
 * identidad estable a través de renombrados de carpeta), puede
 * sobrescribirlo vía `IServiceDescriptor.serviceId`. Lo que el
 * helper nunca inventará son caracteres fuera de `[A-Za-z0-9_-]`,
 * porque el id aparece en nombres de colección y de environment
 * variables Postman.
 */
export interface IServiceDescriptor {
  /** Identidad estable del servicio; usado como clave de merge y nombre. */
  readonly serviceId: string;
  /** El match del framework resuelto para ESTE servicio. */
  readonly match: IProjectMatch;
  /** Las rutas detectadas para ESTE servicio, en formato neutro. */
  readonly endpoints: ReadonlyArray<ParsedRoute>;
  /**
   * Override de `baseUrl` para este servicio (p. ej.
   * `http://localhost:3001`). `null` cuando hereda la global del
   * proyecto — el comportamiento legacy.
   */
  readonly baseUrl: string | null;
  /**
   * Auth por servicio. Cuando es `undefined`, el servicio hereda la
   * global; cuando es `{ kind: "none" }`, el servicio es público
   * aunque el resto del proyecto lleve bearer.
   *
   * Se modela como override (no como valor derivado) porque la
   * detección por servicio puede discrepar de la del proyecto:
   * `apps/catalog-api` puede venir con `apiKey` en cabecera y
   * `apps/payment-api` con `bearer`.
   */
  readonly auth: IEndpointAuth | undefined;
  /**
   * Variables específicas del servicio. Vacío = hereda las globales;
   * no vacío = añade (no reemplaza) variables al environment.
   */
  readonly variables: ReadonlyArray<{ readonly key: string; readonly value: string }>;
}

/**
 * Los inputs del helper `groupByService`. Vive aquí por la misma razón
 * que `IServiceDescriptor`: el helper es genérico, pero sus inputs
 * son contratos compartidos entre cualquier llamante (CLI, plugin,
 * tests). Moverlos dentro de `core/` reintroduciría el bug que este
 * contrato ataca: que para tipar algo haya que arrastrar la
 * implementación.
 */
export interface IGroupByServiceInput {
  /** Cada match = un servicio distinto cuando hay varios. */
  readonly matches: ReadonlyArray<IProjectMatch>;
  /** Las rutas detectadas **por match**, en el mismo orden. */
  readonly routesByMatch: ReadonlyMap<string, ReadonlyArray<ParsedRoute>>;
  /** ¿El caller ya detectó monorepo? Default `false`. */
  readonly detectedMonorepo?: boolean | undefined;
  /** Override de auth por servicio; opcional. */
  readonly authByService?: ReadonlyMap<string, IEndpointAuth | undefined> | undefined;
  /** Override de baseUrl por servicio; opcional. */
  readonly baseUrlByService?: ReadonlyMap<string, string | null> | undefined;
  /** Variables extra por servicio (no reemplaza, añade). */
  readonly variablesByService?: ReadonlyMap<
    string,
    ReadonlyArray<{ readonly key: string; readonly value: string }>
  > | undefined;
  /** ¿Combinar todos los servicios en una sola colección? */
  readonly combined?: boolean | undefined;
}

/**
 * El grafo de servicios que sale del descubrimiento multi-service.
 *
 * `combined` refleja la decisión del usuario, no del pipeline.
 * Cuando `combined === true`, el pipeline produce una única
 * colección fusionada (modo legacy / `--combine-services`). Cuando
 * `combined === false`, produce una colección por servicio.
 *
 * `services` siempre contiene al menos un servicio: un proyecto
 * de un solo servicio no es monorepo y por tanto produce
 * `services.length === 1` con `combined === false`. Esa invariante
 * la garantiza el helper `groupByService` (en `core/discovery/`),
 * no este contrato.
 */
export interface IServiceGraph {
  readonly services: ReadonlyArray<IServiceDescriptor>;
  /** ¿El usuario pidió combinar los servicios en una sola colección? */
  readonly combined: boolean;
}
