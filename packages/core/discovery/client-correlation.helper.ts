import type {
  IClientBackendOperation,
  IClientLinkComparisonResult,
  IClientLinkedCall,
  IClientUsage,
  ISelectedClientBackend,
} from "../../contracts/interfaces/core/client-consumption.interface.js";

/** Normalize the route path and preserve the known HTTP host for both sides of a comparison. */
export function normalizeClientUrl(raw: string): { path: string; host?: string } | undefined {
  if (raw.trim() !== raw || !raw || /[\\\u0000-\u0020\u007f]/u.test(raw)) return undefined;
  const absolute = /^[a-z][a-z0-9+.-]*:/iu.test(raw);
  const authority = absolute || raw.startsWith("//");
  if (!authority && !raw.startsWith("/")) return undefined;
  try {
    const url = new URL(raw, "http://tanit.invalid/");
    if (!["http:", "https:"].includes(url.protocol) || (absolute && !/^https?:\/\//iu.test(raw))) {
      return undefined;
    }
    return { path: url.pathname, ...(authority ? { host: url.host } : {}) };
  } catch {
    return undefined;
  }
}

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function indexRoutes(backend: readonly IClientBackendOperation[]) {
  const catalog = new Map<string, Array<{ operation: IClientBackendOperation; index: number; host?: string }>>();
  for (const [index, operation] of backend.entries()) {
    const target = normalizeClientUrl(operation.uri);
    if (!target) continue;
    const id = routeKey(operation.method, target.path);
    const operations = catalog.get(id) ?? [];
    operations.push({ operation, index, host: target.host });
    catalog.set(id, operations);
  }
  return catalog;
}

function matchRoutes(catalog: ReturnType<typeof indexRoutes>, method: string, path: string, knownHost?: string) {
  return (catalog.get(routeKey(method, path)) ?? []).filter(({ host }) =>
    host === undefined || knownHost === undefined || knownHost === host);
}

/** Correlate against one legacy catalog, preserving the single-catalog result format. */
export function correlateClientUsages(usages: readonly IClientUsage[], backend: readonly IClientBackendOperation[]) {
  const catalog = indexRoutes(backend);
  const consumed = new Set<number>();
  const paired = usages.map((usage): IClientUsage => {
    if (usage.unresolvedReason || !usage.method || !usage.path) {
      return { ...usage, correlation: { status: "unknown", candidates: [] } };
    }
    const matches = matchRoutes(catalog, usage.method, usage.path, usage.host);
    const [match] = matches;
    if (matches.length === 1 && match) consumed.add(match.index);
    return { ...usage, correlation: {
      status: matches.length === 0 ? "missing" : matches.length === 1 ? "matched" : "ambiguous",
      candidates: matches.map(({ operation }) => operation),
    } };
  });
  return { usages: paired, operationsWithoutConfirmedConsumer: backend.filter((_, index) => !consumed.has(index)) };
}

/** Compare one frontend's observations across its explicitly selected backend links. */
export function correlateClientUsageLinks(
  usages: readonly IClientUsage[],
  backends: readonly ISelectedClientBackend[],
): IClientLinkComparisonResult {
  const ids = new Set<string>();
  const services = backends.map((backend) => {
    if (backend.id.trim() === "") throw new Error("Selected backend ID must not be blank");
    if (ids.has(backend.id)) throw new Error(`Duplicate selected backend ID: ${backend.id}`);
    ids.add(backend.id);
    return { backend, catalog: indexRoutes(backend.operations), consumed: new Set<number>() };
  });

  const calls = usages.map((usage): IClientLinkedCall => {
    const { method, path, host } = usage;
    if (usage.unresolvedReason || !method || !path) {
      return { usage, status: "unknown", candidates: [] };
    }

    let eligible = services;
    if (host !== undefined) {
      const hostMatches = services.filter(({ backend }) => backend.host === host);
      eligible = hostMatches.length > 0
        ? hostMatches
        : services.filter(({ backend }) => backend.host === undefined);
    }

    const matches = eligible.flatMap((service) =>
      matchRoutes(service.catalog, method, path, host).map((route) => ({ service, route })));
    const [match] = matches;
    const candidates = matches.map(({ service, route }) => ({
      backendId: service.backend.id,
      operation: route.operation,
    }));

    if (match && matches.length === 1) {
      match.service.consumed.add(match.route.index);
      return { usage, status: "matched", backendId: match.service.backend.id, candidates };
    }
    if (match) {
      const backendId = match.service.backend.id;
      return {
        usage,
        status: "ambiguous",
        ...(candidates.every((candidate) => candidate.backendId === backendId) ? { backendId } : {}),
        candidates,
      };
    }
    const [onlyEligible] = eligible;
    if (onlyEligible && eligible.length === 1) {
      return { usage, status: "missing", backendId: onlyEligible.backend.id, candidates };
    }
    return { usage, status: "unknown", candidates };
  });

  return {
    calls,
    backends: services.map(({ backend, consumed }) => ({
      id: backend.id,
      operationsWithoutConfirmedConsumer: backend.operations.filter((_, index) => !consumed.has(index)),
    })),
  };
}
