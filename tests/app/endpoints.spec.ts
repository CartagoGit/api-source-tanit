/**
 * The endpoint explorer, against the real backend.
 *
 * ## What these tests are for
 *
 * The client used to answer from a generator: five thousand endpoints
 * built out of an index number, each with an auth scheme nobody
 * detected and a source file that did not exist. A test that only
 * checked "the list has something in it" would have passed on that
 * fiction — and did.
 *
 * So these tests check the two things that matter:
 *
 *   · the client **asks the backend**, with the filter it was given,
 *     and draws what came back;
 *   · the filters go **to the backend** instead of being applied to
 *     a page the client happened to have.
 */
import { describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";

import { EndpointsClient } from "../../packages/app/src/app/core/api/endpoints.client";
import { EndpointsStore } from "../../packages/app/src/app/core/state/endpoints.store";
import { ProjectStore } from "../../packages/app/src/app/core/state/project.store";
import { HostBridgeClient } from "../../packages/app/src/app/core/api/host-bridge.client";

/** A bridge that answers with two endpoints and counts the calls. */
function fakeBridge(): {
  bridge: { request: (operation: string, input: unknown) => Promise<unknown> };
  calls: Array<{ operation: string; input: unknown }>;
} {
  const calls: Array<{ operation: string; input: unknown }> = [];
  const bridge = {
    request: vi.fn(async (operation: string, input: unknown) => {
      calls.push({ operation, input });
      if (operation === "list-endpoints") {
        return {
          endpoints: [
            {
              method: "GET",
              uri: "/users",
              name: "listUsers",
              serviceId: "api",
              description: "List the users",
              transport: "http",
              auth: "bearer",
              validation: "zod",
              framework: "express",
              confidence: "high",
              responses: ["200", "404"],
              sourceFile: "src/routes/users.ts",
              line: 12,
            },
            {
              method: "POST",
              uri: "/users",
              name: "createUser",
              serviceId: "api",
              transport: "http",
              auth: "none",
              validation: "none",
              framework: "express",
            },
          ],
          nextCursor: null,
          total: 2,
          indexedTotal: 7,
        };
      }
      if (operation === "get-endpoint") {
        return {
          endpoint: {
            fields: [
              { fieldName: "email", location: "body", type: "string", required: true },
            ],
            responses: [{ status: 200, reason: "The user", schema: { type: "object" } }],
          },
          serviceId: "api",
        };
      }
      if (operation === "get-schema") {
        return { schema: { kind: "fields", fields: [{ fieldName: "email" }] } };
      }
      throw new Error(`unexpected operation: ${operation}`);
    }),
  };
  return { bridge, calls };
}

describe("EndpointsClient", () => {
  it("asks the backend and draws what came back", async () => {
    const { bridge, calls } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [EndpointsClient, { provide: HostBridgeClient, useValue: bridge }],
    });
    const client = TestBed.runInInjectionContext(() => new EndpointsClient());

    const result = await client.list("/workspace");

    expect(calls[0]?.operation).toBe("list-endpoints");
    expect(calls[0]?.input).toMatchObject({ projectRoot: "/workspace" });
    expect(result.endpoints).toHaveLength(2);
    expect(result.endpoints[0]).toMatchObject({
      id: "GET /users",
      operationId: "listUsers",
      service: "api",
      framework: "express",
      auth: "bearer",
      validation: "zod",
      responseSummary: "200, 404",
      sourceFile: "src/routes/users.ts",
      line: 12,
      confidence: "high",
    });
    // The count of the project, not of the page.
    expect(result.total).toBe(2);
    expect(result.indexedTotal).toBe(7);
  });

  it("sends the filter to the backend instead of filtering the page", async () => {
    const { bridge, calls } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [EndpointsClient, { provide: HostBridgeClient, useValue: bridge }],
    });
    const client = TestBed.runInInjectionContext(() => new EndpointsClient());

    await client.list("/workspace", {
      service: "api",
      transport: "http",
      auth: "bearer",
      search: "users",
    });

    expect(calls[0]?.input).toMatchObject({
      service: "api",
      transport: "http",
      auth: "bearer",
      search: "users",
    });
  });

  it("walks the pages until the backend says there are no more", async () => {
    const pages = [
      { endpoints: [{ method: "GET", uri: "/a", name: "a", serviceId: "s" }], nextCursor: "1", total: 2, indexedTotal: 2 },
      { endpoints: [{ method: "GET", uri: "/b", name: "b", serviceId: "s" }], nextCursor: null, total: 2, indexedTotal: 2 },
    ];
    let call = 0;
    const bridge = {
      request: vi.fn(async () => pages[call++]),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [EndpointsClient, { provide: HostBridgeClient, useValue: bridge }],
    });
    const client = TestBed.runInInjectionContext(() => new EndpointsClient());

    const result = await client.list("/workspace");

    expect(result.endpoints).toHaveLength(2);
    expect(call).toBe(2);
  });

  it("fetches the detail of one endpoint", async () => {
    const { bridge } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [EndpointsClient, { provide: HostBridgeClient, useValue: bridge }],
    });
    const client = TestBed.runInInjectionContext(() => new EndpointsClient());

    const detail = await client.detail("/workspace", "GET", "/users");

    expect(detail.parameters).toEqual([
      { name: "email", location: "body", required: true, type: "string" },
    ]);
    expect(detail.responses[0]).toMatchObject({ status: "200", description: "The user" });
    expect(detail.requestSchema).toMatchObject({ kind: "fields" });
  });
});

describe("EndpointsStore", () => {
  it("keeps the endpoints the backend answered with", async () => {
    const { bridge } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        EndpointsStore,
        EndpointsClient,
        ProjectStore,
        { provide: HostBridgeClient, useValue: bridge },
      ],
    });
    const project = TestBed.inject(ProjectStore);
    const store = TestBed.inject(EndpointsStore);
    project.projectRoot.set("/workspace");

    await store.refresh();

    expect(store.all()).toHaveLength(2);
    expect(store.total()).toBe(2);
    expect(store.indexedTotal()).toBe(7);
    expect(store.error()).toBeNull();
  });

  it("says what went wrong instead of showing an empty list", async () => {
    const bridge = {
      request: vi.fn(async () => {
        throw new Error("No open session for projectRoot \"/workspace\"");
      }),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        EndpointsStore,
        EndpointsClient,
        ProjectStore,
        { provide: HostBridgeClient, useValue: bridge },
      ],
    });
    const project = TestBed.inject(ProjectStore);
    const store = TestBed.inject(EndpointsStore);
    project.projectRoot.set("/workspace");

    await store.refresh();

    expect(store.error()).toContain("No open session");
    expect(store.all()).toHaveLength(0);
  });

  it("does nothing without a project", async () => {
    const { bridge, calls } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        EndpointsStore,
        EndpointsClient,
        ProjectStore,
        { provide: HostBridgeClient, useValue: bridge },
      ],
    });
    const store = TestBed.inject(EndpointsStore);

    await store.refresh();

    expect(calls).toHaveLength(0);
    expect(store.all()).toHaveLength(0);
  });
});
