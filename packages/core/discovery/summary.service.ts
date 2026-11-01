/**
 * `summary` — what the tool sees in a project, without writing anything.
 *
 * The CLI `summary` command and the plugin's `summary` tool consume this
 * service. Its contract with callers is: **this is what you will get if you
 * run `generate`**. A summary that does not preview generation is useless for
 * making decisions.
 *
 * It therefore runs the exact same pipeline as `generate` and only projects
 * its result. It does not build artifacts on disk: the collection is assembled
 * in memory and discarded.
 *
 * Previously it had **its own** discovery path, with a hand-maintained list
 * named `NON_LARAVEL_FRAMEWORKS` that enumerated eleven of the twelve
 * frameworks. Laravel was absent, so it followed a different heuristic and
 * counted **declared** routes rather than routes that end up in the
 * collection: the Laravel example reported 7 while `generate` produced 18.
 * Because this was a parallel list, a new framework would not have entered it
 * either; it would have fallen back to the old path without any signal.
 */
import { resolve } from "node:path";

import type { DiscoveryOrchestrator } from "./discovery.orchestrator.js";
import type { ILegacyDiscovery } from "../../contracts/interfaces/core/legacy-discovery.interface.js";
import { generateCollection } from "./generation.pipeline.js";
import { computeProjectHealth } from "../domain/project-health.service.js";
import type { IProjectSummary } from "../../contracts/interfaces/core/domain.interface.js";

/**
 * Inspects `projectRoot` and returns a summary without writing files.
 *
 * Throws if the directory does not exist. If it does not recognize the
 * project, returns a summary with zero endpoints and the corresponding
 * warning—an honest response rather than an error.
 *
 * The framework catalog and fallback are injected, as in the pipeline: this
 * is a core service and cannot know the concrete scanners. For the complete
 * catalog, use `summarizeWithAllFrameworks()` in `packages/frameworks/`.
 */
export async function summarizeProject(
  projectRoot: string,
  orchestrator: DiscoveryOrchestrator,
  legacyFallback?: ILegacyDiscovery,
): Promise<IProjectSummary> {
  // The pipeline performs the existence check because it owns that decision:
  // both paths therefore fail the same way with the same message.
  //
  // x00024: `generateCollection()` now throws
  // `MultipleServicesWithoutCombineError` when the caller does not request
  // `--combine-services` and there is >1 service. `summarizeProject` only
  // wants ONE summary collection (an `IProjectSummary`), so pass
  // `combineServices: true` to preserve the legacy behavior: "summarize the
  // first detected service." If the UI/CLI ever needs to summarize all
  // services, that slice will migrate to `generateCollections` plus a loop.
  const result = await generateCollection(resolve(projectRoot), {
    orchestrator,
    combineServices: true,
    ...(legacyFallback ? { legacyFallback } : {}),
  });

  return {
    framework: result.match?.framework ?? "unknown",
    frameworks: result.frameworks,
    projectName: result.config.name,
    baseUrl: result.config.baseUrl,
    routesInCode: result.metrics.specs,
    withFormRequest: result.metrics.withValidation,
    withoutFormRequest: result.metrics.withoutValidation,
    bodiesAdded: result.metrics.bodiesInferred,
    queriesAdded: result.metrics.queriesInferred,
    zeroConfig: result.project.zeroConfig,
    configPath: result.project.configPath,
    manualEndpoints: result.project.manualEndpoints,
    inferredVariables: result.config.variables.length,
    auth: result.authFlow?.login
      ? {
          loginEndpoint: `${result.authFlow.login.request?.method ?? "POST"} ${
            result.authFlow.login.request?.url?.raw ?? result.authFlow.login.name
          }`,
        }
      : null,
    warnings: result.warnings,
    evidence: result.match
      ? (await orchestrator.detectAll(resolve(projectRoot)))
          .find((f) => f.match.framework === result.match!.framework)
          ?.evidence ?? []
      : [],
    // Use `result.specs`, not adapter counters: the specs already contain the
    // framework-agnostic inference and override merge that `generate` would
    // write.
    health: computeProjectHealth(result.specs),
  };
}
