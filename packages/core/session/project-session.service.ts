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
import { generateCollections } from "../discovery/generation.pipeline.js";
import { newSessionId } from "./session-id.js";
import {
  SessionAbortedError,
  SessionClosedError,
} from "./session-error.js";
import { makeSnapshot, type IProjectSnapshot } from "./project-snapshot.js";
import type {
  SessionEventName,
  SessionEventPayload,
} from "./session-events.js";
import type { IGenerationOptions } from "../../contracts/interfaces/core/discovery.interface.js";

/** Minimal AbortSignal interface required by the session layer. */
interface IAbortSignal {
  readonly aborted: boolean;
}

/** Options for `ProjectSession.open()`. */
export interface IProjectSessionOptions {
  /** If provided, the scan can be cancelled. */
  readonly signal?: IAbortSignal;
  /** Passed through to `generateCollections`. */
  readonly generationOptions: IGenerationOptions;
  /**
   * Enable file-system watch. When `true`, the session subscribes to
   * source-file changes and emits `snapshot-stale` / `snapshot-ready`.
   * Defaults to `false`.
   */
  readonly watch?: boolean;
  /**
   * Debounce window in milliseconds for watch re-scans.
   * Defaults to 500.
   */
  readonly watchDebounceMs?: number;
}

type EventHandler<K extends SessionEventName> = (
  payload: SessionEventPayload<K>,
) => void;

/** A live session for a single project root. */
export interface IProjectSession {
  readonly id: string;
  readonly projectRoot: string;
  /** Returns the latest snapshot. Throws `SessionClosedError` if closed. */
  current(): IProjectSnapshot;
  /** Subscribe to session events. */
  on<K extends SessionEventName>(
    event: K,
    handler: EventHandler<K>,
  ): void;
  /** Unsubscribe. */
  off<K extends SessionEventName>(
    event: K,
    handler: EventHandler<K>,
  ): void;
  /**
   * Release resources (file watchers).
   * After `close()`, `current()` throws `SessionClosedError`.
   */
  close(): void;
}

/** Module-level registry: root → session (one per process). */
const _sessions = new Map<string, ProjectSessionImpl>();

/** Normalises a root path for use as a registry key. */
function normalizeRoot(root: string): string {
  return root.replace(/[/\\]+$/, "");
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
  private readonly _genOptions: IGenerationOptions;
  private readonly _watchDebounceMs: number;

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

    if (watchEnabled) {
      this._startWatch();
    }
  }

  current(): IProjectSnapshot {
    if (this._closed) throw new SessionClosedError(this.id);
    return this._snapshot!;
  }

  on<K extends SessionEventName>(event: K, handler: EventHandler<K>): void {
    if (!this._handlers.has(event)) {
      this._handlers.set(event, new Set());
    }
    this._handlers.get(event)!.add(handler as EventHandler<SessionEventName>);
  }

  off<K extends SessionEventName>(event: K, handler: EventHandler<K>): void {
    this._handlers.get(event)?.delete(handler as EventHandler<SessionEventName>);
  }

  close(): void {
    this._closed = true;
    this._watcher?.close();
    this._watcher = null;
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    _sessions.delete(normalizeRoot(this.projectRoot));
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
      try {
        const results = await generateCollections(
          this.projectRoot,
          this._genOptions,
        );
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
 * The first call triggers a full scan. Subsequent calls for the same
 * root return the existing session without scanning again.
 */
export async function openSession(
  projectRoot: string,
  options: IProjectSessionOptions,
): Promise<IProjectSession> {
  const { signal, generationOptions, watch: watchEnabled = false, watchDebounceMs = 500 } =
    options;

  if (signal?.aborted) {
    throw new SessionAbortedError(`(pre-open:${projectRoot})`);
  }

  const key = normalizeRoot(projectRoot);
  const existing = _sessions.get(key);
  if (existing) return existing;

  const id = newSessionId(projectRoot);

  // Run the scan.
  let results;
  try {
    results = await generateCollections(projectRoot, generationOptions);
  } catch (err) {
    if (signal?.aborted) throw new SessionAbortedError(id);
    throw err;
  }

  if (signal?.aborted) throw new SessionAbortedError(id);

  const snapshot = makeSnapshot({
    sessionId: id,
    projectRoot,
    results,
    diagnostics: [],
  });

  const session = new ProjectSessionImpl(
    id,
    projectRoot,
    snapshot,
    generationOptions,
    watchEnabled,
    watchDebounceMs,
  );

  _sessions.set(key, session);
  return session;
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
  for (const session of _sessions.values()) {
    session.close();
  }
  _sessions.clear();
}
