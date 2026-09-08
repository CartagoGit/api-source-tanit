import { Injectable } from "@angular/core";

export interface SecureStoragePort {
  save(service: string, value: string): Promise<void>;
  saveSession(service: string, value: string): void;
  retrieve(service: string): Promise<string | null>;
  delete(service: string): Promise<void>;
}

type TauriStorage = {
  invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
};

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

  private tauri(): TauriStorage | undefined {
    return (globalThis as { __TAURI__?: TauriStorage }).__TAURI__;
  }
}