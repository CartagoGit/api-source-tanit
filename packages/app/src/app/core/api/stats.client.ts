import { Injectable, inject } from "@angular/core";

import { HostBridgeClient } from "./host-bridge.client";
import type {
  IStatsResult,
  StatsOutput,
} from "../../../../../contracts/interfaces/core/application-api.interface";

/**
 * The collection statistics.
 *
 * ## What it used to be
 *
 * Nothing: the counting lived in the CLI, so the app could not ask
 * for it. The counts the CLI prints — per method, per zone — had no
 * counterpart in the app.
 *
 * ## What it is
 *
 * The counting moved to the core and the Application API exposes it,
 * so the numbers the app shows are the numbers the CLI prints.
 */
@Injectable({ providedIn: "root" })
export class StatsClient {
  private readonly bridge = inject(HostBridgeClient);

  /**
   * Measures a collection.
   *
   * @param projectRoot The open project.
   * @param collectionPath The collection to measure, when it is not the project's own.
   */
  async stats(projectRoot: string, collectionPath?: string): Promise<IStatsResult> {
    const answer = (await this.bridge.request("stats", {
      projectRoot,
      ...(collectionPath !== undefined ? { collectionPath } : {}),
    })) as StatsOutput;
    return answer.stats;
  }
}
