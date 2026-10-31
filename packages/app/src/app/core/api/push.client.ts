import { Injectable, inject } from "@angular/core";
import { HostBridgeClient } from "./host-bridge.client";
import type { PushRequest } from "../../../../../contracts/interfaces/core/push.interface";

export type { PushRequest } from "../../../../../contracts/interfaces/core/push.interface";

@Injectable({ providedIn: "root" })
export class PushClient {
  private readonly bridge = inject(HostBridgeClient);

  async push(request: PushRequest, signal?: AbortSignal) {
    // `push` has no handler yet: the upload logic exists in the core
    // and the CLI uses it, but it is not behind a handler, so the app
    // cannot call it. Declared pending, so the gap is a fact in the
    // code and not a surprise at runtime.
    const attempts = 3;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      try {
        return await this.bridge.requestPending("push", { projectRoot: request.projectRoot, workspace: request.workspace, dryRun: request.dryRun });
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