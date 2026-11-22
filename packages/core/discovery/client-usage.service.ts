import { stat } from "node:fs/promises";

import type {
  IClientAlias,
  IClientBackendOperation,
  IClientConsumptionResult,
} from "../../contracts/interfaces/core/client-consumption.interface.js";
import type { IDiscoveryOrchestrator } from "../../contracts/interfaces/core/scanner.interface.js";
import { ProjectIndex } from "../index/project-index.service.js";
import { scanClientConsumption } from "./client-consumption.service.js";
import { generateCollections } from "./generation.pipeline.js";

interface IClientProjects {
  readonly projectRoot: string;
  readonly backendRoot?: string;
  readonly aliases?: readonly IClientAlias[];
}

async function requireDirectory(path: string, role: "Frontend" | "Backend"): Promise<void> {
  const directory = await stat(path).catch(() => undefined);
  if (!directory?.isDirectory()) throw new Error(`${role} directory unavailable: ${path}`);
}

async function readBackendOperations(
  root: string,
  orchestrator: IDiscoveryOrchestrator,
): Promise<readonly IClientBackendOperation[]> {
  const results = await generateCollections(root, { orchestrator, combineServices: false });
  if (!results.some(({ match, specs }) => match !== null || specs.length > 0)) {
    throw new Error(`No backend API discovered in ${root}`);
  }

  return results.flatMap((result) => result.specs
    .filter(({ transport }) => transport === undefined || transport === "http")
    .map(({ method, uri, name, serviceId }) => ({
      method, uri, name, serviceId: serviceId ?? result.serviceId,
    })));
}

/** Reads client call sites and optionally compares them with a backend catalog in memory. */
export async function analyzeClientProjects(
  { projectRoot, backendRoot, aliases }: IClientProjects,
  orchestrator: IDiscoveryOrchestrator,
): Promise<IClientConsumptionResult> {
  await requireDirectory(projectRoot, "Frontend");
  if (backendRoot !== undefined) await requireDirectory(backendRoot, "Backend");

  const index = await ProjectIndex.open(projectRoot);
  try {
    const backend = backendRoot === undefined ? undefined : await readBackendOperations(backendRoot, orchestrator);
    return await scanClientConsumption(index, { aliases, backend });
  } finally {
    index.close();
  }
}
