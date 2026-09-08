/** Last command edge branches for c00010 S3. */
import { afterEach, describe, expect, test, vi } from "vitest";
import { main as pushMain } from "../../packages/cli/commands/push.script";

const previousKey = process.env["POSTMAN_API_KEY"];
const previousWorkspace = process.env["POSTMAN_WORKSPACE"];

afterEach(() => {
  if (previousKey === undefined) delete process.env["POSTMAN_API_KEY"];
  else process.env["POSTMAN_API_KEY"] = previousKey;
  if (previousWorkspace === undefined) delete process.env["POSTMAN_WORKSPACE"];
  else process.env["POSTMAN_WORKSPACE"] = previousWorkspace;
  vi.unstubAllGlobals();
});

function fetchResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => typeof body === "string" ? body : JSON.stringify(body),
    json: async () => body,
  } as Awaited<ReturnType<typeof fetch>>;
}

describe("push edge branches", () => {
  test("rejects an empty api key without starting network work", async () => {
    process.env["POSTMAN_API_KEY"] = "";
    delete process.env["POSTMAN_WORKSPACE"];
    expect(await pushMain([])).toBe(1);
  });

  test("falls back to an actionable generic API error", async () => {
    process.env["POSTMAN_API_KEY"] = "pmak-edge";
    vi.stubGlobal("fetch", (async () => { throw new Error("network offline"); }) as typeof fetch);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await pushMain(["--project-root", process.cwd()])).toBe(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("network offline"));
    } finally {
      error.mockRestore();
    }
  });
});
