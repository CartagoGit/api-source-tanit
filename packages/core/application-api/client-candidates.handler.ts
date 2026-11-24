import { isAbsolute } from "node:path";

import { ClientCandidatesInputSchema } from "../../contracts/constants/core/application-api.constant.js";
import type {
  ClientCandidatesInput,
  ClientCandidatesOutput,
} from "../../contracts/interfaces/core/application-api.interface.js";
import type { IDiscoveryOrchestrator } from "../../contracts/interfaces/core/scanner.interface.js";
import { inspectClientProjectCandidates } from "../discovery/client-usage.service.js";
import type { IHandler } from "./dispatcher.js";
import { apiError } from "./error.js";

/** Lists project or service candidates for an explicitly selected workspace root. */
export function createClientCandidatesHandler(): IHandler<ClientCandidatesInput, ClientCandidatesOutput> {
  return {
    name: "client-candidates",
    input: ClientCandidatesInputSchema,
    async handle({ projectRoot, role }, ctx) {
      if (!isAbsolute(projectRoot)) {
        throw apiError("INVALID_INPUT", "projectRoot must be an absolute path");
      }
      if (!ctx.orchestrator) {
        throw apiError("EXECUTION_FAILED", "client-candidates requires ctx.orchestrator");
      }
      return inspectClientProjectCandidates(projectRoot, role, ctx.orchestrator as IDiscoveryOrchestrator);
    },
  };
}
