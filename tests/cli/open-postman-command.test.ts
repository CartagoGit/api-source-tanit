import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { main, launchDetached } from "../../packages/cli/commands/open-postman.script";
import { OPEN_LAUNCH_GRACE_MS } from "../../packages/contracts/constants/cli/open-postman.constant";

vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawn: vi.fn(),
}));

let work = "";
let file = "";
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "tanit-open-cmd-"));
  file = join(work, "custom collection.json");
  await writeFile(file, JSON.stringify({ info: { name: "test" } }));
});
afterAll(async () => { await rm(work, { recursive: true, force: true }); });
beforeEach(() => { vi.mocked(spawn).mockReset(); });
afterEach(() => { vi.useRealTimers(); });

const args = () => ["--project-root", work, "--file", file];

describe("artifact opening", () => {
  test("releases a still-running detached application after its launch grace", async () => {
    vi.useFakeTimers();
    const child = new ChildProcess();
    const unref = vi.spyOn(child, "unref").mockImplementation(() => {});
    vi.mocked(spawn).mockImplementationOnce(() => {
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });
    const opening = launchDetached("xdg-open", [file]);
    await vi.advanceTimersByTimeAsync(OPEN_LAUNCH_GRACE_MS);
    expect(await opening).toBe(true);
    expect(spawn).toHaveBeenCalledWith("xdg-open", [file], { detached: true, stdio: "ignore" });
    expect(unref).toHaveBeenCalledOnce();

  });

  test("an immediate nonzero launcher exit triggers the real fallback", async () => {
    vi.mocked(spawn).mockImplementation((command) => {
      const child = new ChildProcess();
      vi.spyOn(child, "unref").mockImplementation(() => {});
      queueMicrotask(() => {
        child.emit("spawn");
        child.emit("exit", command === "xdg-open" ? 1 : 0);
      });
      return child;
    });
    expect(await main(args(), { platform: "linux" })).toBe(0);
    expect(spawn).toHaveBeenNthCalledWith(2, "gio", ["open", file], { detached: true, stdio: "ignore" });
  });

  test("a failed executable falls back to the next Linux launcher", async () => {
    const launch = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await main(args(), { platform: "linux", launch })).toBe(0);
    expect(launch.mock.calls).toEqual([["xdg-open", [file]], ["gio", ["open", file]]]);
  });

  test("web mode uses the importer directly", async () => {
    const launch = vi.fn().mockResolvedValue(true);
    expect(await main([...args(), "--web"], { platform: "darwin", launch })).toBe(0);
    expect(launch).toHaveBeenCalledWith("open", ["https://app.postman.com/import"]);
    expect(launch).toHaveBeenCalledOnce();
  });

  test.each(["darwin", "win32", "linux"])("%s reports failure after every launcher fails", async (platform) => {
    const launch = vi.fn().mockResolvedValue(false);
    expect(await main(args(), { platform, launch })).toBe(1);
    expect(launch.mock.calls.at(-1)?.[1]).toContain("https://app.postman.com/import");
  });

  test("an asynchronous spawn error is handled and all failed launches return 1", async () => {
    vi.mocked(spawn).mockImplementation(() => {
      const child = new ChildProcess();
      queueMicrotask(() => child.emit("error", new Error("ENOENT")));
      return child;
    });
    expect(await main([...args(), "--web"], { platform: "linux" })).toBe(1);
  });

  test("a missing collection does not launch anything", async () => {
    const launch = vi.fn();
    expect(await main(["--project-root", work, "--file", join(work, "missing.json")], { launch })).toBe(1);
    expect(launch).not.toHaveBeenCalled();
  });
});
