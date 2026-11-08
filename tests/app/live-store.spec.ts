import { afterEach, describe, expect, test, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { signal } from "@angular/core";
import { HostBridgeClient } from "../../packages/app/src/app/core/api/host-bridge.client";
import { ProjectStore } from "../../packages/app/src/app/core/state/project.store";
import { ExportsClient } from "../../packages/app/src/app/core/api/exports.client";
import { ExportsStore } from "../../packages/app/src/app/core/state/exports.store";
import { LiveStore } from "../../packages/app/src/app/core/state/live.store";

function setup() {
  TestBed.resetTestingModule();
  const request = vi.fn(async (_operation: string, _input: unknown) => ({
    subscription: { subscriptionId: "sub-1", projectRoot: "/workspace", onlyPaths: null }, cancelled: 1,
  }));
  const exports = { regenerate: vi.fn().mockResolvedValue(undefined), error: signal<string | null>(null),
    result: signal({ files: [{ path: "/workspace/tanit/api.json" }] }) };
  TestBed.configureTestingModule({ providers: [
    { provide: HostBridgeClient, useValue: { request, subscribe: () => () => undefined } },
    { provide: ExportsStore, useValue: exports },
  ] });
  const project = TestBed.inject(ProjectStore);
  project.projectRoot.set("/workspace");
  project.sessionId.set("session-1");
  const store = TestBed.runInInjectionContext(() => new LiveStore());
  return { store, project, request, exports };
}

function ready(changedPaths = ["src/routes.ts"]) {
  return { jsonrpc: "2.0", method: "tanit/live", params: {
    type: "snapshot-ready", projectRoot: "/workspace", sessionId: "session-1", subscriptionId: "sub-1",
    changedPaths, sourceFileCount: 3, summary: { projectRoot: "/workspace", sessionId: "session-1",
      capturedAt: "2026-11-08T01:00:00Z", frameworks: ["express"], endpointCount: 5, serviceCount: 1, diagnostics: [] },
  } };
}

afterEach(() => TestBed.resetTestingModule());

describe("live store common events", () => {
  test("updates the current summary and ignores another session's snapshot", async () => {
    const { store, project } = setup();
    await store.setEnabled(true, "/workspace");
    const other = ready(); other.params.sessionId = "other"; other.params.summary.sessionId = "other";
    store.update(other);
    expect(project.summary()).toBeNull();
    store.update(ready());
    expect(project.summary()?.endpointCount).toBe(5);
    expect(store.sourceFileCount()).toBe(3);
  });

  test("an enable response arriving after cancellation is immediately released", async () => {
    const { store, request } = setup();
    let resolve!: (value: Awaited<ReturnType<typeof request>>) => void;
    request.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const enabling = store.setEnabled(true, "/workspace");
    await store.setEnabled(false, "/workspace");
    resolve({ subscription: { subscriptionId: "sub-late", projectRoot: "/workspace", onlyPaths: null }, cancelled: 0 });
    await enabling;
    expect(store.enabled()).toBe(false);
    expect(store.subscriptionId()).toBeNull();
    expect(request).toHaveBeenLastCalledWith("cancel", { subscriptionId: "sub-late" });
  });

  test("regenerates through the Export Center and prevents a feedback loop from its output", async () => {
    const { store, exports } = setup();
    await store.setEnabled(true, "/workspace");
    store.setAutoExport(true);
    store.update(ready([]));
    store.update(ready(["tanit/api.json", "tanit/.123-1.tmp"]));
    store.update(ready(["tanit"]));
    expect(exports.regenerate).not.toHaveBeenCalled();
    store.update(ready(["src/routes.ts"]));
    await vi.waitFor(() => expect(exports.regenerate).toHaveBeenCalledTimes(1));
  });

  test("coalesces export events received while the previous write is running", async () => {
    const { store, exports } = setup();
    await store.setEnabled(true, "/workspace");
    store.setAutoExport(true);
    let finish!: () => void;
    exports.regenerate.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    store.update(ready()); store.update(ready()); store.update(ready());
    expect(exports.regenerate).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(exports.regenerate).toHaveBeenCalledTimes(2));
  });

  test("reports a lost carrier and clears the watch toggle", async () => {
    const { store, request } = setup();
    await store.setEnabled(true, "/workspace");
    store.update({ jsonrpc: "2.0", method: "tanit/connection-error", params: { subscriptionId: "sub-1", message: "Disconnected" } });
    expect(store.enabled()).toBe(false);
    expect(store.error()).toBe("Disconnected");
    expect(request).toHaveBeenLastCalledWith("cancel", { subscriptionId: "sub-1" });
  });
});


describe("autoexport preserves Export Center consent", () => {
  function exportSetup() {
    TestBed.resetTestingModule();
    const preview = vi.fn(async (_root: string, _target: string, directory: string) => ({
      files: [{ path: `${directory}/api.json`, change: "UPDATE", bytes: 10, overwriteRisk: true, outsideWorkspace: false }],
      diagnostics: [], canGenerate: true, requiresOverwriteConfirmation: true, requiresOutsideWorkspaceConfirmation: false,
    }));
    const generate = vi.fn(async (_root: string, _target: string, directory: string) => ({
      files: [{ path: `${directory}/api.json` }], outputDirectory: directory,
    }));
    TestBed.configureTestingModule({ providers: [
      { provide: HostBridgeClient, useValue: { request: vi.fn(), subscribe: () => () => undefined } },
      { provide: ExportsClient, useValue: { preview, generate, capabilities: async () => [] } },
    ] });
    const project = TestBed.inject(ProjectStore);
    project.projectRoot.set("/workspace"); project.sessionId.set("session-1");
    return { store: TestBed.inject(ExportsStore), project, generate, preview };
  }

  test("does not overwrite an unrelated existing destination without the original confirmation", async () => {
    const { store, generate } = exportSetup();
    await store.regenerate();
    expect(generate).not.toHaveBeenCalled();
    expect(store.error()).not.toBeNull();
  });

  test("repeats a previously approved artifact without prompting on every source edit", async () => {
    const { store, generate } = exportSetup();
    await store.refresh(); store.confirmOverwrite(true); await store.generate();
    expect(generate).toHaveBeenCalledTimes(1);
    await store.regenerate();
    expect(generate).toHaveBeenCalledTimes(2);
    store.setOutputDirectory("/another-destination");
    await store.regenerate();
    expect(generate).toHaveBeenCalledTimes(2);
  });

  test("a project switch while previewing never writes the new project using the old preview", async () => {
    const { store, project, preview, generate } = exportSetup();
    let finish!: (value: Awaited<ReturnType<typeof preview>>) => void;
    preview.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const updating = store.regenerate();
    project.projectRoot.set("/another-project");
    finish({ files: [], diagnostics: [], canGenerate: true, requiresOverwriteConfirmation: false, requiresOutsideWorkspaceConfirmation: false });
    await updating;
    expect(generate).not.toHaveBeenCalled();
  });
});
