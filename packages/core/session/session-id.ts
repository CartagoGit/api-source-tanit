/**
 * Generates stable, unique session identifiers.
 *
 * A session id combines the project root path (normalised so that
 * `/a/b/` and `/a/b` are the same session) with a monotonic counter
 * so that two concurrent sessions for the same root do not collide.
 */

let _counter = 0;

/**
 * Returns a new session id for the given `projectRoot`.
 *
 * The id is stable enough to log but is NOT a cryptographic token.
 */
export function newSessionId(projectRoot: string): string {
  const normalized = projectRoot.replace(/[/\\]+$/, "");
  return `session:${normalized}:${(++_counter).toString(36)}`;
}
