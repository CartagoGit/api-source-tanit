import { Injectable, inject } from "@angular/core";

import { HostBridgeClient } from "./host-bridge.client";
import type { SyncOutput } from "../../../../../contracts/interfaces/core/application-api.interface";

/**
 * Generate and write, in one verb.
 *
 * ## What it used to be
 *
 * A call to an operation that had no handler: `sync` was a wrapper
 * around `generate` inside the CLI, and the app could not ask for
 * it. Its screen could only ever say "not available yet".
 *
 * ## What it is
 *
 * The composition moved to the core and the Application API exposes
 * it, so the app asks for it like any other operation.
 */
@Injectable({ providedIn: "root" })
export class SyncClient {
  private readonly bridge = inject(HostBridgeClient);

  /**
   * Generates and writes the artifacts.
   *
   * @param projectRoot The open project.
   * @param options The format, the folder, and whether to only preview.
   */
  async sync(
    projectRoot: string,
    options: {
      readonly target?: string;
      readonly outputDirectory?: string;
      readonly dryRun?: boolean;
    } = {},
  ): Promise<SyncOutput> {
    return (await this.bridge.request("sync", {
      projectRoot,
      ...(options.target !== undefined ? { target: options.target } : {}),
      ...(options.outputDirectory !== undefined
        ? { outputDirectory: options.outputDirectory }
        : {}),
      ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
    })) as SyncOutput;
  }
}
