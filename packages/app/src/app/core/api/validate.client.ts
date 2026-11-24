import { Injectable, inject } from "@angular/core";

import { HostBridgeClient } from "./host-bridge.client";
import type {
  IValidationResult,
  ValidateOutput,
} from "../../../../../contracts/interfaces/core/application-api.interface";

/**
 * The collection validator.
 *
 * ## What it used to be
 *
 * A call to an operation that had no handler: the invariants of a
 * well-formed Postman collection lived in the CLI. The app's
 * validation screen could only ever say "not available yet".
 *
 * ## What it is
 *
 * The invariants moved to the core and the Application API exposes
 * them, so the app asks for them like any other operation.
 */
@Injectable({ providedIn: "root" })
export class ValidateClient {
  private readonly bridge = inject(HostBridgeClient);

  /**
   * Checks a collection.
   *
   * @param projectRoot The open project.
   * @param collectionPath The collection to check, when it is not the project's own.
   */
  async validate(projectRoot: string, collectionPath?: string): Promise<IValidationResult> {
    const answer = (await this.bridge.request("validate", {
      projectRoot,
      ...(collectionPath !== undefined ? { collectionPath } : {}),
    })) as ValidateOutput;
    return answer.result;
  }
}
