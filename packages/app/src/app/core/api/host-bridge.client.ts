import { Injectable } from "@angular/core";
import type {
  IHostBridge,
  IHostRequestMap,
  IHostResponseMap,
} from "../../../../../contracts/interfaces/ui/host-bridge.interface";

@Injectable({ providedIn: "root" })
export class HostBridgeClient implements IHostBridge {
  private nextId = 0;
  private readonly listeners = new Set<(event: unknown) => void>();
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();

  request<K extends keyof IHostRequestMap>(
    operation: K,
    input: IHostRequestMap[K],
  ): Promise<IHostResponseMap[K]> {
    const id = `ui-${++this.nextId}`;
    const frame = JSON.stringify({ jsonrpc: "2.0", id, method: operation, params: input ?? {} });
    const tauri = (globalThis as { __TAURI__?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>; event?: { listen?: (name: string, callback: (event: { payload: unknown }) => void) => Promise<() => void> } } }).__TAURI__;
    if (tauri?.invoke) return this.requestTauri(id, frame, tauri) as Promise<IHostResponseMap[K]>;
    return this.requestBrowser(frame) as Promise<IHostResponseMap[K]>;
  }

  subscribe(listener: (event: unknown) => void): () => void {
    this.listeners.add(listener);
    const tauri = (globalThis as { __TAURI__?: { event?: { listen?: (name: string, callback: (event: { payload: unknown }) => void) => Promise<() => void> } } }).__TAURI__;
    void tauri?.event?.listen?.("tanit://ipc-message", (event) => {
      this.dispatchEvent(event.payload);
      listener(event.payload);
    });
    return () => this.listeners.delete(listener);
  }

  private async requestTauri(id: string, frame: string, tauri: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>; event?: { listen?: (name: string, callback: (event: { payload: unknown }) => void) => Promise<() => void> } }): Promise<unknown> {
    if (!tauri.invoke || !tauri.event?.listen) throw new Error("Tauri bridge is incomplete");
    const response = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    await tauri.invoke("send_to_sidecar", { frame });
    return response;
  }

  private async requestBrowser(frame: string): Promise<unknown> {
    const token = typeof document !== "undefined" ? document.documentElement.dataset.tanitToken : undefined;
    const response = await fetch("/api", { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-tanit-token": token } : {}) }, body: frame });
    const payload = await response.json() as { result?: unknown; error?: { message?: string } };
    if (!response.ok || payload.error) throw new Error(payload.error?.message ?? "Host request failed");
    return payload.result;
  }

  private dispatchEvent(event: unknown): void {
    if (!event || typeof event !== "object") return;
    const payload = event as { id?: unknown; result?: unknown; error?: { message?: string } };
    if (typeof payload.id !== "string") return;
    const pending = this.pending.get(payload.id);
    if (!pending) return;
    this.pending.delete(payload.id);
    if (payload.error) pending.reject(new Error(payload.error.message ?? "Host request failed"));
    else pending.resolve(payload.result);
  }
}
