import { Injectable } from "@angular/core";

interface TauriDialogApi {
  open(options: { directory: boolean; multiple: boolean; title?: string }): Promise<string | string[] | null>;
}

interface TauriGlobal {
  dialog?: TauriDialogApi;
  invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Picking a folder.
 *
 * ## The browser fallback was a lie
 *
 * The browser's `showDirectoryPicker()` hands back a handle whose
 * only useful field is the folder's **name**. The app returned
 * that name as if it were a path, and the app then tried to open
 * `"my-api"` as a project root — a relative path that does not
 * exist.
 *
 * So the browser fallback now answers `null`, and the folder
 * picker offers the **list** instead: the Application API's `browse`
 * operation lists real folders, with real paths, in every carrier.
 */
@Injectable({ providedIn: "root" })
export class DialogService {
  /**
   * The path of the chosen folder, or `null`.
   *
   * `null` means "no folder was chosen", not "a folder was chosen
   * and its path is unknown".
   */
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
    // The browser's picker gives a name, not a path. Returning the
    // name would hand the app a path that does not exist.
    return null;
  }

  /**
   * Whether the platform can pick a folder with a real path.
   *
   * The browser cannot: it may open a dialog, but it will not say
   * where the folder is. The app asks the user for the path in
   * that case.
   */
  canPickFolder(): boolean {
    const tauri = this.tauri();
    return tauri?.dialog !== undefined || tauri?.invoke !== undefined;
  }

  private tauri(): TauriGlobal | undefined {
    return (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
  }
}