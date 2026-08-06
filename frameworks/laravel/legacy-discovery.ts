/**
 * La heurística histórica de Laravel, empaquetada como estrategia.
 *
 * Antes de que existieran los scanners, esto **era** la herramienta:
 * leer `routes/*.php`, resolver los FormRequests de los controladores y
 * emitir endpoints. Hoy Laravel tiene su propio scanner, así que este
 * camino solo entra cuando ningún scanner reconoce el proyecto — un
 * Laravel con una disposición rara, básicamente.
 *
 * Se envuelve en `ILegacyDiscovery` para que el pipeline pueda
 * invocarlo sin conocerlo. Antes lo importaba directo, y con él se
 * colaba un parser de PHP dentro del núcleo agnóstico.
 */
import type {
  ILegacyDiscovery,
  ILegacyDiscoveryResult,
} from "../../contracts/legacy-discovery.interface.js";
import type { EndpointSpec } from "../../contracts/postman.interface.js";
import type { ProjectConfig } from "../../contracts/project-config.interface.js";
import type { IProjectContext } from "../../contracts/project-context.interface.js";
import { discoverEndpoints } from "./endpoint-discovery.service.js";

/** Descubrimiento de último recurso sobre `routes/*.php`. */
export const laravelLegacyDiscovery: ILegacyDiscovery = {
  name: "laravel-legacy",

  async discover(
    config: ProjectConfig,
    manualEndpoints: ReadonlyArray<EndpointSpec>,
    context: IProjectContext,
  ): Promise<ILegacyDiscoveryResult> {
    const result = await discoverEndpoints(config, [...manualEndpoints], context);
    return {
      specs: result.specs,
      routes: result.routes,
      withValidation: result.withFormRequest,
      withoutValidation: result.withoutFormRequest,
    };
  },
};
