import { describe, expect, it } from "vitest";

import { redactSecret } from "../../packages/app/src/app/core/api/push.client";
import { LiveStore } from "../../packages/app/src/app/core/state/live.store";

/**
 * The app's own half of the parity.
 *
 * The other half — does every command the CLI dispatches have a
 * counterpart in the app, and does the app ask for operations that
 * exist — needs the CLI's registry, and the app may not import from
 * the CLI. It lives with the gate that checks it, in
 * `tests/scripts-gates/cli-app-parity.spec.ts`.
 */
describe("CLI and GUI parity", () => {
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