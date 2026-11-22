import type { IProjectContext } from "../core/project-context.interface.js";

/** Dependencies for opening an artifact without waiting for its application. */
export interface IOpenPostmanOptions {
  readonly context?: IProjectContext;
  readonly platform?: string;
  readonly launch?: (command: string, args: readonly string[]) => Promise<boolean>;
}
