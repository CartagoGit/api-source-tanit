import { Injectable, inject } from "@angular/core";
import { HostBridgeClient } from "./host-bridge.client";

@Injectable({ providedIn: "root" })
export class CheckClient {
  private readonly bridge = inject(HostBridgeClient);

  check(projectRoot: string) {
    return this.bridge.request("check", { projectRoot });
  }
}