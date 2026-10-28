/**
 * `open-project.handler.ts` — opens a session for a project root.
 *
 * Wraps `ProjectSession.openSession()` with zod-validated input and
 * the typed `IRequestContext`. The returned `IProjectSummary` is a
 * thin projection of `IProjectSnapshot` so consumers (Web UI, CLI)
 * do not have to depend on the full snapshot type.
 */

import type { IHandler } from "./dispatcher.js";
import {
  OpenProjectInputSchema,
  type OpenProjectInput,
  type ISnapshotSummary,
} from "./zod-schemas.js";
import {
  openSession,
  type IProjectSessionOptions,
} from "../session/project-session.service.js";
import { closeAllSessions } from "../session/project-session.service.js";
import { apiError } from "./error.js";
import type { IGenerationOptions } from "../../contracts/interfaces/core/discovery.interface.js";

/** Public output shape — a stable contract for the bridges. */
import type { OpenProjectOutput } from "../../contracts/interfaces/core/application-api.interface.js";
export type { OpenProjectOutput } from "../../contracts/interfaces/core/application-api.interface.js";

/**
 * Factory that captures the dependencies. The default export
 * returns the bare handler; tests can override the orchestrator by
 * passing their own factory.
 */
export function createOpenProjectHandler(): IHandler<OpenProjectInput, OpenProjectOutput> {
  return {
    name: "open-project",
    input: OpenProjectInputSchema,
    async handle(input, ctx) {
      // The orchestrator is opaque to the API: we trust the caller
      // (CLI / bridge) to provide one when it has a non-default
      // registry. Without it, the session layer's default factory
      // is the source of truth — but it lives in the CLI today, so
      // the dispatcher reports a clear error if neither was set.
      const orchestrator = ctx.orchestrator;
      if (!orchestrator) {
        throw apiError(
          "EXECUTION_FAILED",
          "open-project requires ctx.orchestrator (no default registry in core)",
        );
      }

      const generationOptions: IGenerationOptions = {
        orchestrator: orchestrator as IGenerationOptions["orchestrator"],
        ...(input.collectionName !== undefined
          ? { collectionName: input.collectionName }
          : {}),
      };

      const sessionOptions: IProjectSessionOptions = {
        generationOptions,
        ...(input.watch !== undefined ? { watch: input.watch } : {}),
        ...(input.watchDebounceMs !== undefined
          ? { watchDebounceMs: input.watchDebounceMs }
          : {}),
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      };

      let session;
      try {
        session = await openSession(input.projectRoot, sessionOptions);
      } catch (err) {
        // The session layer has its own typed errors
        // (SessionAbortedError). Forward them with the same
        // code so the bridge sees a single vocabulary.
        throw apiError("EXECUTION_FAILED", (err as Error).message);
      }

      const snap = session.current();
      const summary: ISnapshotSummary = {
        sessionId: snap.sessionId,
        projectRoot: snap.projectRoot,
        capturedAt: snap.capturedAt.toISOString(),
        frameworks: [...snap.frameworks],
        endpointCount: snap.results.reduce(
          (n, r) => n + r.specs.length,
          0,
        ),
        serviceCount: new Set(snap.results.map((r) => r.serviceId ?? "default")).size,
      };

      // Surface a typed closed-state cleanup hook so the test
      // suite can call it. The full close-all lives in
      // `list-projects` / `close`.
      void closeAllSessions;

      return { sessionId: session.id, summary };
    },
  };
}