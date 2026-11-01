/**
 * Data shapes returned by core helpers.
 *
 * Almost all of them are **discriminated results** (`{ ok: true, … } |
 * { ok: false, reason }`), and that is the shape that is shared:
 * whoever consumes a helper needs to declare what they receive without
 * importing the entire helper.
 *
 * `CollectionRead` and `JsonRead` are the example of why they exist.
 * Both distinguish "could not" from "could and got this", which was
 * the concrete confusion that hid bugs: `JSON.parse("null")` returns
 * `null`, and a `catch` that also returns `null` makes a corrupt file
 * and one that legitimately contains `null` end up looking identical.
 */

import type { PostmanCollection } from "./postman.interface.js";

/** What trying to read the collection returns. */
export type CollectionRead =
  | { readonly ok: true; readonly collection: PostmanCollection }
  | { readonly ok: false; readonly reason: string; readonly nextAction: string };

/**
 * What trying to parse JSON returns.
 *
 * Distinguishes "could not" from "parsed to `null`", which used to be
 * confused: `JSON.parse("null")` returns `null`, and a `catch` that
 * also leaves `null` makes a corrupt file and one that legitimately
 * contains `null` end up looking identical. Only one of the two
 * deserves a warning.
 */
export type JsonRead =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

/** Identity seed of a project's collection. */
export interface ICollectionIdentity {
  /** Host-supplied ID, if any. Wins over everything else. */
  readonly explicitId?: string | undefined;
  /** Collection name as it will appear in Postman. */
  readonly collectionName?: string | undefined;
  /** Short name of the project. */
  readonly projectName?: string | undefined;
  /** Detected framework, used to break ties between two homonymous projects. */
  readonly framework?: string | undefined;
}

/** A concrete violation, with its path inside the collection. */
export interface ICollectionIssue {
  readonly severity: "error" | "warning";
  readonly path: string;
  readonly message: string;
}

/** Optional traversal settings. */
export interface ICollectFilesOptions {
  /**
   * If `false`, `node_modules`, `.git`, `vendor`… are NOT skipped. By
   * default they are skipped: scanning third-party dependencies
   * produces noise (and in the tools lint case, other people's
   * violations).
   */
  readonly skipVendorDirs?: boolean;
}

/**
 * Parse third-party JSON without letting `any` leak into the rest of
 * the program.
 *
 * Scanners read manifests and specs **from other people**: untrusted
 * input. The pa

/** Why a path is rejected, so it can be reported. */
export type ContainmentResult =
  | { readonly ok: true; readonly resolved: string }
  | { readonly ok: false; readonly resolved: string; readonly reason: string };

/** A request pulled out of an already-built collection, flattened. */
export interface CollectionRequest {
  method: string;
  uri: string;
  name: string;
  folder: string;
}

/** An already-read file, with the path as it came in the input. */
export interface IReadFile {
  /** Absolute path, as it came in the input. */
  readonly path: string;
  readonly text: string;
}

/** Where the root came from. */
export type RootOrigin = "flag" | "env" | "cwd";

/**
 * The root, and where it came from.
 *
 * `origin` is not debug info: it is what makes it possible to warn when
 * the root has been **guessed**. Without it, a command cannot
 * distinguish "I was told to use this directory" from "I was told
 * nothing and took the current one" — which is the difference between
 * scanning the right project and scanning whatever was under the
 * previous `cd`.
 */
export interface IResolvedRoot {
  readonly root: string;
  readonly origin: RootOrigin;
  /** `true` when someone chose it; `false` when it was guessed. */
  readonly explicit: boolean;
}

/** What can be injected, so it can be tested without touching globals. */
export interface IResolveRootOptions {
  readonly argv?: ReadonlyArray<string> | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly cwd?: string | undefined;
}

/** What is needed to identify an operation. */
export interface IEndpointIdentity {
  /** HTTP method, upper-cased. */
  readonly method: string;
  /** URI, normalized or not: it is normalized here anyway. */
  readonly uri: string;
  /**
   * Operation name, when the protocol needs it.
   *
   * In REST it is unnecessary: `GET /users` is already unique. In
   * RPC-over-POST it is **the only** thing that distinguishes one
   * operation from another, because the URL is the same for all.
   */
  readonly name?: string | undefined;
  /**
   * Exact body, as a last resort.
   *
   * Two requests to the same endpoint with the same name but different
   * body are two legitimate variants —the catalog emits one per rule
   * combination— and must not be counted as duplicates.
   */
  readonly body?: string | undefined;
  /**
   * Identity of the workspace / service the operation belongs to.
   *
   * Audit 2nd review #3: in a monorepo with multiple workspaces
   * (apps/users-api, apps/payments-api), two `GET /health` endpoints
   * from DISTINCT services are not the same operation and must not be
   * merged into one. Previously the merger grouped by METHOD + URI and
   * could collapse both into a single endpoint. Now each candidate
   * carries its `serviceId` (typically the `frameworkSearchRoot` of
   * the match, or "" for flat projects) and the identity key includes
   * that dimension.
   *
   * Empty (`""`) means "flat project, no workspaces to separate".
   * Keeping `""` as the default avoids breaking non-monorepo projects
   * where `serviceId` does not apply.
   */
  readonly serviceId?: string;
}

/** Position of a balanced call: the opening `(` and its matching `)`. */
export interface IBalancedCall {
  /** Index of the `(` that opens the call. */
  readonly callStart: number;
  /** Index of the `)` that closes it. */
  readonly callEnd: number;
}

/** What the YAML emitter knows how to represent. */
export type YamlValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | YamlValue[]
  | { [key: string]: YamlValue };
