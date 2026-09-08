/**
 * `history.handlers.ts` — read the snapshot deltas the session
 * recorded since it opened.
 *
 * The session layer (f00016 S1) emits `snapshot-ready` and
 * `snapshot-stale` events. This handler keeps a small in-memory
 * ring buffer per session and lets the caller read it back. The
 * buffer is reset when the session closes — callers that need a
 * persistent log use the future event-sourcing slice.
 */

import type { IHandler } from "./dispatcher.js";
import {
  HistoryInputSchema,
  type HistoryInput,
} from "./zod-schemas.js";
import { getSession } from "../session/project-session.service.js";
import { apiError } from "./error.js";
import type { IProjectSnapshot } from "../session/project-snapshot.js";

/** A single history entry — what the session emitted. */
export type IHistoryEntry =
  | {
      readonly kind: "snapshot-ready";
      readonly capturedAt: string;
      readonly sessionId: string;
    }
  | {
      readonly kind: "snapshot-stale";
      readonly capturedAt: string;
      readonly changedPaths: ReadonlyArray<string>;
    };

/** Per-session ring buffer. Module-private — only `history.handlers.ts` writes. */
const _history = new Map<string, IHistoryEntry[]>();

/** Records an event into the ring buffer; keeps the last `limit` items. */
export function recordHistoryEntry(
  sessionId: string,
  entry: IHistoryEntry,
  limit = 100,
): void {
  const list = _history.get(sessionId) ?? [];
  list.push(entry);
  while (list.length > limit) list.shift();
  _history.set(sessionId, list);
}

/** Resultado de consultar el historial de eventos de una sesión. */
export interface HistoryOutput {
  readonly entries: ReadonlyArray<IHistoryEntry>;
  /** Total entries the buffer holds for this session. */
  readonly total: number;
}

const DEFAULT_HISTORY_LIMIT = 100;

/** Crea el handler que lista el historial reciente de una sesión. */
export function createHistoryHandlers(): {
  list: IHandler<HistoryInput, HistoryOutput>;
} {
  return {
    list: {
      name: "history",
      input: HistoryInputSchema,
      async handle(input) {
        const session = getSession(input.projectRoot);
        if (!session) {
          throw apiError(
            "SESSION_NOT_FOUND",
            `No open session for projectRoot "${input.projectRoot}"`,
          );
        }
        const snap: IProjectSnapshot = session.current();
        const all = _history.get(snap.sessionId) ?? [];
        const limit = input.limit ?? DEFAULT_HISTORY_LIMIT;
        return {
          entries: all.slice(-limit),
          total: all.length,
        };
      },
    },
  };
}