/**
 * `get-endpoint.handler.ts` — fetch a single endpoint from a snapshot.
 *
 * The lookup is `(method, uri)` keyed; if the snapshot has multiple
 * services, all of them are searched and the first match wins.
 * Future slices can refine this with a `serviceId` argument.
 */

import type { IHandler } from "./dispatcher.js";
import {
  GetEndpointInputSchema,
  type GetEndpointInput,
} from "./zod-schemas.js";
import { getSession } from "../session/project-session.service.js";
import { apiError } from "./error.js";
import type { EndpointSpec } from "../../contracts/interfaces/core/postman.interface.js";

/**
 * The full `EndpointSpec` shape is wider than `IEndpointSummary` —
 * callers that need every field (e.g. an OpenAPI exporter)
 * receive it here. The dispatcher does not validate against a
 * zod schema for the success output: passing an opaque object
 * through zod would lock down the underlying type and forbid
 * additive fields later.
 */
export interface GetEndpointOutput {
  readonly endpoint: EndpointSpec;
  readonly serviceId: string;
}

/** Crea el handler que obtiene un endpoint por método y URI. */
export function createGetEndpointHandler(): IHandler<GetEndpointInput, GetEndpointOutput> {
  return {
    name: "get-endpoint",
    input: GetEndpointInputSchema,
    async handle(input) {
      const session = getSession(input.projectRoot);
      if (!session) {
        throw apiError(
          "SESSION_NOT_FOUND",
          `No open session for projectRoot "${input.projectRoot}"`,
        );
      }
      const snap = session.current();
      const method = input.method.toUpperCase();

      for (const result of snap.results) {
        for (const spec of result.specs) {
          if (spec.method.toUpperCase() === method && spec.uri === input.uri) {
            return {
              endpoint: spec,
              serviceId: spec.serviceId ?? result.serviceId ?? "default",
            };
          }
        }
      }
      throw apiError(
        "OPERATION_NOT_FOUND",
        `No endpoint for ${input.method.toUpperCase()} ${input.uri}`,
        { projectRoot: input.projectRoot, method: input.method, uri: input.uri },
      );
    },
  };
}