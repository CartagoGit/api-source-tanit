/**
 * `service-detail.handler.ts` — one service, with everything known
 * about it.
 *
 * ## What it answers
 *
 * The service's identity, the framework that recognized it, how many
 * endpoints it has, which transports its operations speak and how
 * many operations the explorer shows for it.
 *
 * ## Why the app cannot work it out on its own
 *
 * It used to: the client crossed the list of services with the list
 * of endpoints and filled the gaps. That is a **lie waiting to
 * happen**: the two lists are asked for separately, so a project
 * that changed between the two calls produced a detail that mixed
 * two moments. And the fields that could not be crossed — the base
 * URL, the auth reference — were invented, which is worse.
 *
 * Here the detail comes from **one** snapshot, in one read. What the
 * backend knows is what the app shows; what it does not know is not
 * shown at all.
 */
import type { IHandler } from "./dispatcher.js";
import {
  ServiceDetailInputSchema,
  type ServiceDetailInput,
} from "./zod-schemas.js";
import { requireResults, requireSession } from "./project-verbs.helper.js";
import { apiError } from "./error.js";
import type { ServiceDetailOutput } from "../../contracts/interfaces/core/application-api.interface.js";
export type { ServiceDetailOutput } from "../../contracts/interfaces/core/application-api.interface.js";
import type { IServiceDetail } from "../../contracts/interfaces/core/services.interface.js";

/** The transports a service's operations speak, without duplicates. */
function transportsOf(specs: ReadonlyArray<{ transport?: string }>): ReadonlyArray<string> {
  const transports = new Set<string>();
  for (const spec of specs) transports.add(spec.transport ?? "http");
  return [...transports].sort();
}

/** Crea el handler que describe un servicio del proyecto. */
export function createServiceDetailHandler(): IHandler<ServiceDetailInput, ServiceDetailOutput> {
  return {
    name: "service-detail",
    input: ServiceDetailInputSchema,
    async handle(input) {
      const session = requireSession(input.projectRoot);
      const snap = requireResults(session.current());

      const result = snap.results.find(
        (entry) => (entry.serviceId ?? "default") === input.serviceId,
      );
      if (!result) {
        throw apiError(
          "SERVICE_NOT_FOUND",
          `No service "${input.serviceId}" in projectRoot "${input.projectRoot}"`,
        );
      }

      const service: IServiceDetail = {
        serviceId: result.serviceId ?? "default",
        framework: result.match?.framework ?? "unknown",
        endpointCount: result.specs.length,
        transports: transportsOf(result.specs),
        operationCount: result.specs.length,
      };
      return { service };
    },
  };
}
