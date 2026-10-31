import { Injectable, computed, inject, signal } from "@angular/core";

import { HostBridgeClient } from "../api/host-bridge.client";
import type {
  ISnapshotSummary,
  OpenProjectOutput,
  SnapshotOutput,
} from "../../../../../contracts/interfaces/core/application-api.interface";

/**
 * The open project.
 *
 * ## What was broken
 *
 * `open(path)` set two signals — the path and the folder's name — and
 * that was all. It never told the backend anything.
 *
 * That is not a cosmetic gap. The Application API is **session
 * based**: every handler that reads a project looks the session up by
 * its root, and without one it answers `SESSION_NOT_FOUND`. So the
 * app could show a project name while every single operation it
 * asked for failed. The screens that looked like they were working
 * were working on a name.
 *
 * ## What it does now
 *
 * Opening a project **is** opening a session: the backend scans it,
 * and the answer carries the summary the whole app draws from — the
 * frameworks it recognized, how many endpoints it found, how many
 * services. The store keeps the session id so the rest of the app
 * can tell "this project is open" from "this project is a name on
 * the screen".
 */
@Injectable({ providedIn: "root" })
export class ProjectStore {
  private readonly bridge = inject(HostBridgeClient);

  /** The root of the open project, or `null` when none is open. */
  readonly projectRoot = signal<string | null>(null);
  /** The session the backend opened for it. */
  readonly sessionId = signal<string | null>(null);
  /** The name to draw — the folder's name, until the backend says otherwise. */
  readonly projectName = signal("Tanit");
  /** What the backend found. */
  readonly summary = signal<ISnapshotSummary | null>(null);
  /** Whether a scan is in flight. */
  readonly loading = signal(false);
  /** The last failure, in words a person can read. */
  readonly error = signal<string | null>(null);

  /** Whether a project is really open — a session, not a name. */
  readonly isOpen = computed(() => this.sessionId() !== null);

  /**
   * Opens a project: scans it, and remembers the session.
   *
   * A failure leaves the app **closed** rather than half-open. A
   * project with a name on the screen and no session behind it is
   * the state this store used to be in all the time, and every
   * operation from it failed.
   */
  async open(path: string): Promise<boolean> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const answer: OpenProjectOutput = await this.bridge.request("open-project", {
        projectRoot: path,
      });
      this.projectRoot.set(answer.summary.projectRoot);
      this.sessionId.set(answer.sessionId);
      this.summary.set(answer.summary);
      this.projectName.set(nameOf(answer.summary.projectRoot));
      return true;
    } catch (error) {
      this.closeLocally();
      this.error.set(describe(error));
      return false;
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Closes the project.
   *
   * The backend is told first, so the session stops being kept alive;
   * but the local state is cleared either way. A close that fails
   * on the server must not leave the app showing a project that is
   * no longer usable.
   */
  async close(): Promise<void> {
    const projectRoot = this.projectRoot();
    if (projectRoot !== null) {
      try {
        await this.bridge.request("close", { projectRoot });
      } catch (error) {
        this.error.set(describe(error));
      }
    }
    this.closeLocally();
  }

  /**
   * Asks the backend what the project looks like **now**.
   *
   * This is what "rescan" means: the session watches the files, and
   * the snapshot it holds may be older than the project on disk.
   */
  async refresh(): Promise<void> {
    const projectRoot = this.projectRoot();
    if (projectRoot === null) return;
    this.loading.set(true);
    try {
      const answer: SnapshotOutput = await this.bridge.request("snapshot", { projectRoot });
      this.summary.set(answer.summary);
    } catch (error) {
      this.error.set(describe(error));
    } finally {
      this.loading.set(false);
    }
  }

  private closeLocally(): void {
    this.projectRoot.set(null);
    this.sessionId.set(null);
    this.summary.set(null);
    this.projectName.set("Tanit");
  }
}

/** The name to draw: the folder's name. */
function nameOf(projectRoot: string): string {
  return projectRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? "Tanit";
}

/** The message of a failure, in words a person can read. */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
