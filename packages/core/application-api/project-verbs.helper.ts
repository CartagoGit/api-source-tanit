/**
 * The pieces the project verbs share.
 *
 * `check`, `validate` and `stats` all do the same four things:
 * find the open session, work out which collection they are talking
 * about, read it, and say clearly when they cannot.
 *
 * Doing that four times is how the four answers drift apart: one of
 * them says "no collection at ..." and another says "the file does
 * not exist", and the app cannot tell them apart. Here they are said
 * once.
 */
import { readCollection } from "../helpers/collection-file.helper.js";
import { collectionPathFor } from "../discovery/output-paths.helper.js";
import { resolveProjectContext } from "../discovery/project-context.service.js";
import { getSession } from "../session/project-session.service.js";
import { apiError } from "./error.js";
import type { IProjectSession, IProjectSnapshot } from "../../contracts/interfaces/core/session.interface.js";
import type { PostmanCollection } from "../../contracts/interfaces/core/postman.interface.js";

/**
 * The open session of a project.
 *
 * @param projectRoot The project to look for.
 * @returns The session.
 * @throws When there is no session: the verb cannot work without one.
 */
export function requireSession(projectRoot: string): IProjectSession {
  const session = getSession(projectRoot);
  if (!session) {
    throw apiError(
      "SESSION_NOT_FOUND",
      `No open session for projectRoot "${projectRoot}"`,
    );
  }
  return session;
}

/**
 * The snapshot of a project, with something in it.
 *
 * @param snapshot The snapshot.
 * @returns The same snapshot.
 * @throws When the snapshot is empty: there is nothing to work with.
 */
export function requireResults(snapshot: IProjectSnapshot): IProjectSnapshot {
  if (snapshot.results.length === 0) {
    throw apiError(
      "EXECUTION_FAILED",
      "Snapshot has no results — re-open the session",
    );
  }
  return snapshot;
}

/**
 * The collection the project would write, and where it is.
 *
 * @param snapshot The open snapshot.
 * @param explicit A path the caller named, if any.
 * @returns The path of the collection.
 */
export function collectionPathOf(
  snapshot: IProjectSnapshot,
  explicit?: string,
): string {
  if (explicit !== undefined) return explicit;
  const context = resolveProjectContext({ projectRoot: snapshot.projectRoot });
  const name = snapshot.results[0]?.config.name;
  return collectionPathFor(context, name);
}

/**
 * Reads a collection, or says why it could not be read.
 *
 * @param path The collection to read.
 * @returns The collection.
 * @throws When the file is missing or is not JSON.
 */
export async function readProjectCollection(path: string): Promise<PostmanCollection> {
  const read = await readCollection(path);
  if (!read.ok) {
    throw apiError("EXECUTION_FAILED", read.reason);
  }
  return read.collection;
}
