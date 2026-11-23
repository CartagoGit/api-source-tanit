import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";

import { DECLARED_JSON_REQUEST } from "../../contracts/constants/core/client-consumption.constant.js";
import type {
  ClientProjectCandidates,
  ClientProjectRole,
  IClientAlias,
  IClientBackendOperation,
  IClientConsumptionResult,
  IClientLinkedCall,
  IClientUsage,
  IDeclaredJsonRequestContract,
  IClientProjectLinksInput,
  IClientProjectLinksReport,
  ISelectedClientBackend,
} from "../../contracts/interfaces/core/client-consumption.interface.js";
import type { IGenerationResult } from "../../contracts/interfaces/core/discovery.interface.js";
import type { IDiscoveryOrchestrator } from "../../contracts/interfaces/core/scanner.interface.js";
import { ProjectIndex } from "../index/project-index.service.js";
import { compareJsonRequestBody } from "../schema/json-request-comparison.helper.js";
import { correlateClientUsageLinks } from "./client-correlation.helper.js";
import { scanClientConsumption } from "./client-consumption.service.js";
import { generateCollections } from "./generation.pipeline.js";
import { detectMonorepo } from "./monorepo-detector.helper.js";

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
  collectJsonRequestContracts = false,
): Promise<readonly IGenerationResult[]> {
  const results = await generateCollections(root, {
    orchestrator,
    combineServices: false,
    ...(collectJsonRequestContracts ? { collectJsonRequestContracts: true } : {}),
  });
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

function indexJsonDeclarations(
  service: IGenerationResult,
  operations: readonly IClientBackendOperation[],
  declarations: WeakMap<IClientBackendOperation, IDeclaredJsonRequestContract>,
): void {
  const routes = new Map<string, IDeclaredJsonRequestContract | undefined>();
  for (const route of service.jsonRequestContractRoutes ?? []) {
    const key = `${route.method} ${route.uri}`;
    routes.set(key, routes.has(key) ? undefined : route[DECLARED_JSON_REQUEST]);
  }
  for (const operation of operations) {
    const declaration = routes.get(`${operation.method} ${operation.uri}`);
    if (declaration) declarations.set(operation, declaration);
  }
}

function assessRequestBody(
  call: IClientLinkedCall,
  payloads: WeakMap<IClientUsage["location"], string>,
  declarations: WeakMap<IClientBackendOperation, IDeclaredJsonRequestContract>,
): IClientLinkedCall {
  const [candidate] = call.candidates;
  if (call.status !== "matched" || !candidate) return call;
  const raw = payloads.get(call.usage.location);
  if (raw === undefined) return { ...call, requestContract: { verdict: "unknown", reason: "missing-client-json" } };
  const declaration = declarations.get(candidate.operation);
  if (!declaration) return { ...call, requestContract: { verdict: "unknown", reason: "missing-backend-schema" } };
  return {
    ...call,
    requestContract: { ...compareJsonRequestBody(declaration.schema, raw), source: declaration.source },
  };
}

/** Inspect workspace directories or detected backend services before explicit selection. */
export async function inspectClientProjectCandidates(
  projectRoot: string,
  role: ClientProjectRole,
  orchestrator: IDiscoveryOrchestrator,
): Promise<ClientProjectCandidates> {
  const root = await canonicalDirectory(projectRoot, role === "frontend" ? "Frontend" : "Backend");
  if (role === "frontend") {
    const { workspaceDirs } = await detectMonorepo(root);
    return {
      role,
      root,
      projects: [
        { root, relativePath: "" },
        ...workspaceDirs.map((relativePath) => ({ root: join(root, relativePath), relativePath })),
      ],
    };
  }

  const services = await readBackendServices(root, orchestrator);
  return {
    role,
    root,
    services: services.flatMap((service) => service.serviceId === undefined ? [] : [{
      serviceId: service.serviceId,
      relativePath: service.match?.frameworkSearchRoot ?? "",
      framework: service.match?.framework ?? "unknown",
      httpOperationCount: readServiceOperations(service).length,
    }]),
  };
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
  const declarations = new WeakMap<IClientBackendOperation, IDeclaredJsonRequestContract>();
  const prepared = [];
  for (const [root, { aliases, links }] of frontends) {
    const backends: ISelectedClientBackend[] = [];
    for (const [id, { backendRoot, serviceId, host }] of links) {
      let services = catalogs.get(backendRoot);
      if (!services) {
        services = new Map();
        for (const service of await readBackendServices(backendRoot, orchestrator, input.compareRequestBodies)) {
          if (service.serviceId === undefined) continue;
          const discovered = readServiceOperations(service);
          services.set(service.serviceId, discovered);
          if (input.compareRequestBodies) indexJsonDeclarations(service, discovered, declarations);
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
      const payloads = new WeakMap<IClientUsage["location"], string>();
      const { usages, diagnostics } = await scanClientConsumption(index, {
        aliases,
        ...(input.compareRequestBodies ? {
          observeJsonRequest: (location, body) => { payloads.set(location, body); },
        } : {}),
      });
      const comparison = correlateClientUsageLinks(usages, backends);
      reports.push({
        root,
        diagnostics,
        calls: input.compareRequestBodies
          ? comparison.calls.map((call) => assessRequestBody(call, payloads, declarations))
          : comparison.calls,
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
