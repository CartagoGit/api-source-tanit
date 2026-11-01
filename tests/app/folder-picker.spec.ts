// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { DialogService } from "../../packages/app/src/app/core/host/dialog.service";
import { DragDropService } from "../../packages/app/src/app/core/host/drag-drop.service";

describe("folder picker and drag/drop adapters", () => {
  it("uses the Tauri dialog when available", async () => {
    const open = vi.fn().mockResolvedValue("/workspace/api");
    Object.assign(globalThis, { __TAURI__: { dialog: { open } } });
    await expect(new DialogService().pickFolder()).resolves.toBe("/workspace/api");
    expect(open).toHaveBeenCalledWith({ directory: true, multiple: false, title: "Open project" });
    delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
  });

  it("emits the first contained drop path and ignores outside paths", () => {
    const service = new DragDropService();
    const received: string[] = [];
    service.onDrop(({ path }) => received.push(path));
    service.acceptPath("/workspace/api", "/workspace");
    service.acceptPath("/tmp/secret", "/workspace");
    expect(received).toEqual(["/workspace/api"]);
  });
});