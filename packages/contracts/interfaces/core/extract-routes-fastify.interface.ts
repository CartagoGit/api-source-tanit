/**
 * Fastify route extractor contract (audit 2026-09-06 §12,
 * proposal `r00013` S1).
 *
 * The implementation lives in
 * `packages/core/language-frontends/typescript/extract-routes-fastify.helper.ts`.
 * The contract lives here so exporters and the MCP surface can
 * describe Fastify routes without depending on the LanguageIR
 * helpers.
 */

/** The single route the extractor emits. */
export interface IExtractedRoute {
  readonly method: string;
  readonly path: string;
  readonly handler?: string;
  readonly range: { readonly file: string; readonly start: number; readonly end: number };
  /**
   * True when the receiver is an `import Fastify from 'fastify'`
   * default import (so downstream can mark the route as
   * root-level). Sub-router roots receive `false`.
   */
  readonly isApp: boolean;
  /** Receiver identifier, e.g. `app`, `usersRouter`. */
  readonly receiver: string;
}

/** Mount signal: `.register(plugin, { prefix })`. */
export interface IRouterMount {
  readonly plugin: string;
  readonly prefix: string;
  readonly range: { readonly file: string; readonly start: number; readonly end: number };
}

/**
 * What `extractFastifyRoutesFromIR` emits: the flat route list plus
 * the `.register(plugin, { prefix })` mount signals. Consumers
 * (scanners, MCP, UI) read both fields — `routes` for the catalog,
 * `mounts` for cross-file expansion (`r00014` S4).
 */
export interface IExtractRoutesResult {
  readonly routes: IExtractedRoute[];
  readonly mounts: IRouterMount[];
}
