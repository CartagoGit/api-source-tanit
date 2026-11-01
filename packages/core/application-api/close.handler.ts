/**
 * `close.handler.ts` — release a session (or all sessions).
 *
 * `close({ projectRoot })` releases the session for that root.
 * `close({})` is reserved for symmetry with future slices — today
 * it returns `INVALID_INPUT` so the caller picks the right verb
 * (`close` with a root, or a future `close-all`). The
 * `close-all` semantics live in `closeAllSessions()` from the
 * session layer.
 */

import type { IHandler } from "./dispatcher.js";
import { CloseInputSchema, type CloseInput } from "./zod-schemas.js";
import { getSession } from "../session/project-session.service.js";
import { apiError } from "./error.js";

/** Resultado de cerrar sesiones de proyecto. */
import type { CloseOutput } from "../../contracts/interfaces/core/application-api.interface.js";
export type { CloseOutput } from "../../contracts/interfaces/core/application-api.interface.js";

/** Crea el handler que cierra la sesión indicada. */
export function createCloseHandler(): IHandler<CloseInput, CloseOutput> {
  return {
    name: "close",
    input: CloseInputSchema,
    async handle(input) {
      if (!input.projectRoot) {
        throw apiError(
          "INVALID_INPUT",
          "close requires a projectRoot",
        );
      }
      const session = getSession(input.projectRoot);
      if (!session) {
        return { closed: 0 };
      }
      session.close();
      return { closed: 1 };
    },
  };
}