import type { IncomingMessage, RequestOptions } from "node:http";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readRemoteContractText } from "../../packages/core/application-api/remote-contract-text.helper.js";
import { CONTRACT_PREVIEW_MAX_BYTES } from "../../packages/contracts/constants/core/application-api.constant.js";

const { lookup, get } = vi.hoisted(() => ({ lookup: vi.fn(), get: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup }));
vi.mock("node:http", () => ({ get }));
vi.mock("node:https", () => ({ get }));

const remote = "https://docs.example.invalid/spec";

function reply(statusCode: number, headers: IncomingMessage["headers"] = {}, chunks: Uint8Array[] = []) {
  const response: IncomingMessage = {
    statusCode, headers, destroy: vi.fn(),
    async *[Symbol.asyncIterator]() { yield* chunks; },
  };
  get.mockImplementationOnce((_options: RequestOptions, receive: (message: IncomingMessage) => void) => {
    receive(response);
    return { once: vi.fn() };
  });
  return response;
}

beforeEach(() => {
  get.mockReset();
  lookup.mockReset().mockResolvedValue([{ address: "8.8.8.8" }]);
});
afterEach(() => vi.useRealTimers());

test("pins a validated IP and checks DNS again on each same-origin hop", async () => {
  lookup.mockResolvedValueOnce([{ address: "8.8.8.8" }]).mockResolvedValueOnce([{ address: "2606:4700::1111" }]);
  const redirect = reply(302, { location: "/openapi.json" });
  reply(200, {}, [Buffer.from("Open"), Buffer.from("API")]);
  await expect(readRemoteContractText(remote)).resolves.toBe("OpenAPI");
  expect(lookup).toHaveBeenCalledTimes(2);
  expect(get).toHaveBeenNthCalledWith(1, expect.objectContaining({
    hostname: "8.8.8.8", servername: "docs.example.invalid", agent: false, rejectUnauthorized: true,
    headers: { host: "docs.example.invalid", "accept-encoding": "identity" },
  }), expect.any(Function));
  expect(get).toHaveBeenNthCalledWith(2, expect.objectContaining({
    hostname: "2606:4700::1111", path: "/openapi.json",
  }), expect.any(Function));
  expect(redirect.destroy).toHaveBeenCalledOnce();
});

test.each(["127.0.0.1", "169.254.169.254", "[::1]", "[::ffff:127.0.0.1]", "[fd00::1]"])(
  "rejects nonpublic destination %s before connecting", async host => {
    await expect(readRemoteContractText(`http://${host}/openapi.json`)).rejects.toThrow("public addresses");
    expect(get).not.toHaveBeenCalled();
  },
);

test("rejects a mixed public and private DNS answer", async () => {
  lookup.mockResolvedValue([{ address: "8.8.8.8" }, { address: "10.0.0.1" }]);
  await expect(readRemoteContractText(remote)).rejects.toThrow("public addresses");
  expect(get).not.toHaveBeenCalled();
});

test("rejects a same-origin redirect if the next destination stops being public", async () => {
  lookup.mockResolvedValueOnce([{ address: "8.8.8.8" }]).mockResolvedValueOnce([{ address: "10.0.0.1" }]);
  reply(302, { location: "/openapi.json" });
  await expect(readRemoteContractText(remote)).rejects.toThrow("public addresses");
  expect(get).toHaveBeenCalledTimes(1);
});

test("rejects an off-origin redirect before resolving its destination", async () => {
  reply(302, { location: "https://other.example.invalid/openapi.json" });
  await expect(readRemoteContractText(remote)).rejects.toThrow("authorized origin");
  expect(lookup).toHaveBeenCalledTimes(1);
});

test("bounds the redirect chain", async () => {
  for (let count = 0; count < 4; count += 1) reply(302, { location: "/next" });
  await expect(readRemoteContractText(remote)).rejects.toThrow("readable document");
  expect(get).toHaveBeenCalledTimes(4);
});

test("bounds bytes from a chunked response and releases the stream", async () => {
  const response = reply(200, {}, [Buffer.alloc(CONTRACT_PREVIEW_MAX_BYTES), Buffer.from("a")]);
  await expect(readRemoteContractText(remote)).rejects.toThrow("size limit");
  expect(response.destroy).toHaveBeenCalledOnce();
});

test("invalid UTF-8 and compressed payloads cannot enter the preview", async () => {
  reply(200, {}, [Buffer.from("ff", "hex")]);
  await expect(readRemoteContractText(remote)).rejects.toThrow();
  reply(200, { "content-encoding": "gzip" });
  await expect(readRemoteContractText(remote)).rejects.toThrow("encoding");
});

test("a late DNS answer cannot start a request after the deadline", async () => {
  vi.useFakeTimers();
  let resolveLookup!: (value: { address: string }[]) => void;
  lookup.mockReturnValue(new Promise(resolve => { resolveLookup = resolve; }));
  const pending = expect(readRemoteContractText(remote)).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(5000);
  await pending;
  resolveLookup([{ address: "8.8.8.8" }]);
  await Promise.resolve();
  expect(get).not.toHaveBeenCalled();
});
