import { Injectable, signal } from "@angular/core";

export interface IDropEvent {
  readonly path: string;
}

interface TauriEventApi {
  listen(event: string, handler: (event: { payload?: unknown }) => void): Promise<() => void>;
}

@Injectable({ providedIn: "root" })
export class DragDropService {
  readonly hovering = signal(false);

  private readonly listeners = new Set<(event: IDropEvent) => void>();
  private unlisten: (() => void) | undefined;

  async connect(): Promise<() => void> {
    const tauri = (globalThis as { __TAURI__?: { event?: TauriEventApi } }).__TAURI__;
    if (tauri?.event && !this.unlisten) {
      this.unlisten = await tauri.event.listen("tauri://drag-drop", (event) => this.handlePayload(event.payload));
    }
    return () => this.disconnect();
  }

  disconnect(): void {
    this.unlisten?.();
    this.unlisten = undefined;
  }

  onDrop(listener: (event: IDropEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setHovering(value: boolean): void {
    this.hovering.set(value);
  }

  acceptPath(path: string, workspaceRoot?: string): void {
    const normalized = path.replaceAll("\\", "/").trim();
    if (!normalized || (workspaceRoot && !this.isContained(normalized, workspaceRoot))) return;
    const event = { path: normalized };
    for (const listener of this.listeners) listener(event);
  }

  handlePayload(payload: unknown): void {
    const paths = this.pathsFromPayload(payload);
    const firstPath = paths.at(0);
    if (firstPath) this.acceptPath(firstPath);
  }

  private pathsFromPayload(payload: unknown): string[] {
    if (Array.isArray(payload)) return payload.filter((path): path is string => typeof path === "string");
    if (typeof payload !== "object" || payload === null) return [];
    const paths = (payload as { paths?: unknown }).paths;
    return Array.isArray(paths) ? paths.filter((path): path is string => typeof path === "string") : [];
  }

  private isContained(path: string, root: string): boolean {
    const normalizedRoot = root.replaceAll("\\", "/").replace(/\/$/, "");
    return path === normalizedRoot || path.startsWith(`${normalizedRoot}/`);
  }
}