/**
 * `watch.handlers.ts` — subscribe to live snapshot deltas.
 *
 * The session layer exposes `on('snapshot-ready' | 'snapshot-stale')`.
 * This handler turns the caller's subscription into an
 * `subscriptionId` they can later pass to `cancel`. Subscriptions
 * are kept in a module-private map; the future event-sourcing
 * slice will back them with a durable queue.
 *
 * The handler itself does **not** buffer events for the caller —
 * it registers an `on()` handler on the session and the caller is
 * expected to consume the events out-of-band (the stdio / HTTP
 * bridge forwards them as they arrive). The handler returns the
 * subscription metadata immediately.
 */

import type { IHandler } from "./dispatcher.js";
import {
  WatchInputSchema,
  type WatchInput,
} from "./zod-schemas.js";
import { getSession } from "../session/project-session.service.js";
import { apiError } from "./error.js";
import { recordHistoryEntry } from "./history.handlers.js";

/** Public metadata about a live subscription. */
export interface WatchSubscription {
  readonly subscriptionId: string;
  readonly projectRoot: string;
  /** Filters the subscription declared at registration. */
  readonly onlyPaths: ReadonlyArray<string> | null;
}

const _subscriptions = new Map<string, WatchSubscription>();

let _subCounter = 0;
function newSubscriptionId(): string {
  return `sub:${(++_subCounter).toString(36)}`;
}

/** Internal: called by tests + by the future bridge to attach a subscription. */
export function registerSubscription(
  projectRoot: string,
  onlyPaths: ReadonlyArray<string> | null,
): WatchSubscription {
  const sub: WatchSubscription = {
    subscriptionId: newSubscriptionId(),
    projectRoot,
    onlyPaths,
  };
  _subscriptions.set(sub.subscriptionId, sub);

  // Wire the session events into the history buffer so callers
  // can `history()` after a watch has fired. The session itself
  // emits; the API just fans the event into the buffer.
  const session = getSession(projectRoot);
  if (session) {
    session.on("snapshot-ready", ({ snapshot }) => {
      recordHistoryEntry(snapshot.sessionId, {
        kind: "snapshot-ready",
        capturedAt: snapshot.capturedAt.toISOString(),
        sessionId: snapshot.sessionId,
      });
    });
    session.on("snapshot-stale", ({ changedPaths }) => {
      // Filter out paths the subscription does not care about.
      if (onlyPaths && onlyPaths.length > 0) {
        const matches = changedPaths.some((p) =>
          onlyPaths.some((needle) => p.includes(needle)),
        );
        if (!matches) return;
      }
      recordHistoryEntry(session.id, {
        kind: "snapshot-stale",
        capturedAt: new Date().toISOString(),
        changedPaths: [...changedPaths],
      });
    });
  }
  return sub;
}

/** Internal: tests + cancel handler clear this map. */
export function clearSubscriptions(): void {
  _subscriptions.clear();
}

/** Internal: drop a single subscription by id. Returns true if it existed. */
export function dropSubscriptionById(id: string): boolean {
  return _subscriptions.delete(id);
}

/** Internal: read-only view of the live subscriptions. */
export function listSubscriptions(): ReadonlyArray<WatchSubscription> {
  return [..._subscriptions.values()];
}

/** Resultado de crear una suscripción de vigilancia. */
export interface WatchOutput {
  readonly subscription: WatchSubscription;
}

/** Crea los handlers para suscribirse a cambios de un proyecto. */
export function createWatchHandlers(): {
  subscribe: IHandler<WatchInput, WatchOutput>;
} {
  return {
    subscribe: {
      name: "watch",
      input: WatchInputSchema,
      async handle(input) {
        const session = getSession(input.projectRoot);
        if (!session) {
          throw apiError(
            "SESSION_NOT_FOUND",
            `No open session for projectRoot "${input.projectRoot}"`,
          );
        }
        const sub = registerSubscription(
          input.projectRoot,
          input.onlyPaths ?? null,
        );
        return { subscription: sub };
      },
    },
  };
}