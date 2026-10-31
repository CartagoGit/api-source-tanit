import { Injectable, inject } from "@angular/core";
import { HostBridgeClient } from "./host-bridge.client";

@Injectable({ providedIn: "root" })
export class CheckClient {
  private readonly bridge = inject(HostBridgeClient);

  /**
   * `check` has no handler yet: the comparison between a generated
   * collection and the routes in the code lives in the CLI. The call
   * is declared as pending so the failure is visible instead of
   * hiding behind a screen that shows nothing.
   */
  check(projectRoot: string) {
    return this.bridge.requestPending("check", { projectRoot });
  }
}