import { isAbsolute } from "node:path";

import type { IRequestContext } from "../../contracts/interfaces/core/application-api.interface.js";
import type { IClientProjectLinksInput } from "../../contracts/interfaces/core/client-consumption.interface.js";
import type { IExportConsumerCount } from "../../contracts/interfaces/core/export-target.interface.js";
import type { IDiscoveryOrchestrator } from "../../contracts/interfaces/core/scanner.interface.js";
import type { IProjectSnapshot } from "../../contracts/interfaces/core/session.interface.js";
import { analyzeClientProjectLinks } from "../discovery/client-usage.service.js";
import { apiError } from "./error.js";

/** Collect only counts attributable to operations in the snapshot being exported. */
export async function collectExportConsumerCounts(
  snapshot: IProjectSnapshot,
  target: string,
  frontends: IClientProjectLinksInput["frontends"] | undefined,
  context: IRequestContext,
): Promise<readonly IExportConsumerCount[] | undefined> {
  if (frontends === undefined) return undefined;
  if (target !== "openapi") {
    throw apiError("INVALID_INPUT", "Consumer evidence is available only for OpenAPI exports");
  }
  const serviceId = snapshot.results[0]?.serviceId;
  if (snapshot.results.length !== 1 || serviceId === undefined) {
    throw apiError("INVALID_INPUT", "Consumer evidence requires an open snapshot with one identified backend service");
  }
  if (frontends.some(({ root }) => !isAbsolute(root))) {
    throw apiError("INVALID_INPUT", "Each frontend root must be an absolute path");
  }
  if (!context.orchestrator) {
    throw apiError("EXECUTION_FAILED", "Consumer evidence requires a discovery orchestrator");
  }

  const report = await analyzeClientProjectLinks({
    frontends,
    links: frontends.map(({ root }) => ({ frontendRoot: root, backendRoot: snapshot.projectRoot, serviceId })),
  }, context.orchestrator as IDiscoveryOrchestrator, snapshot);
  const totals = new Map<string, { method: string; uri: string; calls: number; roots: Set<string> }>();
  for (const { root, calls } of report.frontends) {
    for (const call of calls) {
      if (call.status !== "matched" || call.candidates.length !== 1) continue;
      const { method, uri } = call.candidates[0]!.operation;
      if (method === "ALL") continue;
      const key = JSON.stringify([method, uri]);
      const total = totals.get(key) ?? { method, uri, calls: 0, roots: new Set<string>() };
      total.calls++;
      total.roots.add(root);
      totals.set(key, total);
    }
  }
  return Array.from(totals.values(), ({ method, uri, calls, roots }) => ({
    method, uri, confirmedCalls: calls, frontends: roots.size,
  }));
}
