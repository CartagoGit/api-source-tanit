/**
 * `browse.handler.ts` — listing the folders of the machine.
 *
 * ## Why it exists
 *
 * The desktop app needs a folder picker: typing an absolute path by
 * hand is where the mistakes happen. It reached for the CLI's web
 * interface over HTTP — to `/api/browse`, a route that only the CLI's
 * own interface served.
 *
 * In the browser carrier that route does not exist (the app is served
 * next to the Application API, not next to the CLI's interface). In
 * the desktop carrier there is no HTTP at all: the app talks to the
 * sidecar over stdio. So the folder list was **dead in both**, and
 * the app's Home screen would have thrown before showing anything.
 *
 * The implementation moved to the core (`browse.service.ts`) and this
 * handler exposes it: one listing, reachable from every carrier.
 *
 * ## It needs no session
 *
 * Browsing is about the machine, not about a project: there is no
 * open project yet when the folder list is being browsed. So this
 * handler does not look a session up — it is the one operation that
 * answers before anything is open.
 */
import type { IHandler } from "./dispatcher.js";
import { BrowseInputSchema, type BrowseInput } from "./zod-schemas.js";
import { browseDirectory } from "./browse.service.js";
import type { BrowseOutput } from "../../contracts/interfaces/core/application-api.interface.js";

/** Creates the handler that lists folders. */
export function createBrowseHandler(): IHandler<BrowseInput, BrowseOutput> {
  return {
    name: "browse",
    input: BrowseInputSchema,
    async handle(input) {
      const listing = await browseDirectory(input.path);
      return { listing };
    },
  };
}
