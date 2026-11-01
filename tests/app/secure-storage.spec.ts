import { describe, expect, it, vi } from "vitest";
import { SecureStorageService } from "../../packages/app/src/app/core/host/secure-storage.service";

describe("secure storage", () => {
  it("uses memory only in the browser and supports save/retrieve/delete", async () => {
    const service = new SecureStorageService();
    await service.save("postman", "pmak-secret");
    expect(await service.retrieve("postman")).toBe("pmak-secret");
    expect(service.masked("postman")).toBe("********");
    await service.delete("postman");
    expect(await service.retrieve("postman")).toBeNull();
    service.saveSession("postman", "session-secret");
    service.clearSession();
    expect(await service.retrieve("postman")).toBeNull();
  });

  it("delegates desktop storage to native commands", async () => {
    const invoke = vi.fn().mockResolvedValue("pmak-secret");
    Object.assign(globalThis, { __TAURI__: { invoke } });
    const service = new SecureStorageService();
    await service.save("postman", "pmak-secret");
    expect(await service.retrieve("postman")).toBe("pmak-secret");
    await service.delete("postman");
    expect(invoke).toHaveBeenNthCalledWith(1, "secure_storage_save", { service: "postman", value: "pmak-secret" });
    expect(invoke).toHaveBeenNthCalledWith(2, "secure_storage_retrieve", { service: "postman" });
    expect(invoke).toHaveBeenNthCalledWith(3, "secure_storage_delete", { service: "postman" });
    delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
  });
});