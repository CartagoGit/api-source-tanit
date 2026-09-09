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
