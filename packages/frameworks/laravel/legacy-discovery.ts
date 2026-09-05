/**
 * The historical Laravel heuristic, packaged as a strategy.
 *
 * Before scanners existed, this **was** the tool: read `routes/*.php`,
 * resolve the controllers' FormRequests, and emit endpoints. Today
 * Laravel has its own scanner, so this path only runs when no scanner
 * recognises the project — basically a Laravel with an unusual layout.
 *
 * It is wrapped in `ILegacyDiscovery` so the pipeline can invoke it
 * without knowing about it. Before, it was imported directly, and that
 * dragged a PHP parser into the agnostic core.
 */
import type {
  ILegacyDiscovery,
  ILegacyDiscoveryResult,
} from "../../contracts/interfaces/core/legacy-discovery.interface.js";
import type { EndpointSpec } from "../../contracts/interfaces/core/postman.interface.js";
import type { ProjectConfig } from "../../contracts/interfaces/core/project-config.interface.js";
import type { IProjectContext } from "../../contracts/interfaces/core/project-context.interface.js";
import { discoverEndpoints } from "./endpoint-discovery.service.js";

/** Last-resort discovery over `routes/*.php`. */
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
