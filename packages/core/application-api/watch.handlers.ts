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
import type { IProjectSession, SnapshotReadyEvent, SnapshotStaleEvent } from "../../contracts/interfaces/core/session.interface.js";
import { getSession } from "../session/project-session.service.js";
import { apiError } from "./error.js";
import { recordHistoryEntry } from "./history.handlers.js";

/** Public metadata about a live subscription. */
import type { WatchOutput, WatchSubscription } from "../../contracts/interfaces/core/application-api.interface.js";
export type { WatchOutput, WatchSubscription } from "../../contracts/interfaces/core/application-api.interface.js";

const _subscriptions = new Map<string, WatchSubscription>();
const _subscriptionSessions = new Map<string, string>();
const _sessionCleanups = new Map<string, () => void>();

/** Attach one history observer per session, shared by its subscribers. */
function observeSession(session: IProjectSession): void {
  if (_sessionCleanups.has(session.id)) return;
  const activeSubscriptions = () => [..._subscriptions.values()].filter(
    (sub) => _subscriptionSessions.get(sub.subscriptionId) === session.id,
  );
  const ready = ({ snapshot }: SnapshotReadyEvent) => {
    if (activeSubscriptions().length === 0) return;
    recordHistoryEntry(snapshot.sessionId, {
      kind: "snapshot-ready",
      capturedAt: snapshot.capturedAt.toISOString(),
      sessionId: snapshot.sessionId,
    });
  };
  const stale = ({ changedPaths }: SnapshotStaleEvent) => {
    const matches = activeSubscriptions().some(({ onlyPaths }) =>
      !onlyPaths?.length || changedPaths.some((path) =>
        onlyPaths.some((needle) => path.includes(needle)),
      ),
    );
    if (!matches) return;
    recordHistoryEntry(session.id, {
      kind: "snapshot-stale",
      capturedAt: new Date().toISOString(),
      changedPaths: [...changedPaths],
    });
  };
  const closed = () => {
    for (const [id, sessionId] of _subscriptionSessions) {
      if (sessionId === session.id) dropSubscriptionById(id);
    }
  };
  session.on("session-closed", closed);
  session.on("snapshot-ready", ready);
  session.on("snapshot-stale", stale);
  _sessionCleanups.set(session.id, () => {
    session.off("session-closed", closed);
    session.off("snapshot-ready", ready);
    session.off("snapshot-stale", stale);
  });
}

let _subCounter = 0;
function newSubscriptionId(): string {
  return `sub:${(++_subCounter).toString(36)}`;
}

/** Internal: called by tests + by the future bridge to attach a subscription. */
export function registerSubscription(
  projectRoot: string,
  onlyPaths: ReadonlyArray<string> | null,
): WatchSubscription {
  const session = getSession(projectRoot);
  const sub: WatchSubscription = {
    subscriptionId: newSubscriptionId(),
    projectRoot: session?.projectRoot ?? projectRoot,
    onlyPaths,
  };
  _subscriptions.set(sub.subscriptionId, sub);
  if (session) {
    _subscriptionSessions.set(sub.subscriptionId, session.id);
    observeSession(session);
  }
  return sub;
}

/** Internal: tests + cancel handler clear this map. */
export function clearSubscriptions(): void {
  for (const dispose of _sessionCleanups.values()) dispose();
  _sessionCleanups.clear();
  _subscriptionSessions.clear();
  _subscriptions.clear();
}

/** Internal: drop a single subscription by id. Returns true if it existed. */
export function dropSubscriptionById(id: string): boolean {
  const existed = _subscriptions.delete(id);
  const sessionId = _subscriptionSessions.get(id);
  _subscriptionSessions.delete(id);
  if (sessionId && ![..._subscriptionSessions.values()].includes(sessionId)) {
    _sessionCleanups.get(sessionId)?.();
    _sessionCleanups.delete(sessionId);
  }
  return existed;
}

/** Release only this project's subscriptions, preserving other open projects. */
export function dropSubscriptionsForProject(projectRoot: string): void {
  const root = getSession(projectRoot)?.projectRoot ?? projectRoot;
  for (const sub of _subscriptions.values()) {
    if (sub.projectRoot === root) dropSubscriptionById(sub.subscriptionId);
  }
}

/** Internal: read-only view of the live subscriptions. */
export function listSubscriptions(): ReadonlyArray<WatchSubscription> {
  return [..._subscriptions.values()];
}

/** Resultado de crear una suscripción de vigilancia. */
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