import type { IContractScan, IContractComparison, IContractOperationEvidence, IContractEvidenceReport } from "../../contracts/interfaces/core/contract-evidence.interface.js";
import type { EndpointSpec } from "../../contracts/interfaces/core/endpoint-legacy.interface.js";

/** Representation normalization only: parameter names and service identity stay significant. */
function routePath(path: string): string {
  return "/" + path.replace(/^\/+|\/+$/g, "").replace(/\{\{([^}]+)\}\}/g, "{$1}").replace(/:([A-Za-z_][\w]*)/g, "{$1}");
}
function identity(method: string, path: string): string { return `${method.toUpperCase()} ${routePath(path)}`; }
function fields(spec: EndpointSpec): Map<string, string> {
  const values = new Map<string, string>();
  for (const field of spec.fields ?? []) {
    const prefix = `${field.location}.${field.fieldName}`;
    if (field.type !== "any") values.set(`${prefix}.type`, field.type);
    if (field.required !== undefined) values.set(`${prefix}.required`, String(field.required));
    if (field.format !== undefined) values.set(`${prefix}.format`, field.format);
  }
  if (spec.auth !== undefined) values.set("auth", JSON.stringify(spec.auth));
  return values;
}

/**
 * Compare original observations without changing merger precedence or inventing absence.
 * A match means compatible observed assertions, not full HTTP/schema certification.
 */
export function reconcileContracts(scans: ReadonlyArray<IContractScan>): IContractEvidenceReport | undefined {
  if (!scans.some(scan => scan.source.kind === "documentation")) return undefined;
  const groups = new Map<string, Array<{ scan: IContractScan; spec: EndpointSpec; evidence: IContractOperationEvidence }>>();
  for (const scan of scans) {
    const routes = new Map<string, typeof scan.routes[number]>();
    for (const route of scan.routes) routes.set(identity(route.method, route.uri), route);
    for (const spec of scan.specs) {
      const key = JSON.stringify([scan.source.serviceId, identity(spec.method, spec.uri)]);
      const group = groups.get(key) ?? [];
      const route = routes.get(identity(spec.method, spec.uri));
      group.push({ scan, spec, evidence: {
        framework: scan.source.framework, file: route?.sourceFile ?? "",
        line: Math.max(0, route?.lineNumber ?? 0),
        ...(spec.description !== undefined ? { description: spec.description } : {}),
      } });
      groups.set(key, group);
    }
  }
  const operations: IContractComparison[] = [];
  for (const group of groups.values()) {
    const first = group[0]!;
    const documented = group.filter(item => item.scan.source.kind === "documentation");
    const observed = group.filter(item => item.scan.source.kind === "code");
    const conflicts: IContractComparison["conflicts"] = [];
    for (const doc of documented) for (const code of observed) {
      const left = fields(doc.spec), right = fields(code.spec);
      for (const [field, documentedValue] of left) {
        const observedValue = right.get(field);
        const numericCompatible = field.endsWith(".type") &&
          [documentedValue, observedValue].every(value => value === "number" || value === "integer");
        if (observedValue !== undefined && documentedValue !== observedValue && !numericCompatible) {
          conflicts.push({ field, documented: documentedValue, observed: observedValue });
        }
      }
    }
    const missingKind = documented.length === 0 ? "documentation" : "code";
    const counterparts = scans.filter(scan => scan.source.serviceId === first.scan.source.serviceId && scan.source.kind === missingKind);
    const absenceKnown = counterparts.length > 0 && counterparts.every(scan => scan.source.completeness === "complete");
    const presentBoth = documented.length > 0 && observed.length > 0;
    const status = presentBoth ? conflicts.length ? "conflict" : "matched"
      : absenceKnown ? documented.length ? "documented-only" : "observed-only" : "unknown";
    operations.push({
      serviceId: first.scan.source.serviceId, method: first.spec.method.toUpperCase(), path: routePath(first.spec.uri), status,
      documented: documented.map(item => item.evidence), observed: observed.map(item => item.evidence), conflicts,
      limitations: presentBoth ? ["Matching route observations do not certify complete request/response schemas or live HTTP behavior."]
        : absenceKnown ? [] : [`No complete ${missingKind} scan establishes absence for this service.`],
    });
  }
  operations.sort((a, b) => JSON.stringify([a.serviceId, a.path, a.method]).localeCompare(JSON.stringify([b.serviceId, b.path, b.method])));
  return { scope: "static-scan", sources: scans.map(scan => scan.source), operations };
}
