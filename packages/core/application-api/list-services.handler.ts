/**
 * `list-services.handler.ts` — every service the snapshot discovered.
 *
 * A "service" here is one `IGenerationResult` from the pipeline:
 * flat projects return one entry; monorepos return one per
 * workspace the orchestrator detected. The framework slug comes
 * from `IProjectMatch.framework`; the `serviceId` is the
 * `IGenerationResult.serviceId` (x00028).
 */

import type { IHandler } from "./dispatcher.js";
import {
  ListServicesInputSchema,
  type ListServicesInput,
  type IServiceSummary,
} from "./zod-schemas.js";
import { getSession } from "../session/project-session.service.js";
import { apiError } from "./error.js";

export interface ListServicesOutput {
  readonly services: ReadonlyArray<IServiceSummary>;
}

export function createListServicesHandler(): IHandler<ListServicesInput, ListServicesOutput> {
  return {
    name: "list-services",
    input: ListServicesInputSchema,
    async handle(input) {
      const session = getSession(input.projectRoot);
      if (!session) {
        throw apiError(
          "SESSION_NOT_FOUND",
          `No open session for projectRoot "${input.projectRoot}"`,
        );
      }
      const snap = session.current();

      const services: IServiceSummary[] = snap.results.map((r) => ({
        serviceId: r.serviceId ?? "default",
        framework: r.match?.framework ?? "unknown",
        endpointCount: r.specs.length,
      }));
      return { services };
    },
  };
}