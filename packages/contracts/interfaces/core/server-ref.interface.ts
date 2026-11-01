import type { ServerRef } from "./stable-ids.interface.js";

export interface IServerRef {
  readonly id: ServerRef;
  readonly url: string;
  readonly description?: string;
}

export type { ServerRef };