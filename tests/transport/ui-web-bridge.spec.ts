/**
 * The desktop app in the browser — the bridge serving the page.
 *
 * `packages/app` is the desktop app: Angular, running inside Tauri.
 * Debugging it means recompiling Rust for every line of TypeScript, so
 * the app also runs in a browser, against **the same** Application API
 * the desktop app talks to.
 *
 * That only works if three things hold at once, and each of them has
 * bitten before:
 *
 *   1. **One origin.** The page asks for `POST /api` with a relative
 *      path. A relative path means "the origin that served me", so
 *      the API has to be served from the same place as the page. Two
 *      servers on two ports would make every call cross-origin.
 *   2. **A token the page can read and a third party cannot.** The
 *      bridge refuses a request without `x-tanit-token`, and the page
 *      has to learn the token from the HTML it was served — the only
 *      place same-origin policy protects.
 *   3. **The page and the API answered from the same port**, so the
 *      `Origin` the bridge checks is the origin the browser has.
 *
 * These tests drive a real server.
 */
// The bridge binds a real socket with `Bun.serve`, so this suite
// needs the runtime that has it: `bun:test`.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { startHttpBridge } from "../../packages/core/transport/http-bridge.server.js";
import type { HandlerRegistry } from "../../packages/core/application-api/dispatcher.js";

/** A registry with one handler, enough to prove the API answers. */
function makeRegistry(): HandlerRegistry {
  const passthrough = z.unknown();
  return {
    echo: {
      name: "echo",
      input: passthrough,
      async handle(input: unknown) {
        return { echoed: input };
      },
    },
  };
}

const servers: { stop(): void }[] = [];

afterEach(() => {
  for (const server of servers) server.stop();
  servers.length = 0;
});

async function servedApp(opts?: { security?: boolean }): Promise<{ url: string; token: string }> {
  const dir = await mkdtemp(join(tmpdir(), "tanit-ui-web-"));
  await mkdir(join(dir, "assets"), { recursive: true });
  await writeFile(
    join(dir, "index.html"),
    '<!doctype html><html lang="en"><head><title>Tanit</title></head><body><tanit-root></tanit-root></body></html>',
    "utf8",
  );
  await writeFile(join(dir, "assets", "main.js"), "console.log('tanit');", "utf8");

  const server = startHttpBridge({
    registry: makeRegistry(),
    staticDir: dir,
    caller: "browser",
    skipSecurity: opts?.security === false,
  });
  servers.push(server);
  return { url: server.url, token: server.token };
}

describe("the app served in the browser", () => {
  test("serves the page with the token planted on the html element", async () => {
    const { url, token } = await servedApp();

    const response = await fetch(`${url}/`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    // The app reads the token from exactly here.
    expect(html).toContain(`data-tanit-token="${token}"`);
    // And the page is the app's page.
    expect(html).toContain("<tanit-root>");
  });

  test("serves the assets the page asks for", async () => {
    const { url } = await servedApp();

    const response = await fetch(`${url}/assets/main.js`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/javascript");
    expect(await response.text()).toContain("tanit");
  });

  test("answers the API on the same origin, so the page's relative path works", async () => {
    const { url, token } = await servedApp();

    const response = await fetch(`${url}/api`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tanit-token": token },
      body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: "echo", params: { hi: true } }),
    });
    const payload = (await response.json()) as { result?: { value?: unknown } };

    expect(response.status).toBe(200);
    expect(payload.result?.value).toEqual({ echoed: { hi: true } });
  });

  test("refuses a request without the token", async () => {
    const { url } = await servedApp({ security: true });

    const response = await fetch(`${url}/api`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: "echo", params: {} }),
    });

    expect(response.status).toBe(403);
  });

  test("refuses a path that tries to climb out of the served folder", async () => {
    const { url } = await servedApp();

    const response = await fetch(`${url}/../../etc/passwd`);

    // Either it is refused outright or it resolves to nothing inside
    // the folder. What must never happen is a file from outside.
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
