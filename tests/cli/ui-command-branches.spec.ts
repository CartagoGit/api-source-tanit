import { describe, expect, test, vi } from "vitest";
import { main as uiMain } from "../../packages/cli/commands/ui.script";

const startUiServer = vi.fn();

vi.mock("../../packages/ui/server/ui-server.service.js", () => ({
  startUiServer: (...args: unknown[]) => startUiServer(...args),
}));

describe("ui command branch surfaces", () => {
  test("rejects an invalid port without starting the server", async () => {
    startUiServer.mockReset();
    const code = await uiMain(["--port", "not-a-number"]);
    expect(code).toBe(1);
    expect(startUiServer).not.toHaveBeenCalled();
  });

  test("starts the UI with a valid port and handles shutdown signals", async () => {
    const stop = vi.fn();
    startUiServer.mockReset();
    startUiServer.mockReturnValue({ url: "http://127.0.0.1:4317", stop });
    const onceSpy = vi.spyOn(process, "once").mockImplementation((event, listener) => {
      if (event === "SIGINT") listener();
      return process;
    });
    try {
      expect(await uiMain(["--no-open", "--port", "4317"])).toBe(0);
      expect(onceSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
    } finally {
      onceSpy.mockRestore();
    }
    expect(stop).toHaveBeenCalledOnce();
  });

  test("reports a startup failure", async () => {
    startUiServer.mockReset();
    startUiServer.mockImplementation(() => {
      throw new Error("port is occupied");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await uiMain(["--no-open", "--port", "4317"])).toBe(1);
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  test("uses the server-selected port when no port flag is supplied", async () => {
    const stop = vi.fn();
    startUiServer.mockReset();
    startUiServer.mockReturnValue({ url: "http://127.0.0.1:4318", stop });
    const signal = vi.spyOn(process, "once").mockImplementation((event, listener) => {
      if (event === "SIGINT") listener();
      return process;
    });
    try {
      expect(await uiMain(["--no-open"])).toBe(0);
      expect(startUiServer).toHaveBeenCalledWith(expect.not.objectContaining({ port: expect.anything() }));
      expect(stop).toHaveBeenCalledOnce();
    } finally {
      signal.mockRestore();
    }
  });
});
