import { Injectable } from "@angular/core";

type DesktopShell = {
  core?: { invoke(command: string, args: { path: string }): Promise<unknown> };
};

@Injectable({ providedIn: "root" })
export class ExternalLinkService {
  async open(event: MouseEvent, url: string): Promise<boolean> {
    const shell = (globalThis as { __TAURI__?: DesktopShell }).__TAURI__?.core;
    if (!shell) return true;

    event.preventDefault();
    try {
      await shell.invoke("plugin:shell|open", { path: url });
      return true;
    } catch {
      return false;
    }
  }
}
