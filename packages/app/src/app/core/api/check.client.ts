import { Injectable, inject } from "@angular/core";
import { HostBridgeClient } from "./host-bridge.client";
import type {
  CheckOutput,
  ICheckReport,
} from "../../../../../contracts/interfaces/core/application-api.interface";

/**
 * The drift check.
 *
 * ## What it used to be
 *
 * A call to an operation that had no handler: the comparison between
 * a generated collection and the routes in the code lived in the
 * CLI. The app's check screen could only ever say "not available
 * yet".
 *
 * ## What it is
 *
 * The comparison moved to the core and the Application API exposes
 * it, so the app asks for it like any other operation — and the
 * answer is the answer, not a promise of one.
 */
@Injectable({ providedIn: "root" })
export class CheckClient {
  private readonly bridge = inject(HostBridgeClient);

  /**
   * Compares the collection with the routes in the code.
   *
   * @param projectRoot The open project.
   * @param collectionPath The collection to compare, when it is not the project's own.
   */
  async check(projectRoot: string, collectionPath?: string): Promise<ICheckReport> {
    const answer = (await this.bridge.request("check", {
      projectRoot,
      ...(collectionPath !== undefined ? { collectionPath } : {}),
    })) as CheckOutput;
    return answer.report;
  }
}