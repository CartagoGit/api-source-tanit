/**
 * `get-schema.handler.ts` — request schema for a single endpoint.
 *
 * Surfaces the `EndpointSpec.fields` projection (the field-level
 * request schema the framework scanner produced). When the
 * endpoint has no `fields` (e.g. a POST that takes a raw JSON
 * blob with no validation rules), the response is
 * `{ kind: "none" }` rather than an error — the schema may be
 * absent without the endpoint being broken.
 */

import type { IHandler } from "./dispatcher.js";
import {
  GetSchemaInputSchema,
  type GetSchemaInput,
} from "./zod-schemas.js";
import { getSession } from "../session/project-session.service.js";
import { apiError } from "./error.js";

/** Schema kind — the most useful discrimination the UI / exporter can make. */
export type IRequestSchema =
  | { readonly kind: "fields"; readonly fields: ReadonlyArray<unknown> }
  | { readonly kind: "body"; readonly body: unknown }
  | { readonly kind: "none" };

export interface GetSchemaOutput {
  readonly schema: IRequestSchema;
}

export function createGetSchemaHandler(): IHandler<GetSchemaInput, GetSchemaOutput> {
  return {
    name: "get-schema",
    input: GetSchemaInputSchema,
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
            const specRecord = spec as unknown as {
              fields?: ReadonlyArray<unknown>;
              body?: unknown;
            };
            if (specRecord.fields && specRecord.fields.length > 0) {
              return {
                schema: { kind: "fields", fields: specRecord.fields },
              };
            }
            if (specRecord.body !== undefined && specRecord.body !== null) {
              return {
                schema: { kind: "body", body: specRecord.body },
              };
            }
            return { schema: { kind: "none" } };
          }
        }
      }
      throw apiError(
        "OPERATION_NOT_FOUND",
        `No endpoint for ${input.method.toUpperCase()} ${input.uri}`,
      );
    },
  };
}