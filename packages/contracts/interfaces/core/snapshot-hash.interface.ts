export interface ICanonicalSnapshot {
  readonly capturedAt: string;
  readonly formats: ReadonlyArray<string>;
  readonly services: ReadonlyArray<ICanonicalService>;
  readonly combinedExport?: ICombinedExport;
}

export interface ICombinedExport {
  readonly partial: boolean;
  readonly explanation: string;
  readonly services: ReadonlyArray<{ readonly serviceId: string; readonly reason: string }>;
  readonly operationRefs: Readonly<Record<string, { readonly serverRef?: string; readonly authRef?: string }>>;
}

export interface ICanonicalService {
  readonly serviceId: string;
  readonly framework: string;
  readonly transports: ReadonlyArray<string>;
  readonly auth: unknown;
  readonly baseUrl?: string;
  readonly serverRef?: string;
  readonly authRef?: string;
  readonly operations: ReadonlyArray<ICanonicalOperation>;
}

export interface ICanonicalOperation {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly requestSchema?: unknown;
  readonly responseSchema?: unknown;
  readonly auth?: unknown;
  readonly serverRef?: string;
  readonly authRef?: string;
}
