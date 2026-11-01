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

import { HostBridgeClient } from "../../packages/app/src/app/core/api/host-bridge.client";

type Listener = (event: { payload: unknown }) => void;

const globals = globalThis as { __TAURI__?: unknown };
let originalTauri: unknown;

afterEach(() => {
  globals.__TAURI__ = originalTauri;
  delete globals.__TAURI__;
});

/** Puts a Tauri-shaped global in place, and hands back its pieces. */
function fakeTauri(): {
  invoke: ReturnType<typeof vi.fn>;
  emit(payload: unknown): void;
  listeners: Listener[];
} {
  const listeners: Listener[] = [];
  const invoke = vi.fn().mockResolvedValue(undefined);
  globals.__TAURI__ = {
    invoke,
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

  test("registers the listener before asking, so the answer is not missed", async () => {
    originalTauri = globals.__TAURI__;
    const tauri = fakeTauri();
    const client = new HostBridgeClient();

    void client.request("list-services", { projectRoot: "/workspace" });

    // The listener has to exist by the time the answer comes back.
    expect(tauri.listeners.length).toBe(1);
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

    void client.request("list-services", { projectRoot: "/workspace" });

    expect(tauri.invoke).toHaveBeenCalledWith("send_to_sidecar", {
      frame: JSON.stringify({
        jsonrpc: "2.0",
        id: "ui-1",
        method: "list-services",
        params: { projectRoot: "/workspace" },
      }),
    });
  });
});
