import { isAbsolute } from "node:path";

import { ClientLinksInputSchema } from "../../contracts/constants/core/application-api.constant.js";
import type {
  ClientLinksInput,
  ClientLinksOutput,
} from "../../contracts/interfaces/core/application-api.interface.js";
import type { IDiscoveryOrchestrator } from "../../contracts/interfaces/core/scanner.interface.js";
import { analyzeClientProjectLinks } from "../discovery/client-usage.service.js";
import type { IHandler } from "./dispatcher.js";
import { apiError } from "./error.js";

/** Reports observed calls and compares explicitly selected project links. */
export function createClientLinksHandler(): IHandler<ClientLinksInput, ClientLinksOutput> {
  return {
    name: "client-links",
    input: ClientLinksInputSchema,
    async handle(input, ctx) {
      if (input.frontends.some(({ root }) => !isAbsolute(root))) {
        throw apiError("INVALID_INPUT", "Each frontend root must be an absolute path");
      }
      if (input.links.some(({ frontendRoot, backendRoot }) => !isAbsolute(frontendRoot) || !isAbsolute(backendRoot))) {
        throw apiError("INVALID_INPUT", "Each link's frontendRoot and backendRoot must be absolute paths");
      }
      if (!ctx.orchestrator) {
        throw apiError("EXECUTION_FAILED", "client-links requires ctx.orchestrator");
      }
      return analyzeClientProjectLinks(input, ctx.orchestrator as IDiscoveryOrchestrator);
    },
  };
}
