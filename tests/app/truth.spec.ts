/**
 * The app tells the truth.
 *
 * ## What these tests are for
 *
 * The app used to fill the gaps the backend left with plausible
 * values. An endpoint whose framework nobody had recognized was
 * drawn as `"unknown"` — which reads like a framework *named*
 * unknown. An endpoint whose auth nobody had checked was drawn as
 * `"none"` — which says the route is open. An endpoint whose
 * transport nobody had looked at was drawn as `"http"`.
 *
 * A screen that says "no auth" when nobody looked is worse than a
 * screen that says "not reported": the first one is a claim, and
 * somebody will trust it.
 *
 * These tests pin the honest behaviour: what the backend did not say
 * stays unsaid.
 */
import { describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";

import { EndpointsClient } from "../../packages/app/src/app/core/api/endpoints.client";
import { ExportsClient } from "../../packages/app/src/app/core/api/exports.client";
import { ExportsStore } from "../../packages/app/src/app/core/state/exports.store";
import { EndpointsStore } from "../../packages/app/src/app/core/state/endpoints.store";
import { ProjectStore } from "../../packages/app/src/app/core/state/project.store";
import { HostBridgeClient } from "../../packages/app/src/app/core/api/host-bridge.client";

/** A bridge that answers with what the test says. */
function bridgeOf(answers: Record<string, (input: unknown) => unknown>): {
  bridge: {
    request: (operation: string, input: unknown) => Promise<unknown>;
    subscribe: (listener: (event: unknown) => void) => () => void;
  };
  calls: Array<{ operation: string; input: unknown }>;
} {
  const calls: Array<{ operation: string; input: unknown }> = [];
  const bridge = {
    request: vi.fn(async (operation: string, input: unknown) => {
      calls.push({ operation, input });
      const answer = answers[operation];
      if (answer === undefined) throw new Error(`unexpected operation: ${operation}`);
      return answer(input);
    }),
    subscribe: vi.fn(() => () => undefined),
  };
  return { bridge, calls };
}

/** Configures the injector with the given bridge. */
function withBridge(bridge: unknown): void {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: HostBridgeClient, useValue: bridge }],
  });
}

describe("the endpoint list does not invent", () => {
  it("leaves the fields the backend did not say unsaid", async () => {
    const { bridge } = bridgeOf({
      "list-endpoints": () => ({
        endpoints: [{ method: "GET", uri: "/ping", name: "ping" }],
        nextCursor: null,
        total: 1,
        indexedTotal: 1,
      }),
    });
    withBridge(bridge);
    const client = TestBed.runInInjectionContext(() => new EndpointsClient());

    const result = await client.list("/workspace");

    const record = result.endpoints[0];
    expect(record?.service).toBeUndefined();
    expect(record?.framework).toBeUndefined();
    expect(record?.transport).toBeUndefined();
    expect(record?.auth).toBeUndefined();
    expect(record?.validation).toBeUndefined();
  });

  it("keeps what the backend did say", async () => {
    const { bridge } = bridgeOf({
      "list-endpoints": () => ({
        endpoints: [
          {
            method: "GET",
            uri: "/users",
            name: "listUsers",
            serviceId: "api",
            transport: "http",
            auth: "bearer",
            validation: "zod",
            framework: "express",
          },
        ],
        nextCursor: null,
        total: 1,
        indexedTotal: 1,
      }),
    });
    withBridge(bridge);
    const client = TestBed.runInInjectionContext(() => new EndpointsClient());

    const result = await client.list("/workspace");

    expect(result.endpoints[0]).toMatchObject({
      service: "api",
      transport: "http",
      auth: "bearer",
      validation: "zod",
      framework: "express",
    });
  });

  it("does not answer with a schema nobody produced", async () => {
    const { bridge } = bridgeOf({
      "list-endpoints": () => ({
        endpoints: [{ method: "GET", uri: "/ping", name: "ping" }],
        nextCursor: null,
        total: 1,
        indexedTotal: 1,
      }),
      "get-endpoint": () => ({ endpoint: { fields: [] }, serviceId: "api" }),
      // The schema is not there: the scanner did not find one.
      "get-schema": () => {
        throw new Error("not found");
      },
    });
    withBridge(bridge);
    const client = TestBed.runInInjectionContext(() => new EndpointsClient());

    const detail = await client.detail("/workspace", "GET", "/ping");

    // It used to be `{ kind: "none" }`: a schema-shaped object that
    // the panel could not tell from a real empty schema.
    expect(detail.requestSchema).toBeUndefined();
  });

  it("stops the walk when the cursor repeats, instead of spinning", async () => {
    let call = 0;
    const bridge = {
      request: vi.fn(async () => {
        call += 1;
        return {
          endpoints: [{ method: "GET", uri: "/a", name: "a", serviceId: "s" }],
          nextCursor: "same",
          total: 99,
          indexedTotal: 99,
        };
      }),
      subscribe: vi.fn(() => () => undefined),
    };
    withBridge(bridge);
    const client = TestBed.runInInjectionContext(() => new EndpointsClient());

    await expect(client.list("/workspace")).rejects.toThrow(/cursor/i);
    // Two calls: the first, and the one that repeated the cursor.
    expect(call).toBe(2);
  });
});

describe("the export preview does not invent", () => {
  it("keeps the exporter's own diagnostic code", async () => {
    const { bridge } = bridgeOf({
      "dry-run": () => ({
        endpointCount: 3,
        frameworks: ["express"],
        warnings: [],
        durationMs: 4,
        files: [],
        formats: [{ id: "postman", summary: "The Postman collection" }],
        diagnostics: [
          { code: "AUTH_LOSSY", severity: "warning", message: "Bearer tokens become headers." },
        ],
      }),
    });
    withBridge(bridge);
    const client = TestBed.runInInjectionContext(() => new ExportsClient());

    const preview = await client.preview("/workspace", "postman", "/out", "/workspace");

    // The app used to answer with the code "EXPORT_WARNING" and a
    // suggestion nobody wrote.
    expect(preview.diagnostics[0]).toEqual({
      code: "AUTH_LOSSY",
      severity: "warning",
      message: "Bearer tokens become headers.",
    });
  });
});

describe("the export honours the confirmation", () => {
  it("does not write when the overwrite was not confirmed", async () => {
    const written: string[] = [];
    const { bridge } = bridgeOf({
      "dry-run": () => ({
        endpointCount: 1,
        frameworks: [],
        warnings: [],
        durationMs: 1,
        files: [{ path: "/workspace/tanit/collection.json", change: "UPDATE", bytes: 10 }],
        formats: [],
        diagnostics: [],
      }),
      "export": () => {
        written.push("export");
        return { outputPath: "/workspace/tanit/collection.json", bytes: 10, files: ["/workspace/tanit/collection.json"] };
      },
    });
    withBridge(bridge);
    const project = TestBed.inject(ProjectStore);
    const store = TestBed.runInInjectionContext(() => new ExportsStore());
    project.projectRoot.set("/workspace");

    await store.refresh();
    expect(store.preview().requiresOverwriteConfirmation).toBe(true);

    await store.generate();

    expect(written).toHaveLength(0);
    expect(store.error()).toContain("Confirm the overwrite");
  });

  it("writes once the overwrite was confirmed", async () => {
    const written: string[] = [];
    const { bridge } = bridgeOf({
      "dry-run": () => ({
        endpointCount: 1,
        frameworks: [],
        warnings: [],
        durationMs: 1,
        files: [{ path: "/workspace/tanit/collection.json", change: "UPDATE", bytes: 10 }],
        formats: [],
        diagnostics: [],
      }),
      "export": () => {
        written.push("export");
        return { outputPath: "/workspace/tanit/collection.json", bytes: 10, files: ["/workspace/tanit/collection.json"] };
      },
    });
    withBridge(bridge);
    const project = TestBed.inject(ProjectStore);
    const store = TestBed.runInInjectionContext(() => new ExportsStore());
    project.projectRoot.set("/workspace");

    await store.refresh();
    store.confirmOverwrite(true);
    await store.generate();

    expect(written).toHaveLength(1);
    expect(store.error()).toBeNull();
  });
});

describe("the state belongs to one project", () => {
  it("is cleared when the open project changes", async () => {
    const { bridge } = bridgeOf({
      "list-endpoints": () => ({
        endpoints: [{ method: "GET", uri: "/a", name: "a", serviceId: "s" }],
        nextCursor: null,
        total: 1,
        indexedTotal: 1,
      }),
    });
    withBridge(bridge);
    const project = TestBed.inject(ProjectStore);
    const store = TestBed.runInInjectionContext(() => new EndpointsStore());

    project.projectRoot.set("/workspace");
    await store.refresh();
    expect(store.all()).toHaveLength(1);

    project.projectRoot.set("/other");
    TestBed.flushEffects();

    // The endpoints of the previous project must not stay on
    // screen: the explorer was showing another project's routes.
    expect(store.all()).toHaveLength(0);
    expect(store.total()).toBe(0);
  });
});
