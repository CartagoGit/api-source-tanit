/**
 * Typed errors emitted by the session layer.
 */

/** The session was closed before the caller consumed the snapshot. */
export class SessionClosedError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super(`Session ${sessionId} is closed`);
    this.name = "SessionClosedError";
    this.sessionId = sessionId;
  }
}

/** A scan was already in progress when `open()` was called again. */
export class SessionAlreadyOpenError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super(`Session ${sessionId} is already open`);
    this.name = "SessionAlreadyOpenError";
    this.sessionId = sessionId;
  }
}

/** The scan was aborted via `AbortSignal`. */
export class SessionAbortedError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super(`Session ${sessionId} was aborted`);
    this.name = "SessionAbortedError";
    this.sessionId = sessionId;
  }
}
