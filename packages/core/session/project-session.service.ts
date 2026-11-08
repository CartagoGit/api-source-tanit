/**
 * ProjectSession — single scan per project, immutable snapshot, watch stub.
 *
 * A session wraps the discovery pipeline so that multiple CLI commands
 * (`inspect`, `generate`, `list-endpoints`, `check`) can share the same
 * scan result instead of each triggering a full pipeline run.
 *
 * ## Idempotency
 * Calling `open()` a second time for the same root returns the already-open
 * session (same `sessionId`). The map is held in process memory; it is reset
 * on process restart or on `closeAll()`.
 *
 * ## AbortSignal
 * Pass `signal` to cancel the scan in flight. If the signal is already aborted
 * when `open()` is called, `SessionAbortedError` is thrown immediately.
 *
 * ## Watch
 * `session.on('snapshot-stale', cb)` fires when a watched file changes.
 * `session.on('snapshot-ready', cb)` fires after a re-scan completes.
 * The watch is a lightweight `fs.watch` over the project root; it only
 * triggers a rescan once per debounce window (500 ms).
 */

import { watch as fsWatch } from "node:fs";
import { join, parse, sep } from "node:path";
import { generateCollections } from "../discovery/generation.pipeline.js";
import { newSessionId } from "./session-id.js";
import {
  SessionAbortedError,
  SessionClosedError,
} from "./session-error.js";
import { makeSnapshot, type IProjectSnapshot } from "./project-snapshot.js";
import type { SessionEventName, SessionEventPayload } from "./session-events.js";
import type { IGenerationOptions } from "../../contracts/interfaces/core/discovery.interface.js";

export type { IProjectSessionOptions, IProjectSession } from "../../contracts/interfaces/core/session.interface.js";
import type { IProjectSession, IProjectSessionOptions, IProjectSessionSettings } from "../../contracts/interfaces/core/session.interface.js";

type EventHandler<K extends SessionEventName> = (
  payload: SessionEventPayload<K>,
) => void;

/** Module-level registry: root → session (one per process). */
const _sessions = new Map<string, ProjectSessionImpl>();

/** Pending scans are shared until they succeed, fail or are explicitly cancelled. */
const _openings = new Map<string, {
  readonly promise: Promise<IProjectSession>;
  readonly signals: Array<IProjectSessionOptions["signal"]>;
}>();

/** Lexically canonical roots; no filesystem lookup or implicit working directory. */
function normalizeRoot(root: string): string {
  let normalized = join(root);
  const rootLength = parse(normalized).root.length;
  while (normalized.length > rootLength && normalized.endsWith(sep)) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

class ProjectSessionImpl implements IProjectSession {
  readonly id: string;
  readonly projectRoot: string;

  private _snapshot: IProjectSnapshot | null = null;
  private _closed = false;
  private _watcher: ReturnType<typeof fsWatch> | null = null;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly _handlers = new Map<
    SessionEventName,
    Set<EventHandler<SessionEventName>>
  >();
  private _genOptions: IGenerationOptions;
  private _watchDebounceMs: number;

  private _watchEnabled: boolean;
  private _configurationRevision = 0;
  private _settingsQueue: Promise<void> = Promise.resolve();

  constructor(
    id: string,
    projectRoot: string,
    snapshot: IProjectSnapshot,
    genOptions: IGenerationOptions,
    watchEnabled: boolean,
    watchDebounceMs: number,
  ) {
    this.id = id;
    this.projectRoot = projectRoot;
    this._snapshot = snapshot;
    this._genOptions = genOptions;
    this._watchDebounceMs = watchDebounceMs;
    this._watchEnabled = watchEnabled;

    if (watchEnabled) {
      this._startWatch();
    }
  }

  current(): IProjectSnapshot {
    if (this._closed) throw new SessionClosedError(this.id);
    return this._snapshot!;
  }

  settings(): IProjectSessionSettings {
    if (this._closed) throw new SessionClosedError(this.id);
    return Object.freeze({
      ...(this._genOptions.collectionName === undefined
        ? {} : { collectionName: this._genOptions.collectionName }),
      watch: this._watchEnabled,
      watchDebounceMs: this._watchDebounceMs,
    });
  }

  configure(
    patch: Partial<IProjectSessionSettings>,
    signal?: IProjectSessionOptions["signal"],
  ): Promise<IProjectSessionSettings> {
    const pending = this._settingsQueue.then(() => this._configure(patch, signal));
    // A failed change must not poison later settings requests.
    this._settingsQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async _configure(
    patch: Partial<IProjectSessionSettings>,
    signal: IProjectSessionOptions["signal"],
  ): Promise<IProjectSessionSettings> {
    if (this._closed) throw new SessionClosedError(this.id);
    if (signal?.aborted) throw new SessionAbortedError(this.id);
    const generationOptions = {
      ...this._genOptions,
      ...(patch.collectionName === undefined ? {} : { collectionName: patch.collectionName }),
    };
    const generationChanged = patch.collectionName !== undefined &&
      patch.collectionName !== this._genOptions.collectionName;
    const nextSnapshot = generationChanged
      ? makeSnapshot({
        sessionId: this.id,
        projectRoot: this.projectRoot,
        results: await generateCollections(this.projectRoot, generationOptions),
        diagnostics: [],
      })
      : this.current();
    // Commit only after the candidate is complete and the request is still live.
    if (this._closed) throw new SessionClosedError(this.id);
    if (signal?.aborted) throw new SessionAbortedError(this.id);
    const watchEnabled = patch.watch ?? this._watchEnabled;
    const watchChanged = watchEnabled !== this._watchEnabled;
    this._genOptions = generationOptions;
    this._snapshot = nextSnapshot;
    this._watchEnabled = watchEnabled;
    this._watchDebounceMs = patch.watchDebounceMs ?? this._watchDebounceMs;
    if (generationChanged || (watchChanged && !watchEnabled)) {
      this._configurationRevision++;
      if (this._debounceTimer !== null) clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    if (watchChanged) {
      this._watcher?.close();
      this._watcher = null;
      if (watchEnabled) this._startWatch();
    }
    if (generationChanged) this._emit("snapshot-ready", { snapshot: nextSnapshot });
    return this.settings();
  }

  on<K extends SessionEventName>(event: K, handler: EventHandler<K>): void {
    if (this._closed) throw new SessionClosedError(this.id);
    if (!this._handlers.has(event)) {
      this._handlers.set(event, new Set());
    }
    this._handlers.get(event)!.add(handler as EventHandler<SessionEventName>);
  }

  off<K extends SessionEventName>(event: K, handler: EventHandler<K>): void {
    this._handlers.get(event)?.delete(handler as EventHandler<SessionEventName>);
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    const key = normalizeRoot(this.projectRoot);
    if (_sessions.get(key) === this) _sessions.delete(key);
    const errors: unknown[] = [];
    try {
      // Notify every owner even when another owner's disposal fails.
      const closed = [...(this._handlers.get("session-closed") ?? [])];
      for (const handler of closed) {
        try {
          handler({ sessionId: this.id, projectRoot: this.projectRoot });
        } catch (error) {
          errors.push(error);
        }
      }
    } finally {
      try {
        this._watcher?.close();
      } catch (error) {
        errors.push(error);
      } finally {
        this._watcher = null;
        if (this._debounceTimer !== null) clearTimeout(this._debounceTimer);
        this._debounceTimer = null;
        this._snapshot = null;
        this._handlers.clear();
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, `Session ${this.id} cleanup failed`);
  }

  private _emit<K extends SessionEventName>(
    event: K,
    payload: SessionEventPayload<K>,
  ): void {
    const set = this._handlers.get(event);
    if (!set) return;
    for (const h of set) {
      (h as EventHandler<K>)(payload);
    }
  }

  private _startWatch(): void {
    try {
      this._watcher = fsWatch(
        this.projectRoot,
        { recursive: true },
        (_eventType, filename) => {
          if (!filename || this._closed) return;
          const paths = [filename];
          this._emit("snapshot-stale", { changedPaths: paths });
          this._scheduleRescan(paths);
        },
      );
    } catch {
      // Watch not supported on this platform — skip silently.
    }
  }

  private _scheduleRescan(_changedPaths: string[]): void {
    if (this._debounceTimer !== null) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(async () => {
      this._debounceTimer = null;
      if (this._closed) return;
      const revision = this._configurationRevision;
      try {
        const results = await generateCollections(
          this.projectRoot,
          this._genOptions,
        );
        if (this._closed || revision !== this._configurationRevision) return;
        this._snapshot = makeSnapshot({
          sessionId: this.id,
          projectRoot: this.projectRoot,
          results,
          diagnostics: [],
        });
        this._emit("snapshot-ready", { snapshot: this._snapshot });
      } catch {
        // Re-scan errors are silent; the stale snapshot is kept.
      }
    }, this._watchDebounceMs);
  }
}

/**
 * Opens (or returns) a session for `projectRoot`.
 *
 * Concurrent calls share one scan and use the first caller's configuration.
 * Each caller retains its own abort signal. Roots are normalized lexically,
 * without resolving relative paths or requiring filesystem existence.
 * Later calls return the registered session without scanning again.
 */
export async function openSession(
  projectRoot: string,
  options: IProjectSessionOptions,
): Promise<IProjectSession> {
  const { signal } = options;
  if (signal?.aborted) {
    throw new SessionAbortedError(`(pre-open:${projectRoot})`);
  }
  const key = normalizeRoot(projectRoot);
  const existing = _sessions.get(key);
  if (existing) return existing;

  let opening = _openings.get(key);
  if (opening) {
    opening.signals.push(signal);
  } else {
    const signals = [signal];
    const id = newSessionId(key);
    const { generationOptions, watch: watchEnabled = false, watchDebounceMs = 500 } = options;
    // Defer the scan until its ownership entry is installed, including for a
    // synchronously throwing scanner. Initial options follow the first opener.
    const scan: Promise<IProjectSession> = Promise.resolve().then(async () => {
      if (_openings.get(key)?.promise !== pending || signals.every((value) => value?.aborted)) {
        throw new SessionAbortedError(id);
      }
      let results;
      try {
        results = await generateCollections(key, generationOptions);
      } catch (error) {
        if (_openings.get(key)?.promise !== pending || signals.every((value) => value?.aborted)) {
          throw new SessionAbortedError(id);
        }
        throw error;
      }
      if (_openings.get(key)?.promise !== pending || signals.every((value) => value?.aborted)) {
        throw new SessionAbortedError(id);
      }
      const snapshot = makeSnapshot({ sessionId: id, projectRoot: key, results, diagnostics: [] });
      const session = new ProjectSessionImpl(
        id, key, snapshot, generationOptions, watchEnabled, watchDebounceMs,
      );
      _sessions.set(key, session);
      return session;
    });
    const pending = scan.finally(() => {
      // A cancelled scan may finish after a newer opening has taken its key.
      if (_openings.get(key)?.promise === pending) _openings.delete(key);
    });
    opening = { promise: pending, signals };
    _openings.set(key, opening);
  }
  const session = await opening.promise;
  // Cancelling one caller does not discard a shared session another caller needs.
  if (signal?.aborted || _sessions.get(key) !== session) throw new SessionAbortedError(session.id);
  return session;
}

/** Cancels a pending open without letting its eventual scan resurrect a session. */
export function cancelSessionOpening(projectRoot: string): boolean {
  const key = normalizeRoot(projectRoot);
  if (!_openings.delete(key)) return false;
  // The scan may have published just before its promise reaches the caller.
  _sessions.get(key)?.close();
  return true;
}

/**
 * Returns the open session for `projectRoot`, or `null` if none exists.
 *
 * Useful for CLI commands that want to reuse an existing session without
 * starting a new scan.
 */
export function getSession(projectRoot: string): IProjectSession | null {
  return _sessions.get(normalizeRoot(projectRoot)) ?? null;
}

/**
 * Closes all active sessions and resets the registry.
 *
 * Intended for use in tests.
 */
export function closeAllSessions(): void {
  _openings.clear();
  const errors: unknown[] = [];
  for (const session of [..._sessions.values()]) {
    try {
      session.close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, "Session cleanup failed");
}
