import type { AuthRef, OperationId, ServerRef } from "./stable-ids.interface.js";
import type { Transport } from "./transport/index.js";
import type { IAuthRef } from "./auth-ref.interface.js";
import type { IProvenance } from "./provenance.interface.js";
import type { IServerRef } from "./server-ref.interface.js";

export interface IRequestSpec {
  readonly [key: string]: unknown;
}

export interface IResponseSpec {
  readonly [key: string]: unknown;
}

export interface IOperation {
  readonly id: OperationId;
  readonly serviceId: string;
  readonly transport: Transport;
  readonly serverRef: IServerRef;
  readonly authRef: IAuthRef;
  readonly request: IRequestSpec;
  readonly responses: readonly IResponseSpec[];
  readonly provenance: IProvenance;
}

export type { AuthRef, OperationId, ServerRef };