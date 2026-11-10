/**
 * The summary of a snapshot.
 *
 * ## Why it is a helper and not two copies
 *
 * The `snapshot` handler and the `open-project` handler both answer
 * with a summary of the project. They used to build it separately,
 * and they drifted: when the summary grew the diagnostics — what
 * the scan noticed about the project — the handler that answered
 * "open it" was left out, and the app's Diagnostics section had
 * nothing to draw for a project it had just opened.
 *
 * One function, both answers.
 */
import type { IProjectSnapshot } from "../../contracts/interfaces/core/session.interface.js";
import type {
  IProjectDiagnostic,
  ISnapshotSummary,
} from "../../contracts/interfaces/core/application-api.interface.js";

/**
 * Summarizes a snapshot.
 *
 * @param snapshot The snapshot to summarize.
 * @returns What the app draws: the frameworks, the counts, and what
 *   the scan noticed.
 */
export function summarizeSnapshot(snapshot: IProjectSnapshot): ISnapshotSummary {
  return {
    sessionId: snapshot.sessionId,
    projectRoot: snapshot.projectRoot,
    capturedAt: snapshot.capturedAt.toISOString(),
    frameworks: [...snapshot.frameworks],
    endpointCount: snapshot.results.reduce((n, r) => n + r.specs.length, 0),
    serviceCount: new Set(
      snapshot.results.map((r) => r.serviceId ?? "default"),
    ).size,
    diagnostics: diagnosticsOf(snapshot),
  };
}

/**
 * What the scan noticed about the project.
 *
 * Two sources, and they are different things:
 *
 *   · the **warnings** the generation produced — "no endpoints were
 *     found", "the folder X is not a route file" — which are about
 *     the project;
 *   · the **detector crashes** — a scanner that blew up reading a
 *     file — which are about the tool.
 *
 * Both belong on the same screen: the user wants to know what the
 * scan found and what it could not read.
 */
function diagnosticsOf(snapshot: IProjectSnapshot): IProjectDiagnostic[] {
  const diagnostics: IProjectDiagnostic[] = [];

  for (const result of snapshot.results) {
    for (const warning of result.warnings) {
      diagnostics.push({ severity: "warning", message: warning });
    }
  }

  for (const diagnostic of snapshot.diagnostics) {
    diagnostics.push({
      severity: diagnostic.severity,
      message: diagnostic.reason,
      source: diagnostic.component,
    });
  }

  return diagnostics;
}
