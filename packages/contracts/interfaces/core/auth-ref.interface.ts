import type { AuthRef } from "./stable-ids.interface.js";

export interface IAuthRef {
  readonly id: AuthRef;
  readonly type: string;
  readonly description?: string;
}

export type { AuthRef };