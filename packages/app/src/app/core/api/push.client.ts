import { Injectable, inject } from "@angular/core";
import { HostBridgeClient } from "./host-bridge.client";

export interface PushRequest {
  readonly projectRoot: string;
  readonly workspace?: string;
  readonly dryRun?: boolean;
  readonly apiKey?: string;
}

@Injectable({ providedIn: "root" })
export class PushClient {
  private readonly bridge = inject(HostBridgeClient);

  async push(request: PushRequest, signal?: AbortSignal) {
    const attempts = 3;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      try {
        return await this.bridge.request("push", { projectRoot: request.projectRoot });
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