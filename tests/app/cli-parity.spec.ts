import { describe, expect, it } from "vitest";
import { main as syncMain } from "../../packages/cli/commands/sync.script";
import { redactSecret } from "../../packages/app/src/app/core/api/push.client";
import { LiveStore } from "../../packages/app/src/app/core/state/live.store";

describe("CLI and GUI parity", () => {
  it("exposes sync as the same generation carrier", () => {
    expect(typeof syncMain).toBe("function");
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