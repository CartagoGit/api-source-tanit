import { Injectable, inject } from "@angular/core";

import { HostBridgeClient } from "./host-bridge.client";
import type { IBrowseListing } from "../../../../../contracts/interfaces/core/browse.interface";

export type { IBrowseListing } from "../../../../../contracts/interfaces/core/browse.interface";

/**
 * Listing folders, to pick a project.
 *
 * ## What was broken
 *
 * This client was a plain class with **no `@Injectable`**, and the
 * folder picker injected it. Angular could not build it: the Home
 * screen threw a `NullInjectorError` before it drew a single thing.
 *
 * It also fetched `/api/browse` over raw HTTP, without the token the
 * bridge sends — and that route only exists in the **CLI's** web
 * interface. The app is served next to the Application API, not next
 * to the CLI's interface, and in the desktop carrier there is no
 * HTTP at all. So even with the injection fixed, the listing would
 * have failed in both carriers.
 *
 * ## What it does now
 *
 * It asks through the **connector**, like everything else. The
 * Application API has a `browse` operation, so the folder list works
 * the same in the browser and in the desktop app.
 */
@Injectable({ providedIn: "root" })
export class RecentProjectsClient {
  private readonly bridge = inject(HostBridgeClient);

  /** The folders inside `path`. The home folder when nobody says. */
  async browse(path?: string): Promise<IBrowseListing> {
    const answer = await this.bridge.request("browse", path ? { path } : {});
    return answer.listing;
  }
}