import { Injectable } from "@angular/core";

interface TauriDialogApi {
  open(options: { directory: boolean; multiple: boolean; title?: string }): Promise<string | string[] | null>;
}

interface TauriGlobal {
  dialog?: TauriDialogApi;
  invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
}

@Injectable({ providedIn: "root" })
export class DialogService {
  async pickFolder(): Promise<string | null> {
    const tauri = this.tauri();
    if (tauri?.dialog) {
      const selected = await tauri.dialog.open({ directory: true, multiple: false, title: "Open project" });
      return Array.isArray(selected) ? selected[0] ?? null : selected;
    }
    if (tauri?.invoke) {
      const selected = await tauri.invoke("plugin:dialog|open", { options: { directory: true, multiple: false } });
      return typeof selected === "string" ? selected : null;
    }
    const picker = (globalThis as { showDirectoryPicker?: () => Promise<{ name: string }> }).showDirectoryPicker;
    if (picker) {
      try {
        return (await picker()).name;
      } catch {
        return null;
      }
    }
    return null;
  }

  private tauri(): TauriGlobal | undefined {
    return (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
  }
}