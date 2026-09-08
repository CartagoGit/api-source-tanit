import { Injectable } from "@angular/core";

export const ENDPOINT_TRANSPORTS = ["http", "grpc", "graphql", "websocket", "sse", "message-broker"] as const;
export type EndpointTransport = (typeof ENDPOINT_TRANSPORTS)[number];

export interface EndpointParameter {
  readonly name: string;
  readonly location: "path" | "query" | "header" | "body";
  readonly required: boolean;
  readonly type: string;
}

export interface EndpointResponse {
  readonly status: string;
  readonly description: string;
  readonly schema?: unknown;
}

export interface EndpointEvidence {
  readonly sourceFile: string;
  readonly line: number;
  readonly column: number;
  readonly confidence: number;
}

export interface EndpointDiagnostic {
  readonly code: string;
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
  readonly suggestion: string;
}

export interface EndpointRecord {
  readonly id: string;
  readonly operationId: string;
  readonly service: string;
  readonly framework: string;
  readonly transport: EndpointTransport;
  readonly method: string;
  readonly path: string;
  readonly description: string;
  readonly auth: string;
  readonly validation: string;
  readonly responseSummary: string;
  readonly parameters: readonly EndpointParameter[];
  readonly responses: readonly EndpointResponse[];
  readonly requestSchema: unknown;
  readonly sourceFile: string;
  readonly evidence: readonly EndpointEvidence[];
  readonly code: string;
  readonly diagnostics: readonly EndpointDiagnostic[];
}

export interface EndpointQuery {
  readonly service?: string;
  readonly framework?: string;
  readonly transport?: EndpointTransport;
  readonly method?: string;
  readonly auth?: string;
  readonly validation?: string;
  readonly responses?: string;
  readonly confidence?: number;
  readonly sourceFile?: string;
  readonly diagnosticCode?: string;
  readonly search?: string;
}

export interface EndpointListResponse {
  readonly endpoints: readonly EndpointRecord[];
  readonly total: number;
}

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