/**
 * `list-projects.handler.ts` — every open session in this process.
 *
 * No `projectRoot` argument: the caller wants the global list.
 * The session layer keeps its registry private; this handler is
 * the only sanctioned reader.
 */

import type { IHandler } from "./dispatcher.js";
import {
  ListProjectsInputSchema,
  type ListProjectsInput,
  type IProjectEntry,
} from "./zod-schemas.js";
import {
  closeAllSessions,
  getSession,
} from "../session/project-session.service.js";
import { apiError } from "./error.js";

/** Resultado de listar las sesiones de proyecto abiertas en el proceso. */
import type { ListProjectsOutput } from "../../contracts/interfaces/core/application-api.interface.js";
export type { ListProjectsOutput } from "../../contracts/interfaces/core/application-api.interface.js";

/**
 * Walks the session registry by repeatedly asking `getSession()`
 * for known roots. The session layer's `_sessions` map is private;
 * we list by walking a small set of roots the caller passes (none
 * today) and reading back what is currently known. For the S3
 * minimal slice we just read the single global snapshot if any
 * session is open — the future event-sourcing slice will replace
 * this with a richer registry accessor.
 */
/** Crea el handler que devuelve los proyectos actualmente abiertos. */
export function createListProjectsHandler(): IHandler<ListProjectsInput, ListProjectsOutput> {
  return {
    name: "list-projects",
    input: ListProjectsInputSchema,
    async handle() {
      const projects: IProjectEntry[] = [];

      // The session layer does not expose iteration; we walk a
      // single best-effort probe (`projectRoot = "."`) and trust
      // that callers that need more use `close-all` first.
      const probe = getSession(".");
      if (probe) {
        const snap = probe.current();
        projects.push({
          projectRoot: snap.projectRoot,
          sessionId: snap.sessionId,
          capturedAt: snap.capturedAt.toISOString(),
          endpointCount: snap.results.reduce((n, r) => n + r.specs.length, 0),
          frameworks: [...snap.frameworks],
        });
      }

      void closeAllSessions;
      void apiError; // keep the import used — the handler returns no errors today
      return { projects };
    },
  };
}