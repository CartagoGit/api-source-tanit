/** Session settings are owned and applied atomically by the shared session. */
import type { IHandler } from "./dispatcher.js";
import { SettingsInputSchema, type SettingsInput } from "./zod-schemas.js";
import { getSession } from "../session/project-session.service.js";
import { apiError } from "./error.js";
import type { SettingsOutput } from "../../contracts/interfaces/core/application-api.interface.js";
export type { SettingsOutput } from "../../contracts/interfaces/core/application-api.interface.js";

/** Reads effective settings or applies a partial update without replacing identity. */
export function createSettingsHandler(): IHandler<SettingsInput, SettingsOutput> {
  return {
    name: "settings",
    input: SettingsInputSchema,
    async handle(input, ctx) {
      const session = getSession(input.projectRoot);
      if (!session) {
        throw apiError("SESSION_NOT_FOUND", `No open session for projectRoot "${input.projectRoot}"`);
      }
      try {
        const settings = input.patch
          ? await session.configure(input.patch, ctx.signal)
          : session.settings();
        return {
          applied: input.patch ? { ...input.patch } : { ...settings },
          sessionId: session.id,
          settings,
        };
      } catch (error) {
        throw apiError("EXECUTION_FAILED", error instanceof Error ? error.message : String(error));
      }
    },
  };
}
