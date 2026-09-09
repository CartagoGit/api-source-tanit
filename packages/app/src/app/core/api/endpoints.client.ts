import { Injectable } from "@angular/core";

import {
  ENDPOINT_TRANSPORTS,
  type EndpointDiagnostic,
  type EndpointEvidence,
  type EndpointListResponse,
  type EndpointParameter,
  type EndpointQuery,
  type EndpointRecord,
  type EndpointResponse,
  type EndpointTransport,
} from "../../../../../contracts/interfaces/core/endpoint.interface";

export {
  ENDPOINT_TRANSPORTS,
  type EndpointDiagnostic,
  type EndpointEvidence,
  type EndpointListResponse,
  type EndpointParameter,
  type EndpointQuery,
  type EndpointRecord,
  type EndpointResponse,
  type EndpointTransport,
} from "../../../../../contracts/interfaces/core/endpoint.interface";

@Injectable({ providedIn: "root" })
export class EndpointsClient {
  list(query: EndpointQuery = {}): Promise<EndpointListResponse> {
    return Promise.resolve({ endpoints: createEndpointDataset().filter((endpoint) => matchesQuery(endpoint, query)), total: 5000 });
  }

  get(id: string): Promise<EndpointRecord | undefined> {
    const index = Number.parseInt(id.replace("endpoint-", ""), 10);
    return Promise.resolve(Number.isInteger(index) && index >= 0 && index < 5000 ? createEndpoint(index) : undefined);
  }
}

export function createEndpointDataset(count = 5000): readonly EndpointRecord[] {
  return Array.from({ length: count }, (_, index) => createEndpoint(index));
}

export function createEndpoint(index: number): EndpointRecord {
  const transport = ENDPOINT_TRANSPORTS[index % ENDPOINT_TRANSPORTS.length] ?? "http";
  const method = transport === "http" ? ((["GET", "POST", "PUT", "DELETE"] as const)[index % 4] ?? "GET") : transport.toUpperCase();
  const service = `service-${(index % 12) + 1}`;
  const path = transport === "http" ? `/api/${service}/resources/${index}` : `/${service}/operation-${index}`;
  return {
    id: `endpoint-${index}`,
    operationId: `${service}.${method.toLowerCase()}${index}`,
    service,
    framework: (["NestJS", "Express", "FastAPI", "Spring", "Laravel"][index % 5] ?? "Express"),
    transport,
    method,
    path,
    description: `Generated operation ${index} for ${service}`,
    auth: index % 3 === 0 ? "bearer" : index % 3 === 1 ? "api-key" : "none",
    validation: index % 2 === 0 ? "validated" : "unvalidated",
    responseSummary: index % 4 === 0 ? "200, 400, 500" : "200, 404",
    parameters: [{ name: "id", location: "path", required: true, type: "string" }],
    responses: [{ status: "200", description: "Successful response", schema: { type: "object" } }],
    requestSchema: { type: "object", properties: { id: { type: "string" } } },
    sourceFile: `src/${service}/controller-${index % 8}.ts`,
    evidence: [{ sourceFile: `src/${service}/controller-${index % 8}.ts`, line: (index % 240) + 1, column: 3, confidence: 0.72 + (index % 28) / 100 }],
    code: `${method} ${path}\n\n// ${transport} operation ${index}`,
    diagnostics: index % 5 === 0 ? [{ code: "LOW_CONFIDENCE", severity: "warning", message: "Evidence confidence is below the preferred threshold.", suggestion: "Review the source evidence before exporting." }] : [],
  };
}

function matchesQuery(endpoint: EndpointRecord, query: EndpointQuery): boolean {
  const search = query.search?.trim().toLowerCase();
  return (!query.service || endpoint.service === query.service)
    && (!query.framework || endpoint.framework === query.framework)
    && (!query.transport || endpoint.transport === query.transport)
    && (!query.method || endpoint.method === query.method)
    && (!query.auth || endpoint.auth === query.auth)
    && (!query.validation || endpoint.validation === query.validation)
    && (!query.responses || endpoint.responseSummary.includes(query.responses))
    && (query.confidence === undefined || endpoint.evidence.some((item) => item.confidence >= query.confidence!))
    && (!query.sourceFile || endpoint.sourceFile.includes(query.sourceFile))
    && (!query.diagnosticCode || endpoint.diagnostics.some((diagnostic) => diagnostic.code === query.diagnosticCode))
    && (!search || fuzzyMatch(search, `${endpoint.path} ${endpoint.method} ${endpoint.description}`));
}

function fuzzyMatch(query: string, value: string): boolean {
  let queryIndex = 0;
  const normalized = value.toLowerCase();
  for (const character of normalized) if (character === query[queryIndex]) queryIndex += 1;
  return queryIndex === query.length;
}