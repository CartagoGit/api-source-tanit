/**
 * The connector — the only thing the app knows about the backend.
 *
 * `packages/app/src/app/core/api/host-bridge.client.ts` has two
 * carriers: Tauri (the sidecar over stdio) and the browser (the
 * bridge over HTTP). One contract, one frame, one place where the
 * answer is unwrapped.
 *
 * These tests cover the three faults that made the desktop app
 * unusable, because each of them was invisible until runtime:
 *
 *   · the Tauri answer arrived as **text** and was thrown away, so
 *     every request hung forever;
 *   · the listener was registered only for events, so a request
 *     waited for a response nobody was listening for;
 *   · nobody unwrapped the `ApiResult`, so the callers got the
 *     envelope instead of the value.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { ReadableStream as NodeReadableStream } from "node:stream/web";

import { HostBridgeClient } from "../../packages/app/src/app/core/api/host-bridge.client";

type Listener = (event: { payload: unknown }) => void;

const globals = globalThis as { __TAURI__?: unknown };
let originalTauri: unknown;

afterEach(() => {
  globals.__TAURI__ = originalTauri;
  delete globals.__TAURI__;
  delete document.documentElement.dataset.tanitToken;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Puts a Tauri-shaped global in place, and hands back its pieces. */
function fakeTauri(v2 = false): {
  invoke: ReturnType<typeof vi.fn>;
  emit(payload: unknown): void;
  listeners: Listener[];
} {
  const listeners: Listener[] = [];
  const invoke = vi.fn().mockResolvedValue(undefined);
  globals.__TAURI__ = {
    ...(v2 ? { core: { invoke } } : { invoke }),
    event: {
      listen: vi.fn(async (_name: string, callback: Listener) => {
        listeners.push(callback);
        return () => undefined;
      }),
    },
  };
  return {
    invoke,
    emit(payload: unknown) {
      for (const listener of listeners) listener({ payload });
    },
    listeners,
  };
}

describe("the connector", () => {
  test("resolves a Tauri request whose answer arrives as text", async () => {
    originalTauri = globals.__TAURI__;
    const tauri = fakeTauri();
    const client = new HostBridgeClient();

    const pending = client.request("list-services", { projectRoot: "/workspace" });

    // The Rust side emits the JSON-RPC line as a string.
    tauri.emit(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "ui-1",
        result: { ok: true, value: { services: [] } },
      }),
    );

    await expect(pending).resolves.toEqual({ services: [] });
  });

  test("uses core.invoke in a Tauri 2 window", async () => {
    originalTauri = globals.__TAURI__;
    const tauri = fakeTauri(true);
    const client = new HostBridgeClient();
    const pending = client.request("list-services", { projectRoot: "/workspace" });
    await vi.waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith("send_to_sidecar", expect.anything()));
    tauri.emit(JSON.stringify({ jsonrpc: "2.0", id: "ui-1", result: { ok: true, value: { services: [] } } }));
    await expect(pending).resolves.toEqual({ services: [] });
  });

  test("registers the listener before asking, so the answer is not missed", async () => {
    originalTauri = globals.__TAURI__;
    const tauri = fakeTauri();
    const client = new HostBridgeClient();

    tauri.invoke.mockImplementation(async () => {
      expect(tauri.listeners.length).toBe(1);
      tauri.emit(JSON.stringify({ jsonrpc: "2.0", id: "ui-1", result: { services: [] } }));
    });
    await expect(client.request("list-services", { projectRoot: "/workspace" })).resolves.toEqual({ services: [] });
  });

  test("unwraps the ApiResult the bridge answers with", async () => {
    originalTauri = globals.__TAURI__;
    const tauri = fakeTauri();
    const client = new HostBridgeClient();

    const pending = client.request("list-services", { projectRoot: "/workspace" });
    tauri.emit(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "ui-1",
        result: { ok: true, value: { services: [{ serviceId: "api" }] } },
      }),
    );

    // The value, not the envelope.
    await expect(pending).resolves.toEqual({ services: [{ serviceId: "api" }] });
  });

  test("rejects with the message the backend sent", async () => {
    originalTauri = globals.__TAURI__;
    const tauri = fakeTauri();
    const client = new HostBridgeClient();

    const pending = client.request("open-project", { projectRoot: "/workspace" });
    tauri.emit(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "ui-1",
        error: { code: -32000, message: "SESSION_NOT_FOUND" },
      }),
    );

    await expect(pending).rejects.toThrow("SESSION_NOT_FOUND");
  });

  test("ignores an answer that is not JSON-RPC", async () => {
    originalTauri = globals.__TAURI__;
    const tauri = fakeTauri();
    const client = new HostBridgeClient();

    const pending = client.request("list-services", { projectRoot: "/workspace" });
    tauri.emit("not json at all");
    tauri.emit(JSON.stringify({ id: "ui-1", result: { ok: true, value: 1 } }));

    // The second frame has no `jsonrpc`, so it is not an answer and the
    // request keeps waiting — which is correct: pretending it answered
    // would hang the caller with a wrong value.
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
  });

  test("sends the same frame in both carriers", async () => {
    originalTauri = globals.__TAURI__;
    const tauri = fakeTauri();
    const client = new HostBridgeClient();

    tauri.invoke.mockImplementation(async () => {
      tauri.emit(JSON.stringify({ jsonrpc: "2.0", id: "ui-1", result: { services: [] } }));
    });
    await client.request("list-services", { projectRoot: "/workspace" });
    expect(tauri.invoke).toHaveBeenCalledWith("send_to_sidecar", {
      frame: JSON.stringify({
        jsonrpc: "2.0",
        id: "ui-1",
        method: "list-services",
        params: { projectRoot: "/workspace" },
      }),
    });
  });

  test("handles a desktop browse invoke failure and allows a retry", async () => {
    const tauri = fakeTauri(true);
    const client = new HostBridgeClient();
    tauri.invoke.mockRejectedValueOnce(new Error("sidecar disconnected"));
    await expect(client.request("browse", {})).rejects.toThrow("Tanit desktop service");
    tauri.invoke.mockImplementationOnce(async () => {
      tauri.emit({ jsonrpc: "2.0", id: "ui-2", result: { ok: true, value: { listing: { path: "/workspace" } } } });
    });
    await expect(client.request("browse", {})).resolves.toEqual({ listing: { path: "/workspace" } });
    expect(tauri.listeners).toHaveLength(1);
  });

  test("times out when desktop IPC does not return", async () => {
    vi.useFakeTimers();
    const tauri = fakeTauri(true);
    tauri.invoke.mockImplementationOnce(() => new Promise(() => undefined));
    const result = expect(new HostBridgeClient().request("browse", {})).rejects.toThrow("Tanit desktop service");
    await vi.advanceTimersByTimeAsync(5_000);
    await result;
  });

  test("rejects application errors emitted by the desktop sidecar", async () => {
    const tauri = fakeTauri(true);
    tauri.invoke.mockImplementationOnce(async () => {
      tauri.emit({ jsonrpc: "2.0", id: "ui-1", result: { ok: false, error: { message: "Permission denied" } } });
    });
    await expect(new HostBridgeClient().request("browse", {})).rejects.toThrow("Permission denied");
  });

});

describe("browser client usage", () => {
  test("explains the local service requirement when the site serves only HTML", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("<html>Static app</html>", { headers: { "content-type": "text/html" } }));
    await expect(new HostBridgeClient().request("client-usage", { projectRoot: "/frontend" }))
      .rejects.toThrow("local Tanit service");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("explains why workspace candidates cannot be read from a static copy", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("<html>Static app</html>", { headers: { "content-type": "text/html" } }));
    await expect(new HostBridgeClient().request("client-candidates", { projectRoot: "/frontend", role: "frontend" }))
      .rejects.toThrow("local Tanit service");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("preserves the real analysis error from the Application API", async () => {
    document.documentElement.dataset.tanitToken = "local-token";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({
      jsonrpc: "2.0", id: "ui-1", error: { code: -32603, message: "Backend directory unavailable" },
    }, { status: 500 }));
    await expect(new HostBridgeClient().request("client-usage", { projectRoot: "/frontend", backendRoot: "/backend" }))
      .rejects.toThrow("Backend directory unavailable");
  });
});

describe("browser folder browsing", () => {
  test("reports a static site and retries the local bridge after it becomes reachable", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("<html>Static app</html>", { headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(Response.json({ token: "local-token" }))
      .mockResolvedValueOnce(Response.json({
        jsonrpc: "2.0", id: "ui-2", result: { ok: true, value: { listing: { path: "/workspace" } } },
      }));
    const client = new HostBridgeClient();
    await expect(client.request("browse", {})).rejects.toThrow("apisrc ui");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(client.request("browse", { path: "/workspace" })).resolves.toEqual({ listing: { path: "/workspace" } });
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api", expect.objectContaining({
      headers: { "content-type": "application/json", "x-tanit-token": "local-token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "ui-2", method: "browse", params: { path: "/workspace" } }),
    }));
  });

  test.each(["bootstrap", "folder request"])("times out a stalled %s and aborts its fetch", async (phase) => {
    vi.useFakeTimers();
    if (phase === "folder request") document.documentElement.dataset.tanitToken = "local-token";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => undefined));
    const result = expect(new HostBridgeClient().request("browse", {})).rejects.toThrow("apisrc ui");
    await vi.advanceTimersByTimeAsync(5_000);
    await result;
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  test("keeps the Application API's folder errors", async () => {
    document.documentElement.dataset.tanitToken = "local-token";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({
      jsonrpc: "2.0", id: "ui-1", result: { ok: false, error: { message: "Permission denied" } },
    }));
    await expect(new HostBridgeClient().request("browse", {})).rejects.toThrow("Permission denied");
  });
});

describe("browser live carrier", () => {
  test("obtains the proxy token once before sending authenticated requests", async () => {
    delete globals.__TAURI__;
    delete document.documentElement.dataset.tanitToken;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      url === "/api/bootstrap"
        ? Response.json({ token: "proxy-token" })
        : Response.json({ jsonrpc: "2.0", id: "ui-1", result: { ok: true, value: { services: [] } } }),
    );
    try {
      const client = new HostBridgeClient();
      await Promise.all([
        client.request("list-services", { projectRoot: "/workspace" }),
        client.request("list-services", { projectRoot: "/workspace" }),
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/bootstrap", expect.objectContaining({
        headers: { "x-tanit-bootstrap": "1" },
      }));
      expect(fetchMock).toHaveBeenNthCalledWith(2, "/api", expect.objectContaining({
        headers: { "content-type": "application/json", "x-tanit-token": "proxy-token" },
      }));
    } finally {
      fetchMock.mockRestore();
    }
  });

  test("opens an authenticated stream after watch and cancels it with the subscription", async () => {
    delete globals.__TAURI__;
    document.documentElement.dataset.tanitToken = "local-token";
    const cancelled = vi.fn();
    vi.stubGlobal("ReadableStream", NodeReadableStream);
    let writer!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { writer = controller; }, cancel: cancelled });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (url === "/api/events") return new Response(stream, { headers: { "content-type": "application/x-ndjson" } });
      return Response.json({ jsonrpc: "2.0", id: "ui-1", result: { ok: true, value: {
        subscription: { subscriptionId: "sub-live", projectRoot: "/workspace", onlyPaths: null }, cancelled: 1,
      } } });
    });
    const client = new HostBridgeClient();
    const observed: unknown[] = [];
    const unsubscribe = client.subscribe((event) => observed.push(event));
    try {
      await client.request("watch", { projectRoot: "/workspace" });
      expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
        headers: { "x-tanit-token": "local-token" }, body: JSON.stringify({ subscriptionId: "sub-live" }),
      });
      const event = { jsonrpc: "2.0", method: "tanit/live", params: {
        type: "snapshot-stale", subscriptionId: "sub-live", sessionId: "session-1", projectRoot: "/workspace",
        changedPaths: ["routes.ts"],
      } };
      // Exercise a frame split over arbitrary network chunks.
      const encoded = JSON.stringify(event) + "\n";
      writer.enqueue(new TextEncoder().encode(encoded.slice(0, 20)));
      writer.enqueue(new TextEncoder().encode(encoded.slice(20)));
      await vi.waitFor(() => expect(observed).toContainEqual(event));
      await client.request("cancel", { subscriptionId: "sub-live" });
      await vi.waitFor(() => expect(cancelled).toHaveBeenCalledTimes(1));
    } finally {
      unsubscribe(); fetchMock.mockRestore(); vi.unstubAllGlobals();
      delete document.documentElement.dataset.tanitToken;
    }
  });

  test("failed stream setup cancels the backend watch", async () => {
    delete globals.__TAURI__;
    document.documentElement.dataset.tanitToken = "local-token";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (url === "/api/events") return new Response("forbidden", { status: 403 });
      return Response.json({ jsonrpc: "2.0", id: "ui-1", result: { ok: true, value: {
        subscription: { subscriptionId: "sub-failed", projectRoot: "/workspace", onlyPaths: null }, cancelled: 1,
      } } });
    });
    const client = new HostBridgeClient();
    try {
      await expect(client.request("watch", { projectRoot: "/workspace" })).rejects.toThrow("403");
      const cancelFrame = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
      expect(cancelFrame).toMatchObject({ method: "cancel", params: { subscriptionId: "sub-failed" } });
    } finally {
      fetchMock.mockRestore();
      delete document.documentElement.dataset.tanitToken;
    }
  });
});
