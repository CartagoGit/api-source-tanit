/**
 * Estrategia de descubrimiento de último recurso.
 *
 * Cuando ningún scanner reconoce el proyecto, el pipeline aún puede
 * intentar algo: hoy, una heurística sobre `routes/*.php` heredada de
 * cuando esto era una herramienta solo para Laravel.
 *
 * Vive en el núcleo **como interfaz** por el mismo motivo que el
 * catálogo de scanners: el pipeline necesita poder llamar a un
 * fallback, pero no puede conocer cuál. Antes lo importaba directo
 * (`endpoint-discovery.service`, que parsea PHP), y eso metía Laravel
 * dentro del núcleo agnóstico por la puerta de atrás.
 *
 * Quien compone la aplicación decide si inyecta un fallback y cuál. Sin
 * fallback, un proyecto no reconocido devuelve cero endpoints — que es
 * una respuesta honesta, no un error.
 */
import type { EndpointSpec } from "./postman.interface.js";
import type { ParsedRoute } from "./scanner.interface.js";
import type { ProjectConfig } from "./project-config.interface.js";
import type { IProjectContext } from "./project-context.interface.js";

/** Lo que devuelve un intento de descubrimiento de último recurso. */
export interface ILegacyDiscoveryResult {
  readonly specs: ReadonlyArray<EndpointSpec>;
  readonly routes: ReadonlyArray<ParsedRoute>;
  /** Endpoints cuyas reglas de validación se resolvieron. */
  readonly withValidation: number;
  readonly withoutValidation: number;
}

/** Estrategia de descubrimiento para proyectos que ningún scanner reconoce. */
export interface ILegacyDiscovery {
  /** Nombre para trazas y para el campo `origin` del resultado. */
  readonly name: string;
  discover(
    config: ProjectConfig,
    manualEndpoints: ReadonlyArray<EndpointSpec>,
    context: IProjectContext,
  ): Promise<ILegacyDiscoveryResult>;
}
