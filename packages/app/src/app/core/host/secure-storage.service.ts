import { Injectable } from "@angular/core";

import type { SecureStoragePort } from "../../../../../contracts/interfaces/core/secure-storage.interface";

export type { SecureStoragePort } from "../../../../../contracts/interfaces/core/secure-storage.interface";

type TauriStorage = {
  invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Where the Postman API key lives.
 *
 * ## What it really does
 *
 * On the desktop the key goes to the operating system's keychain,
 * through Tauri. In the browser there is **no** secure storage to
 * put it in: the key stays in a `Map` in the tab's memory, and it
 * dies with the tab.
 *
 * The screen used to say "API key saved securely" in both cases,
 * which is a lie in one of them and a dangerous one: a key that
 * looks protected and is not gets pasted into a chat when someone
 * asks for it.
 *
 * So the storage says **where** the key went, and the screen says
 * the same thing.
 */
@Injectable({ providedIn: "root" })
export class SecureStorageService implements SecureStoragePort {
  private readonly session = new Map<string, string>();

  async save(service: string, value: string): Promise<void> {
    const tauri = this.tauri();
    if (tauri?.invoke) {
      await tauri.invoke("secure_storage_save", { service, value });
      return;
    }
    this.session.set(service, value);
  }

  saveSession(service: string, value: string): void {
    this.session.set(service, value);
  }

  async retrieve(service: string): Promise<string | null> {
    const tauri = this.tauri();
    if (tauri?.invoke) {
      const value = await tauri.invoke("secure_storage_retrieve", { service });
      return typeof value === "string" ? value : null;
    }
    return this.session.get(service) ?? null;
  }

  async delete(service: string): Promise<void> {
    const tauri = this.tauri();
    if (tauri?.invoke) {
      await tauri.invoke("secure_storage_delete", { service });
      return;
    }
    this.session.delete(service);
  }

  masked(service: string): string {
    return this.session.has(service) ? "********" : "";
  }

  clearSession(): void {
    this.session.clear();
  }

  /**
   * Whether the key survives the app being closed.
   *
   * `true` on the desktop, where the keychain keeps it. `false` in
   * the browser, where it lives in the tab's memory.
   */
  isPersistent(): boolean {
    return this.tauri()?.invoke !== undefined;
  }

  /**
   * Where the key actually went.
   *
   * A fact, not a sentence: the service has no business knowing
   * which language the person reads. The screen turns this into
   * words, in that language.
   *
   * `keychain` is the operating system's own store. `window` is the
   * tab's memory: it dies with the tab, and that is the truth.
   */
  keyLocation(): "keychain" | "window" {
    return this.isPersistent() ? "keychain" : "window";
  }

  private tauri(): TauriStorage | undefined {
    return (globalThis as { __TAURI__?: TauriStorage }).__TAURI__;
  }
}