import type { IAuthRef } from "./auth-ref.interface.js";
import type { IEndpointAuth } from "./endpoint-legacy.interface.js";
import type { IOperation } from "./operation.interface.js";
import type { IServerRef } from "./server-ref.interface.js";
import type { Transport } from "./transport/index.js";

export type ServiceAuth = IAuthRef | IEndpointAuth | undefined;

export interface IServiceDescriptor {
  readonly id: string;
  readonly baseUrl: string;
  readonly auth: ServiceAuth;
  readonly variables: ReadonlyArray<{ readonly key: string; readonly value: string }>;
  readonly transport: Transport;
  readonly endpoints: ReadonlyArray<IOperation>;
  /** @deprecated Use `id`; retained while the legacy graph is still supported. */
  readonly serviceId?: string;
}

export interface ICombinedDescriptor {
  readonly services: ReadonlyArray<IServiceDescriptor>;
  readonly variables: ReadonlyArray<{ readonly key: string; readonly value: string }>;
  readonly operations: ReadonlyArray<IOperation>;
  readonly endpoints: ReadonlyArray<IOperation>;
}

export interface IResolvedOperationContext {
  readonly serverRef: IServerRef;
  readonly authRef: IAuthRef;
}