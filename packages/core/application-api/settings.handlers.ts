/**
 * `settings.handlers.ts` — get / patch per-session options.
 *
 * Today the session layer only exposes the options it was opened
 * with; reading them back is the simplest "get" path. The "patch"
 * path applies a partial update by closing the existing session
 * and re-opening it with the new options — atomic from the
 * caller's POV because every other handler that reads the
 * session sees the new options on its next call.
 */

import type { IHandler } from "./dispatcher.js";
import {
  SettingsInputSchema,
  type SettingsInput,
} from "./zod-schemas.js";
import {
  getSession,
  openSession,
  type IProjectSessionOptions,
} from "../session/project-session.service.js";
import { apiError } from "./error.js";
import type { IGenerationOptions } from "../../contracts/interfaces/core/discovery.interface.js";

/** Resultado de aplicar cambios de configuración a una sesión. */
import type { SettingsOutput } from "../../contracts/interfaces/core/application-api.interface.js";
export type { SettingsOutput } from "../../contracts/interfaces/core/application-api.interface.js";

/** Crea el handler que aplica cambios de configuración de una sesión. */
export function createSettingsHandler(): IHandler<SettingsInput, SettingsOutput> {
  return {
    name: "settings",
    input: SettingsInputSchema,
    async handle(input, ctx) {
      const session = getSession(input.projectRoot);
      if (!session) {
        throw apiError(
          "SESSION_NOT_FOUND",
          `No open session for projectRoot "${input.projectRoot}"`,
        );
      }
      if (!ctx.orchestrator) {
        throw apiError(
          "EXECUTION_FAILED",
          "settings requires ctx.orchestrator to re-open with the patch",
        );
      }

      // No patch — pure get. Today the session only knows the
      // options it was opened with; we surface what we have.
      if (!input.patch) {
        const snap = session.current();
        return {
          applied: {
            projectRoot: snap.projectRoot,
            capturedAt: snap.capturedAt.toISOString(),
          },
        };
      }

      // Patch — close and reopen with the merged options.
      session.close();
      const generationOptions: IGenerationOptions = {
        orchestrator: ctx.orchestrator as IGenerationOptions["orchestrator"],
        ...(input.patch.collectionName !== undefined
          ? { collectionName: input.patch.collectionName }
          : {}),
      };
      const sessionOptions: IProjectSessionOptions = {
        generationOptions,
        ...(input.patch.watch !== undefined ? { watch: input.patch.watch } : {}),
        ...(input.patch.watchDebounceMs !== undefined
          ? { watchDebounceMs: input.patch.watchDebounceMs }
          : {}),
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      };
      try {
        await openSession(input.projectRoot, sessionOptions);
      } catch (err) {
        throw apiError("EXECUTION_FAILED", (err as Error).message);
      }
      return { applied: input.patch as Readonly<Record<string, unknown>> };
    },
  };
}