import { describe, expect, it } from "vitest";
import { redactSecret } from "../../packages/app/src/app/core/api/push.client";
import { LiveStore } from "../../packages/app/src/app/core/state/live.store";
import type { IHostBridge } from "../../packages/contracts/interfaces/ui/host-bridge.interface";

describe("CLI and GUI parity", () => {
  it("exposes sync through the shared host contract", async () => {
    const bridge: IHostBridge = {
      request: async (operation, input) => {
        expect(operation).toBe("sync");
        expect(input).toEqual({ projectRoot: "/workspace" });
        return { synced: true };
      },
      subscribe: () => () => undefined,
    };

    await expect(bridge.request("sync", { projectRoot: "/workspace" })).resolves.toEqual({ synced: true });
  });

  it("keeps live auto-export disabled by default and reports changes", () => {
    const store = new LiveStore();
    expect(store.autoExport()).toBe(false);
    store.update({ sourceFileCount: 3, changes: [{ kind: "added", path: "src/routes.ts" }] });
    expect(store.sourceFileCount()).toBe(3);
    expect(store.changes()[0]?.kind).toBe("added");
  });

  it("redacts Postman keys from push diagnostics", () => {
    expect(redactSecret(new Error("429 pmak-super-secret-key"))).toBe("429 [REDACTED]");
  });
});