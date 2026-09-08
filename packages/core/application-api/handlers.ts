/**
 * `handlers.ts` — barrel for the 14 Application API handlers.
 *
 * Re-exports each handler factory under its canonical name so
 * `buildRegistry()` can wire them up by `name`. The barrel is the
 * only thing the dispatcher needs to import.
 *
 * Adding a handler:
 *   1. Create `<name>.handler.ts` exporting a factory `create<Name>Handler(): IHandler<…>`.
 *   2. Add the import + entry below.
 *   3. Add the matching zod input schema in `zod-schemas.ts`.
 *   4. (Optional) export the inferred types from `zod-schemas.ts`.
 *
 * Renaming a handler is a breaking change — the dispatcher maps by
 * the `name` field and the bridges dispatch on the same string.
 */

import type { IHandler } from "./dispatcher.js";

import { createOpenProjectHandler } from "./open-project.handler.js";
import { createSnapshotHandlers } from "./snapshot.handlers.js";
import { createListEndpointsHandler } from "./list-endpoints.handler.js";
import { createGetEndpointHandler } from "./get-endpoint.handler.js";
import { createGetSchemaHandler } from "./get-schema.handler.js";
import { createListServicesHandler } from "./list-services.handler.js";
import { createDryRunHandler } from "./dry-run.handler.js";
import { createExportHandler } from "./export.handler.js";
import { createHistoryHandlers } from "./history.handlers.js";
import { createWatchHandlers } from "./watch.handlers.js";
import { createCancelHandler } from "./cancel.handler.js";
import { createSettingsHandler } from "./settings.handlers.js";
import { createListProjectsHandler } from "./list-projects.handler.js";
import { createCloseHandler } from "./close.handler.js";

/**
 * The 14 handler names — the canonical enumeration the dispatcher
 * and the bridges share.
 *
 * Order is informational; the dispatcher looks up by name. The
 * list lives here (not duplicated in each handler file) so a
 * future lint gate that cross-references "every handler name
 * appears in handlers.ts" has one source.
 */
export const HANDLER_NAMES = [
  "open-project",
  "snapshot",
  "list-endpoints",
  "get-endpoint",
  "get-schema",
  "list-services",
  "dry-run",
  "export",
  "history",
  "watch",
  "cancel",
  "settings",
  "list-projects",
  "close",
] as const;

/** A static, read-only registry the dispatcher consumes. */
export function buildRegistry(): Readonly<Record<string, IHandler<unknown, unknown>>> {
  const snap = createSnapshotHandlers();
  const hist = createHistoryHandlers();
  const watch = createWatchHandlers();
  // Each typed handler is widened to `IHandler<unknown, unknown>`
  // at the registry boundary; the dispatcher's `.parse()` call
  // narrows back to the typed input before invoking `handle()`.
  const map: Record<string, IHandler<unknown, unknown>> = {
    "open-project": createOpenProjectHandler() as unknown as IHandler<unknown, unknown>,
    "snapshot": snap.current as unknown as IHandler<unknown, unknown>,
    "list-endpoints": createListEndpointsHandler() as unknown as IHandler<unknown, unknown>,
    "get-endpoint": createGetEndpointHandler() as unknown as IHandler<unknown, unknown>,
    "get-schema": createGetSchemaHandler() as unknown as IHandler<unknown, unknown>,
    "list-services": createListServicesHandler() as unknown as IHandler<unknown, unknown>,
    "dry-run": createDryRunHandler() as unknown as IHandler<unknown, unknown>,
    "export": createExportHandler() as unknown as IHandler<unknown, unknown>,
    "history": hist.list as unknown as IHandler<unknown, unknown>,
    "watch": watch.subscribe as unknown as IHandler<unknown, unknown>,
    "cancel": createCancelHandler() as unknown as IHandler<unknown, unknown>,
    "settings": createSettingsHandler() as unknown as IHandler<unknown, unknown>,
    "list-projects": createListProjectsHandler() as unknown as IHandler<unknown, unknown>,
    "close": createCloseHandler() as unknown as IHandler<unknown, unknown>,
  };
  // Note: `snapshot`, `history` and `watch` each ship two
  // sub-handlers in their respective files (`.current` /
  // `.subscribe`). We surface only one entry per name in the
  // dispatcher registry — the other handlers are still exported
  // for tests and for callers that need the second verb without
  // going through the dispatcher (e.g. the Web UI subscribing to
  // watch directly).
  return Object.freeze(map);
}

export type { IHandler } from "./dispatcher.js";