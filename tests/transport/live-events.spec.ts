import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRegistry } from "../../packages/core/application-api/handlers.js";
import { startHttpBridge } from "../../packages/core/transport/http-bridge.server.js";
import { serveStdio } from "../../packages/core/transport/stdio-bridge.server.js";
import { openSession, closeAllSessions } from "../../packages/core/session/project-session.service.js";
import { clearSubscriptions, listSubscriptions } from "../../packages/core/application-api/watch.handlers.js";
import { isLiveEvent } from "../../packages/core/helpers/live-event.helper.js";
import type { LiveEvent } from "../../packages/contracts/interfaces/core/live.interface.js";
import type { IDiscoveryOrchestrator } from "../../packages/contracts/interfaces/core/scanner.interface.js";

let root: string;
let contents: string[];
const stops: Array<() => void> = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "tanit-live-carriers-"));
  contents = [];
  await writeFile(join(root, "routes.ts"), "before");
});
afterEach(async () => {
  for (const stop of stops.splice(0)) stop();
  clearSubscriptions();
  closeAllSessions();
  await rm(root, { recursive: true, force: true });
});

async function open() {
  const orchestrator: IDiscoveryOrchestrator = {
    detectAll: async () => {
      contents.push(await readFile(join(root, "routes.ts"), "utf8"));
      return [];
    },
    detectAllWithDiagnostics: async () => {
      contents.push(await readFile(join(root, "routes.ts"), "utf8"));
      return { detected: [], diagnostics: [] };
    },
    forceFramework: async () => null,
    supportedFrameworks: () => [],
  };
  return openSession(root, { generationOptions: { orchestrator }, watchDebounceMs: 15 });
}

async function withDeadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Live event deadline exceeded")), 3_000);
  });
  try { return await Promise.race([promise, deadline]); }
  finally { clearTimeout(timer!); }
}

function liveReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let pending = "";
  return async (type: LiveEvent["type"]): Promise<LiveEvent> => {
    while (true) {
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const frame = JSON.parse(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        if (isLiveEvent(frame.params) && frame.params.type === type) return frame.params;
      }
      const chunk = await withDeadline(reader.read());
      if (chunk.done) throw new Error("Live stream ended before event");
      pending += decoder.decode(chunk.value, { stream: true });
    }
  };
}

describe("live events over authenticated HTTP", () => {
  test("source edit produces a fresh snapshot; cancel ends the stream and watcher", async () => {
    const session = await open();
    const server = startHttpBridge({ registry: buildRegistry() });
    stops.push(() => server.stop());
    const headers = { "content-type": "application/json", "x-tanit-token": server.token };
    const call = async (method: string, params: unknown) => {
      const response = await fetch(`${server.url}/api`, {
        method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }),
      });
      return response.json();
    };
    expect(session.settings().watch).toBe(false);
    const watched = await call("watch", { projectRoot: root });
    const id = watched.result.value.subscription.subscriptionId;
    expect(session.settings().watch).toBe(true);
    const response = await fetch(`${server.url}/api/events`, {
      method: "POST", headers, body: JSON.stringify({ subscriptionId: id }),
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const next = liveReader(reader);
    const initial = await next("snapshot-ready");
    expect(initial.sessionId).toBe(session.id);
    await writeFile(join(root, "routes.ts"), "after");
    const stale = await next("snapshot-stale");
    expect(stale.type === "snapshot-stale" && stale.changedPaths).toContain("routes.ts");
    const ready = await next("snapshot-ready");
    expect(ready.type === "snapshot-ready" && ready.summary.capturedAt)
      .toBe(session.current().capturedAt.toISOString());
    expect(contents.at(-1)).toBe("after");
    await call("cancel", { subscriptionId: id });
    expect((await next("subscription-closed")).subscriptionId).toBe(id);
    expect((await withDeadline(reader.read())).done).toBe(true);
    expect(listSubscriptions()).toEqual([]);
    expect(session.settings().watch).toBe(false);
  });

  test("disconnect releases the subscription and explicit watch settings survive", async () => {
    const session = await open();
    await session.configure({ watch: true });
    const server = startHttpBridge({ registry: buildRegistry() });
    stops.push(() => server.stop());
    const headers = { "content-type": "application/json", "x-tanit-token": server.token };
    const response = await fetch(`${server.url}/api`, {
      method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "watch", params: { projectRoot: root } }),
    });
    const id = (await response.json()).result.value.subscription.subscriptionId;
    const stream = await fetch(`${server.url}/api/events`, { method: "POST", headers, body: JSON.stringify({ subscriptionId: id }) });
    const reader = stream.body!.getReader();
    await liveReader(reader)("snapshot-ready");
    await reader.cancel();
    await withDeadline((async () => {
      while (listSubscriptions().length > 0) await new Promise((resolve) => setTimeout(resolve, 5));
    })());
    expect(listSubscriptions()).toEqual([]);
    expect(session.settings().watch).toBe(true);
  });

  test("event streams enforce token, origin and subscription identity", async () => {
    await open();
    const server = startHttpBridge({ registry: buildRegistry() });
    stops.push(() => server.stop());
    const post = (headers: Record<string, string>) => fetch(`${server.url}/api/events`, {
      method: "POST", headers, body: JSON.stringify({ subscriptionId: "missing" }),
    });
    expect((await post({})).status).toBe(403);
    expect((await post({ "x-tanit-token": server.token, origin: "https://foreign.invalid" })).status).toBe(403);
    expect((await post({ "x-tanit-token": server.token })).status).toBe(400);
  });
});

describe("live events over stdio", () => {
  test("control cancellation reaches an in-flight request over the same carrier", async () => {
    const { z } = await import("zod");
    let release!: () => void;
    let started!: () => void;
    const began = new Promise<void>((resolve) => { started = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const output: string[] = [];
    async function* frames() {
      yield JSON.stringify({ jsonrpc: "2.0", id: 1, method: "blocked", params: {} }) + "\n";
      await began;
      yield JSON.stringify({ jsonrpc: "2.0", id: 2, method: "$/cancelRequest", params: { id: 1 } }) + "\n";
      release();
    }
    const bridge = serveStdio({ input: frames(), output: { write(line) { output.push(line); } }, registry: {
      blocked: { name: "blocked", input: z.unknown(), async handle(_input, ctx) {
        started(); await blocked; return { aborted: ctx.signal?.aborted };
      } },
    } });
    await withDeadline(bridge.closed);
    const responses = output.map((line) => JSON.parse(line));
    expect(responses.find((frame) => frame.id === 2).result).toEqual({ cancelled: true });
    expect(responses.find((frame) => frame.id === 1).error).toMatchObject({ data: { code: "CANCELED" } });
  });

  test("uses the same event payload and disconnect clears owned subscriptions", async () => {
    const session = await open();
    const lines: string[] = [];
    let wake: () => void = () => undefined;
    let finished = false;
    async function* input() {
      while (!finished) {
        if (lines.length === 0) await new Promise<void>((resolve) => { wake = resolve; });
        while (lines.length > 0) yield lines.shift()!;
      }
    }
    const events: LiveEvent[] = [];
    const waiters = new Set<(event: LiveEvent) => void>();
    let acknowledge: (value: unknown) => void = () => undefined;
    const bridge = serveStdio({ registry: buildRegistry(), input: input(), output: {
      write(line) {
        const frame = JSON.parse(line);
        if (frame.id === 1) acknowledge(frame.result);
        if (isLiveEvent(frame.params)) {
          events.push(frame.params);
          for (const waiter of [...waiters]) waiter(frame.params);
        }
      },
    } });
    const next = (type: LiveEvent["type"]) => withDeadline(new Promise<LiveEvent>((resolve) => {
      const listen = (event: LiveEvent) => { if (event.type === type) { waiters.delete(listen); resolve(event); } };
      waiters.add(listen);
    }));
    const watched = new Promise<unknown>((resolve) => { acknowledge = resolve; });
    lines.push(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "watch", params: { projectRoot: root } }) + "\n");
    wake();
    expect((await withDeadline(watched))).toMatchObject({ ok: true });
    const ready = next("snapshot-ready");
    await writeFile(join(root, "routes.ts"), "stdio-after");
    const event = await ready;
    expect(event.sessionId).toBe(session.id);
    expect(event.type === "snapshot-ready" && event.summary.projectRoot).toBe(root);
    expect(events.some((item) => item.type === "snapshot-stale")).toBe(true);
    bridge.close();
    finished = true;
    wake();
    await bridge.closed;
    await Promise.resolve();
    expect(listSubscriptions()).toEqual([]);
    expect(session.settings().watch).toBe(false);
  });
});
