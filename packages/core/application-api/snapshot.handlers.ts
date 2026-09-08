/**
 * `snapshot.handlers.ts` — current snapshot accessor.
 *
 * Returns the immutable snapshot of the requested project. The
 * handler does not transform the snapshot: the Web UI and CLI both
 * already speak the projection in `zod-schemas.ts`; the underlying
 * `IProjectSnapshot` (session layer) is the canonical shape and
 * the API passes it through unchanged.
 *
 * Two handlers ship in this file because they share the same
 * "look up the session, return the snapshot" pattern:
 *
 *   - `snapshot`     → registered under that name in `handlers.ts`.
 *   - `snapshot-all` → optional helper, not registered by default.
 */

import type { IHandler } from "./dispatcher.js";
import {
  SnapshotInputSchema,
  type SnapshotInput,
  type ISnapshotSummary,
} from "./zod-schemas.js";
import { getSession } from "../session/project-session.service.js";
import { apiError } from "./error.js";

/** Resultado de resumir el snapshot actual de una sesión. */
export interface SnapshotOutput {
  readonly summary: ISnapshotSummary;
}

/** Crea los handlers para consultar el snapshot actual. */
export function createSnapshotHandlers(): {
  current: IHandler<SnapshotInput, SnapshotOutput>;
} {
  return {
    current: {
      name: "snapshot",
      input: SnapshotInputSchema,
      async handle(input) {
        const session = getSession(input.projectRoot);
        if (!session) {
          throw apiError(
            "SESSION_NOT_FOUND",
            `No open session for projectRoot "${input.projectRoot}"`,
          );
        }
        let snap;
        try {
          snap = session.current();
        } catch (err) {
          throw apiError("SESSION_NOT_FOUND", (err as Error).message);
        }
        const summary: ISnapshotSummary = {
          sessionId: snap.sessionId,
          projectRoot: snap.projectRoot,
          capturedAt: snap.capturedAt.toISOString(),
          frameworks: [...snap.frameworks],
          endpointCount: snap.results.reduce(
            (n, r) => n + r.specs.length,
            0,
          ),
          serviceCount: new Set(
            snap.results.map((r) => r.serviceId ?? "default"),
          ).size,
        };
        return { summary };
      },
    },
  };
}