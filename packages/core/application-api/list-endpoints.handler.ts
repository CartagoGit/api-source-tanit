/**
 * `list-endpoints.handler.ts` — list the endpoints of a snapshot.
 *
 * Returns a flat array of `IEndpointSummary` after applying the
 * optional `method` and `uriContains` filters. Pagination is
 * cursor-based for forward compatibility (a future slice will
 * back it with a stable key); today the cursor is an offset into
 * the filtered list.
 */

import type { IHandler } from "./dispatcher.js";
import {
  ListEndpointsInputSchema,
  type ListEndpointsInput,
  type IEndpointSummary,
} from "./zod-schemas.js";
import { getSession } from "../session/project-session.service.js";
import { apiError } from "./error.js";

/** Resultado paginado de listar endpoints de un snapshot. */
export interface ListEndpointsOutput {
  readonly endpoints: ReadonlyArray<IEndpointSummary>;
  /** Next cursor; absent when the last page was returned. */
  readonly nextCursor: string | null;
  /** Total count after filtering — useful for "showing X of N" UIs. */
  readonly total: number;
}

const DEFAULT_LIMIT = 100;

/** Crea el handler paginado para consultar endpoints del snapshot actual. */
export function createListEndpointsHandler(): IHandler<ListEndpointsInput, ListEndpointsOutput> {
  return {
    name: "list-endpoints",
    input: ListEndpointsInputSchema,
    async handle(input) {
      const session = getSession(input.projectRoot);
      if (!session) {
        throw apiError(
          "SESSION_NOT_FOUND",
          `No open session for projectRoot "${input.projectRoot}"`,
        );
      }
      const snap = session.current();
      const method = input.method?.toUpperCase();
      const uriNeedle = input.uriContains;
      const limit = input.limit ?? DEFAULT_LIMIT;

      const all = snap.results.flatMap((r) =>
        r.specs.map((spec) => ({
          method: spec.method,
          uri: spec.uri,
          name: spec.name,
          serviceId: spec.serviceId ?? r.serviceId ?? "default",
        })),
      );
      const filtered = all.filter((e) => {
        if (method && e.method.toUpperCase() !== method) return false;
        if (uriNeedle && !e.uri.includes(uriNeedle)) return false;
        return true;
      });

      const start = input.cursor ? Number.parseInt(input.cursor, 10) || 0 : 0;
      const page = filtered.slice(start, start + limit);
      const next = start + limit < filtered.length ? String(start + limit) : null;

      return { endpoints: page, nextCursor: next, total: filtered.length };
    },
  };
}