import { describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";

import { redactSecret } from "../../packages/app/src/app/core/api/push.client";
import { LiveStore } from "../../packages/app/src/app/core/state/live.store";
import { ProjectStore } from "../../packages/app/src/app/core/state/project.store";
import { HostBridgeClient } from "../../packages/app/src/app/core/api/host-bridge.client";

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
    // The store takes the connector from the injector now, so it is
    // built the way Angular builds it.
    const bridge = {
      request: vi.fn(async () => ({})),
      subscribe: vi.fn(() => () => undefined),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: HostBridgeClient, useValue: bridge }],
    });
    const store = TestBed.runInInjectionContext(() => new LiveStore());
    expect(store.autoExport()).toBe(false);
    const project = TestBed.inject(ProjectStore);
    project.projectRoot.set("/workspace");
    project.sessionId.set("session-1");
    store.enabled.set(true);
    store.update({ jsonrpc: "2.0", method: "tanit/live", params: {
      type: "snapshot-ready", subscriptionId: "sub-1", sessionId: "session-1", projectRoot: "/workspace",
      changedPaths: [], sourceFileCount: 3, summary: { sessionId: "session-1", projectRoot: "/workspace",
        capturedAt: new Date().toISOString(), frameworks: [], endpointCount: 1, serviceCount: 1, diagnostics: [] },
    } });
    store.update({ jsonrpc: "2.0", method: "tanit/live", params: {
      type: "snapshot-stale", subscriptionId: "sub-1", sessionId: "session-1", projectRoot: "/workspace",
      changedPaths: ["src/routes.ts"],
    } });
    expect(store.sourceFileCount()).toBe(3);
    expect(store.changes()[0]?.kind).toBe("modified");
  });

  it("redacts Postman keys from push diagnostics", () => {
    expect(redactSecret(new Error("429 pmak-super-secret-key"))).toBe("429 [REDACTED]");
  });
});