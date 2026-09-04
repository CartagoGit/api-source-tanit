/**
 * The contract of an output format.
 *
 * The scan already produces an intermediate representation —an
 * `EndpointSpec[]` plus the project configuration— that knows nothing
 * about Postman. All `collection-builder` does is serialise that into
 * a concrete format. An exporter does exactly the same for another
 * format, and that is why adding one **does not touch the scan
 * engine**.
 *
 * An exporter returns a list of artifacts, not a string. Bruno is not
 * a single file: it is a folder tree with one `.bru` per request, and
 * a contract that returned `string` would have left out the one
 * format in the batch that is Git-friendly, which is precisely its
 * point.
 */
import type { EndpointSpec } from "./postman.interface.js";
import type { ProjectConfig } from "./project-config.interface.js";

/** A file to write, with its path relative to the output directory. */
export interface IExportArtifact {
  /** Relative path. It may include folders: `my-api/users/list.bru`. */
  readonly path: string;
  readonly content: string;
}

/** Everything an exporter needs to know about the project. */
export interface IExportInput {
  readonly specs: ReadonlyArray<EndpointSpec>;
  readonly config: ProjectConfig;
  /**
   * Auth scheme, already detected.
   *
   * It is passed in precomputed so each exporter does not deduce it:
   * five parallel detections would end up disagreeing, and then the
   * same project would say "bearer" for Postman and "none" for
   * Insomnia.
   */
  readonly auth: IExportAuth;
}

/** What an exporter needs from the auth scheme. */
export interface IExportAuth {
  readonly type: "bearer" | "apikey" | "oauth2" | "none";
  readonly keyName?: string | undefined;
  readonly keyIn?: "header" | "query" | undefined;
}

/**
 * An output format.
 *
 * Implementing it and registering it in `export-registry.service.ts`
 * is all that is needed to add a format: the scan engine is not
 * touched, because what gets serialised is the intermediate
 * representation the scan already produces.
 */
export interface IExportTarget {
  /** Identifier for `--format`. Lowercase, no spaces. */
  readonly format: string;
  /** One-line summary for the CLI help. */
  readonly summary: string;
  /**
   * Serialises the project into the files of this format.
   *
   * It is **synchronous and pure**: it does not touch disk or the
   * network. Writing is the caller's job, so an exporter can be
   * tested by comparing strings rather than mounting a file system.
   */
  serialize(input: IExportInput): IExportArtifact[];
  /**
   * What this format **cannot** represent for this project.
   *
   * Not everything fits every format, and staying silent about it is
   * the worst thing to do: OpenAPI identifies an operation by path
   * + method, so a GraphQL project —five distinct `POST /graphql`—
   * collapses to one. Without this warning the file ships with one
   * operation for five and looks correct.
   *
   * Optional: an exporter that can represent everything omits it.
   */
  warnings?(input: IExportInput): string[];
}
