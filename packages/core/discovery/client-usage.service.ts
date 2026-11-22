import { realpath, stat } from "node:fs/promises";

import type {
  IClientAlias,
  IClientBackendOperation,
  IClientConsumptionResult,
  IClientProjectLinksInput,
  IClientProjectLinksReport,
  ISelectedClientBackend,
} from "../../contracts/interfaces/core/client-consumption.interface.js";
import type { IGenerationResult } from "../../contracts/interfaces/core/discovery.interface.js";
import type { IDiscoveryOrchestrator } from "../../contracts/interfaces/core/scanner.interface.js";
import { ProjectIndex } from "../index/project-index.service.js";
import { correlateClientUsageLinks } from "./client-correlation.helper.js";
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

async function canonicalDirectory(path: string, role: "Frontend" | "Backend"): Promise<string> {
  await requireDirectory(path, role);
  return realpath(path).catch(() => {
    throw new Error(`${role} directory unavailable: ${path}`);
  });
}

async function readBackendServices(
  root: string,
  orchestrator: IDiscoveryOrchestrator,
): Promise<readonly IGenerationResult[]> {
  const results = await generateCollections(root, { orchestrator, combineServices: false });
  if (!results.some(({ match, specs }) => match !== null || specs.length > 0)) {
    throw new Error(`No backend API discovered in ${root}`);
  }
  return results;
}

function readServiceOperations(result: IGenerationResult): readonly IClientBackendOperation[] {
  return result.specs
    .filter(({ transport }) => transport === undefined || transport === "http")
    .map(({ method, uri, name, serviceId }) => ({
      method, uri, name, serviceId: serviceId ?? result.serviceId,
    }));
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
    const backend = backendRoot === undefined
      ? undefined
      : (await readBackendServices(backendRoot, orchestrator)).flatMap(readServiceOperations);
    return await scanClientConsumption(index, { aliases, backend });
  } finally {
    index.close();
  }
}

/** Analyze explicitly selected frontend and backend service links in one read-only request. */
export async function analyzeClientProjectLinks(
  input: IClientProjectLinksInput,
  orchestrator: IDiscoveryOrchestrator,
): Promise<IClientProjectLinksReport> {
  const directories = new Map<string, string>();
  async function resolveDirectory(path: string, role: "Frontend" | "Backend"): Promise<string> {
    const cached = directories.get(path);
    if (cached !== undefined) return cached;
    const directory = await canonicalDirectory(path, role);
    directories.set(path, directory);
    return directory;
  }

  const frontends = new Map<string, {
    aliases?: readonly IClientAlias[];
    links: Map<string, Omit<IClientProjectLinksInput["links"][number], "frontendRoot">>;
  }>();
  for (const { root, aliases } of input.frontends) {
    const canonicalRoot = await resolveDirectory(root, "Frontend");
    if (frontends.has(canonicalRoot)) {
      throw new Error(`Duplicate frontend selection: ${canonicalRoot}`);
    }
    frontends.set(canonicalRoot, { aliases, links: new Map() });
  }

  for (const { frontendRoot, backendRoot, serviceId, host } of input.links) {
    const canonicalFrontend = await resolveDirectory(frontendRoot, "Frontend");
    const frontend = frontends.get(canonicalFrontend);
    if (!frontend) {
      throw new Error(`Link frontend is not selected: ${frontendRoot}. Add it to frontends before linking services.`);
    }
    const canonicalBackend = await resolveDirectory(backendRoot, "Backend");
    const id = JSON.stringify([canonicalBackend, serviceId]);
    if (frontend.links.has(id)) {
      throw new Error(`Duplicate link for ${canonicalFrontend} to service ${serviceId} at ${canonicalBackend}`);
    }
    frontend.links.set(id, { backendRoot: canonicalBackend, serviceId, host });
  }

  const catalogs = new Map<string, Map<string, readonly IClientBackendOperation[]>>();
  const prepared = [];
  for (const [root, { aliases, links }] of frontends) {
    const backends: ISelectedClientBackend[] = [];
    for (const [id, { backendRoot, serviceId, host }] of links) {
      let services = catalogs.get(backendRoot);
      if (!services) {
        services = new Map();
        for (const service of await readBackendServices(backendRoot, orchestrator)) {
          if (service.serviceId !== undefined) {
            services.set(service.serviceId, readServiceOperations(service));
          }
        }
        catalogs.set(backendRoot, services);
      }
      const operations = services.get(serviceId);
      if (!operations) {
        throw new Error(`Backend service ${JSON.stringify(serviceId)} unavailable at ${backendRoot}. `
          + `Available service IDs: ${[...services.keys()].join(", ")}`);
      }
      backends.push({ id, host, operations });
    }
    prepared.push({ root, aliases, links, backends });
  }

  const reports: IClientProjectLinksReport["frontends"][number][] = [];
  for (const { root, aliases, links, backends } of prepared) {
    const index = await ProjectIndex.open(root);
    try {
      const { usages, diagnostics } = await scanClientConsumption(index, { aliases });
      const comparison = correlateClientUsageLinks(usages, backends);
      reports.push({
        root,
        diagnostics,
        calls: comparison.calls,
        backends: comparison.backends.map((backend) => {
          const { backendRoot, serviceId } = links.get(backend.id)!;
          return { ...backend, root: backendRoot, serviceId };
        }),
      });
    } finally {
      index.close();
    }
  }
  return { frontends: reports };
}
