export interface IServiceOperation {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly requestSchema?: unknown;
  readonly responseSchema?: unknown;
  readonly auth?: unknown;
  readonly serverRef?: string;
  readonly authRef?: string;
}

export interface IServiceDetail {
  readonly serviceId: string;
  readonly framework: string;
  readonly transports: ReadonlyArray<string>;
  readonly auth: unknown;
  readonly baseUrl?: string;
  readonly serverRef?: string;
  readonly authRef?: string;
  readonly operationCount: number;
  readonly operations: ReadonlyArray<IServiceOperation>;
}
