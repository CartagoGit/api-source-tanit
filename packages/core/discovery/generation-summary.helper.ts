import type { IGenerationResult } from "../../contracts/interfaces/core/discovery.interface.js";
import type { IProjectSummary } from "../../contracts/interfaces/core/domain.interface.js";
import type { IProjectDetectionEvidence } from "../../contracts/interfaces/core/scanner.interface.js";
import { computeProjectHealth } from "../domain/project-health.service.js";

/** Pure summary projection; consumers display the same recorded generation results. */
export function summarizeGenerationResults(results: ReadonlyArray<IGenerationResult>, frameworks: ReadonlyArray<string>, evidence: ReadonlyArray<IProjectDetectionEvidence> = []): IProjectSummary {
  const first = results[0];
  const login = results.find(result => result.authFlow?.login)?.authFlow?.login;
  const total = (read: (result: IGenerationResult) => number): number => results.reduce((sum, result) => sum + read(result), 0);
  return {
    framework: first?.match?.framework ?? "unknown", frameworks: [...frameworks],
    projectName: first?.config.name ?? "unknown", baseUrl: first?.config.baseUrl ?? "",
    routesInCode: total(result => result.metrics.specs), withFormRequest: total(result => result.metrics.withValidation),
    withoutFormRequest: total(result => result.metrics.withoutValidation), bodiesAdded: total(result => result.metrics.bodiesInferred),
    queriesAdded: total(result => result.metrics.queriesInferred), zeroConfig: results.every(result => result.project.zeroConfig),
    configPath: first?.project.configPath ?? "<unknown>", manualEndpoints: total(result => result.project.manualEndpoints),
    inferredVariables: total(result => result.config.variables.length),
    auth: login ? { loginEndpoint: `${login.request?.method ?? "POST"} ${login.request?.url?.raw ?? login.name}` } : null,
    warnings: results.flatMap(result => result.warnings), evidence: [...evidence],
    health: computeProjectHealth(results.flatMap(result => result.specs)),
  };
}
