/**
 * Last-resort discovery strategy.
 *
 * When no scanner recognizes the project, the pipeline can still try
 * something: today, a heuristic over `routes/*.php` inherited from
 * when this was a Laravel-only tool.
 *
 * Lives in core **as an interface** for the same reason as the scanner
 * catalog: the pipeline needs to be able to call a fallback, but cannot
 * know which one. Previously it imported it directly
 * (`endpoint-discovery.service`, which parses PHP), and that snuck
 * Laravel into the agnostic core through the back door.
 *
 * Whoever composes the application decides whether to inject a fallback
 * and which one. Without a fallback, an unrecognized project returns
 * zero endpoints — which is an honest answer, not an error.
 */
import type { EndpointSpec } from "./postman.interface.js";
import type { ParsedRoute } from "./scanner.interface.js";
import type { ProjectConfig } from "./project-config.interface.js";
import type { IProjectContext } from "./project-context.interface.js";

/** Result of a last-resort discovery attempt. */
export interface ILegacyDiscoveryResult {
  readonly specs: ReadonlyArray<EndpointSpec>;
  readonly routes: ReadonlyArray<ParsedRoute>;
  /** Endpoints whose validation rules were resolved. */
  readonly withValidation: number;
  readonly withoutValidation: number;
}

/** Discovery strategy for projects that no scanner recognizes. */
export interface ILegacyDiscovery {
  /** Name for traces and for the `origin` field of the result. */
  readonly name: string;
  discover(
    config: ProjectConfig,
    manualEndpoints: ReadonlyArray<EndpointSpec>,
    context: IProjectContext,
  ): Promise<ILegacyDiscoveryResult>;
}
