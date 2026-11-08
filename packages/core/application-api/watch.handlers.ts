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
import type { LiveEvent, LiveEventSink } from "../../contracts/interfaces/core/live.interface.js";
import { summarizeSnapshot } from "./snapshot-summary.helper.js";
import { recordHistoryEntry } from "./history.handlers.js";

/** Public metadata about a live subscription. */
import type { WatchOutput, WatchSubscription } from "../../contracts/interfaces/core/application-api.interface.js";
export type { WatchOutput, WatchSubscription } from "../../contracts/interfaces/core/application-api.interface.js";

const _subscriptions = new Map<string, WatchSubscription>();
const _subscriptionSessions = new Map<string, string>();
const _sessionCleanups = new Map<string, () => void>();
const _sinks = new Map<string, LiveEventSink>();
const _disconnectCleanups = new Map<string, () => void>();
const _managedWatches = new Map<string, IProjectSession>();
const _pendingSubscriptions = new Map<string, number>();

function restoreWatchIfUnused(sessionId: string): void {
  if ((_pendingSubscriptions.get(sessionId) ?? 0) > 0 ||
      [..._subscriptionSessions.values()].includes(sessionId)) return;
  const managed = _managedWatches.get(sessionId);
  if (!managed) return;
  if (getSession(managed.projectRoot) !== managed) {
    _managedWatches.delete(sessionId);
    return;
  }
  void managed.configure({ watch: false }).catch(() => undefined).finally(() => {
    if ((_pendingSubscriptions.get(sessionId) ?? 0) === 0 &&
        ![..._subscriptionSessions.values()].includes(sessionId) && _managedWatches.get(sessionId) === managed) {
      _managedWatches.delete(sessionId);
    }
  });
}

function send(subscription: WatchSubscription, event: LiveEvent): void {
  try { _sinks.get(subscription.subscriptionId)?.(event); }
  catch { dropSubscriptionById(subscription.subscriptionId); }
}

function snapshotEvent(session: IProjectSession, subscription: WatchSubscription, changedPaths: readonly string[] = []): LiveEvent {
  const snapshot = session.current();
  return {
    type: "snapshot-ready", subscriptionId: subscription.subscriptionId,
    sessionId: session.id, projectRoot: session.projectRoot,
    summary: summarizeSnapshot(snapshot), changedPaths,
    sourceFileCount: new Set(snapshot.results.flatMap((result) =>
      result.routes.map((route) => route.sourceFile),
    )).size,
  };
}

/** Attach one history observer per session, shared by its subscribers. */
function observeSession(session: IProjectSession): void {
  if (_sessionCleanups.has(session.id)) return;
  const changed = new Set<string>();
  const activeSubscriptions = () => [..._subscriptions.values()].filter(
    (sub) => _subscriptionSessions.get(sub.subscriptionId) === session.id,
  );
  const ready = ({ snapshot }: SnapshotReadyEvent) => {
    if (activeSubscriptions().length === 0) return;
    for (const sub of activeSubscriptions()) send(sub, snapshotEvent(session, sub, [...changed]));
    changed.clear();
    recordHistoryEntry(snapshot.sessionId, {
      kind: "snapshot-ready",
      capturedAt: snapshot.capturedAt.toISOString(),
      sessionId: snapshot.sessionId,
    });
  };
  const stale = ({ changedPaths }: SnapshotStaleEvent) => {
    for (const path of changedPaths) changed.add(path);
    const matching = activeSubscriptions().filter(({ onlyPaths }) =>
      !onlyPaths?.length || changedPaths.some((path) =>
        onlyPaths.some((needle) => path.includes(needle)),
      ),
    );
    if (matching.length === 0) return;
    for (const sub of matching) send(sub, {
      type: "snapshot-stale", subscriptionId: sub.subscriptionId,
      sessionId: session.id, projectRoot: session.projectRoot, changedPaths,
    });
    recordHistoryEntry(session.id, {
      kind: "snapshot-stale",
      capturedAt: new Date().toISOString(),
      changedPaths: [...changedPaths],
    });
  };
  const closed = () => {
    for (const [id, sessionId] of _subscriptionSessions) {
      if (sessionId === session.id) {
        const sub = _subscriptions.get(id);
        if (sub) send(sub, { type: "session-closed", subscriptionId: id,
          sessionId: session.id, projectRoot: session.projectRoot });
        dropSubscriptionById(id);
      }
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
  for (const id of [..._subscriptions.keys()]) dropSubscriptionById(id);
}

/** Internal: drop a single subscription by id. Returns true if it existed. */
export function dropSubscriptionById(id: string): boolean {
  const sub = _subscriptions.get(id);
  const sessionId = _subscriptionSessions.get(id);
  const sink = _sinks.get(id);
  const existed = _subscriptions.delete(id);
  _sinks.delete(id);
  if (sub && sessionId && sink) {
    try { sink({ type: "subscription-closed", subscriptionId: id,
      sessionId, projectRoot: sub.projectRoot }); } catch { /* Carrier already disconnected. */ }
  }
  _disconnectCleanups.get(id)?.();
  _disconnectCleanups.delete(id);
  _subscriptionSessions.delete(id);
  if (sessionId && ![..._subscriptionSessions.values()].includes(sessionId)) {
    _sessionCleanups.get(sessionId)?.();
    _sessionCleanups.delete(sessionId);
    restoreWatchIfUnused(sessionId);
  }
  return existed;
}

/** Attach one carrier to an existing subscription; disconnect owns its teardown. */
export function connectSubscriptionEvents(id: string, sink: LiveEventSink): () => void {
  const sub = _subscriptions.get(id);
  if (!sub) throw apiError("INVALID_INPUT", "Watch subscription does not exist");
  if (_sinks.has(id)) throw apiError("INVALID_INPUT", "Watch subscription already has a carrier");
  _disconnectCleanups.get(id)?.();
  _disconnectCleanups.delete(id);
  _sinks.set(id, sink);
  const session = getSession(sub.projectRoot);
  try { if (session) sink(snapshotEvent(session, sub)); }
  catch (error) { dropSubscriptionById(id); throw error; }
  return () => { dropSubscriptionById(id); };
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
      async handle(input, ctx) {
        const session = getSession(input.projectRoot);
        if (!session) {
          throw apiError(
            "SESSION_NOT_FOUND",
            `No open session for projectRoot "${input.projectRoot}"`,
          );
        }
        const managesWatch = !session.settings().watch || _managedWatches.has(session.id);
        if (managesWatch) _managedWatches.set(session.id, session);
        _pendingSubscriptions.set(session.id, (_pendingSubscriptions.get(session.id) ?? 0) + 1);
        try {
          // Always queue this behind any cancellation restoring watch=false.
          await session.configure({ watch: true }, ctx.signal);
          if (ctx.signal?.aborted || getSession(input.projectRoot) !== session) {
            throw apiError(ctx.signal?.aborted ? "CANCELED" : "SESSION_NOT_FOUND", "Watch session was cancelled");
          }
          const sub = registerSubscription(input.projectRoot, input.onlyPaths ?? null);
          if (ctx.emitEvent) _sinks.set(sub.subscriptionId, ctx.emitEvent);
          if (ctx.onDisconnect) {
            const detach = ctx.onDisconnect(() => { dropSubscriptionById(sub.subscriptionId); });
            if (_subscriptions.has(sub.subscriptionId)) _disconnectCleanups.set(sub.subscriptionId, detach);
            else detach();
          }
          return { subscription: sub };
        } catch (error) {
          if (ctx.signal?.aborted) throw apiError("CANCELED", "Watch request cancelled");
          throw error;
        } finally {
          const remaining = (_pendingSubscriptions.get(session.id) ?? 1) - 1;
          if (remaining > 0) _pendingSubscriptions.set(session.id, remaining);
          else _pendingSubscriptions.delete(session.id);
          restoreWatchIfUnused(session.id);
        }
      },
    },
  };
}