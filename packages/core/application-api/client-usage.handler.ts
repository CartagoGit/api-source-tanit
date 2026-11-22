import { isAbsolute } from "node:path";

import { ClientUsageInputSchema } from "../../contracts/constants/core/application-api.constant.js";
import type {
  ClientUsageInput,
  ClientUsageOutput,
} from "../../contracts/interfaces/core/application-api.interface.js";
import type { IDiscoveryOrchestrator } from "../../contracts/interfaces/core/scanner.interface.js";
import { analyzeClientProjects } from "../discovery/client-usage.service.js";
import type { IHandler } from "./dispatcher.js";
import { apiError } from "./error.js";

/** Reports observed frontend calls for the selected roots without opening a session. */
export function createClientUsageHandler(): IHandler<ClientUsageInput, ClientUsageOutput> {
  return {
    name: "client-usage",
    input: ClientUsageInputSchema,
    async handle(input, ctx) {
      if (!isAbsolute(input.projectRoot)) {
        throw apiError("INVALID_INPUT", "projectRoot must be an absolute path");
      }
      if (input.backendRoot !== undefined && !isAbsolute(input.backendRoot)) {
        throw apiError("INVALID_INPUT", "backendRoot must be an absolute path");
      }
      if (!ctx.orchestrator) {
        throw apiError("EXECUTION_FAILED", "client-usage requires ctx.orchestrator");
      }
      return analyzeClientProjects(input, ctx.orchestrator as IDiscoveryOrchestrator);
    },
  };
}
