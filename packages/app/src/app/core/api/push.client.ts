import { Injectable, inject } from "@angular/core";
import { HostBridgeClient } from "./host-bridge.client";
import type { PushRequest } from "../../../../../contracts/interfaces/core/push.interface";
import type { PushOutput } from "../../../../../contracts/interfaces/core/application-api.interface";

export type { PushRequest } from "../../../../../contracts/interfaces/core/push.interface";

/**
 * Uploading the collection to Postman.
 *
 * ## What it used to be
 *
 * A call to an operation that had no handler: the upload lived in
 * the CLI. The app's push screen could only ever say "not available
 * yet", however good the key it had saved was.
 *
 * ## What it is
 *
 * The upload moved to the core and the Application API exposes it.
 *
 * The key travels **with the request**, because the app's key lives
 * in the app's own secure storage and the sidecar's environment is
 * not something a user can set from a window. It does not come
 * back: the answer says what happened, not what was used.
 */
@Injectable({ providedIn: "root" })
export class PushClient {
  private readonly bridge = inject(HostBridgeClient);

  /**
   * Uploads the collection.
   *
   * @param request The project, the key, and the options.
   * @param signal A signal to abort the upload.
   */
  async push(request: PushRequest, signal?: AbortSignal): Promise<PushOutput> {
    const attempts = 3;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      try {
        return (await this.bridge.request("push", {
          projectRoot: request.projectRoot,
          ...(request.apiKey !== undefined ? { apiKey: request.apiKey } : {}),
          ...(request.workspace !== undefined ? { workspaceId: request.workspace } : {}),
          ...(request.dryRun !== undefined ? { dryRun: request.dryRun } : {}),
        })) as PushOutput;
      } catch (error) {
        if (!isRateLimit(error) || attempt === attempts - 1) throw new Error(redactSecret(error));
        await waitForRetry(attempt, signal);
      }
    }
    throw new Error("Push failed without exposing credentials.");
  }
}

export function redactSecret(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(?:pmak|pma)[-_a-z0-9]+/gi, "[REDACTED]");
}

function isRateLimit(error: unknown): boolean {
  return /429|rate.?limit/i.test(error instanceof Error ? error.message : String(error));
}

async function waitForRetry(attempt: number, signal?: AbortSignal): Promise<void> {
  const delayMs = 100 * 2 ** attempt;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Cancelled", "AbortError"));
    }, { once: true });
  });
}