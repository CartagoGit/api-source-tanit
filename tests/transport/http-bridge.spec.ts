/**
 * Tests for the HTTP bridge (`packages/core/transport/http-bridge.server.ts`).
 *
 * Boots a real `Bun.serve` instance bound to the loopback interface
 * with `skipSecurity: true` (security is exercised in dedicated
 * tests below) so the suite can drive the bridge with `fetch()`.
 *
 * The bridge shares its handler registry with the stdio bridge
 * (`packages/application-api/handlers.ts`); these tests focus on
 * the carrier-specific surface:
 *
 *   - Loopback bind (the TCP bind is the only enforcement; this
 *     is implicit and not asserted here because OS-level bind
 *     cannot be probed without elevated permissions in CI).
 *   - Token rejection (missing / wrong `x-tanit-token`).
 *   - Origin rejection (a request from a different origin gets
 *     `403` before the body is read).
 *   - HTTP status mapping (`httpStatusFromApi`).
 *   - Body parsing (one JSON-RPC envelope per body).
 *   - Path / method routing (`POST /api`, everything else `404`).
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";

import {
  startHttpBridge,
  type IHttpBridge,
} from "../../packages/core/transport/http-bridge.server.js";
import {
  buildRegistry,
} from "../../packages/core/application-api/handlers.js";
import {
  closeAllSessions,
} from "../../packages/core/session/project-session.service.js";
import { clearSubscriptions } from "../../packages/core/application-api/watch.handlers.js";
import type {
  HandlerRegistry,
  IRequestContext,
} from "../../packages/core/application-api/dispatcher.js";
import type { IJsonRpcResponse } from "../../packages/core/transport/json-rpc-protocol.js";

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Minimal echo registry: the bridge tests want to verify
 * carrier-specific surface, not the handler logic. Real registry
 * integration is covered in the stdio bridge suite.
 */
function makeEchoRegistry(): HandlerRegistry {
  const passthrough = z.unknown();
  return {
    echo: {
      name: "echo",
      input: passthrough,
      async handle(input: unknown) {
        return { echoed: input };
      },
    },
    "with.caller": {
      name: "with.caller",
      input: passthrough,
      async handle(_input, ctx: IRequestContext) {
        return { caller: ctx.caller };
      },
    },
  };
}

interface IBootedBridge {
  server: IHttpBridge;
  url: string;
  token: string;
  stop(): void;
}

async function bootBridge(opts: {
  security?: boolean;
  caller?: "browser" | "desktop" | "cli";
  registry?: HandlerRegistry;
}): Promise<IBootedBridge> {
  const server = startHttpBridge({
    registry: opts.registry ?? makeEchoRegistry(),
    caller: opts.caller ?? "browser",
    skipSecurity: opts.security === false,
  });
  return {
    server,
    url: server.url,
    token: server.token,
    stop: () => server.stop(),
  };
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${url}/api`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // not JSON — leave as text
  }
  return { status: res.status, body: parsed };
}

beforeEach(() => {
  closeAllSessions();
  clearSubscriptions();
});

afterEach(() => {
  closeAllSessions();
  clearSubscriptions();
});

// ── Health & routing ────────────────────────────────────────────────────

describe("http bridge — health & routing", () => {
  test("GET / returns a liveness payload", async () => {
    const bridge = await bootBridge({ security: false });
    try {
      const res = await fetch(bridge.url);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; bridge: string };
      expect(body.ok).toBe(true);
      expect(body.bridge).toBe("application-api");
    } finally {
      bridge.stop();
    }
  });

  test("GET /health returns the same liveness payload", async () => {
    const bridge = await bootBridge({ security: false });
    try {
      const res = await fetch(`${bridge.url}/health`);
      expect(res.status).toBe(200);
    } finally {
      bridge.stop();
    }
  });

  test("non-POST returns 404", async () => {
    const bridge = await bootBridge({ security: false });
    try {
      const res = await fetch(`${bridge.url}/api`, { method: "GET" });
      expect(res.status).toBe(404);
    } finally {
      bridge.stop();
    }
  });

  test("POST outside /api returns 404", async () => {
    const bridge = await bootBridge({ security: false });
    try {
      const res = await fetch(`${bridge.url}/elsewhere`, { method: "POST" });
      expect(res.status).toBe(404);
    } finally {
      bridge.stop();
    }
  });
});

// ── Body parsing ────────────────────────────────────────────────────────

describe("http bridge — body parsing", () => {
  test("dispatches a single JSON-RPC envelope", async () => {
    const bridge = await bootBridge({ security: false });
    try {
      const { status, body } = await postJson(bridge.url, {
        jsonrpc: "2.0",
        id: 1,
        method: "echo",
        params: { hello: "world" },
      });
      expect(status).toBe(200);
      const response = body as IJsonRpcResponse;
      expect("result" in response).toBe(true);
      if ("result" in response) {
        const value = response.result as { ok: true; value: unknown };
        expect(value.value).toEqual({ echoed: { hello: "world" } });
      }
    } finally {
      bridge.stop();
    }
  });

  test("rejects malformed JSON with 400 + PARSE_ERROR", async () => {
    const bridge = await bootBridge({ security: false });
    try {
      const res = await fetch(`${bridge.url}/api`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ not json",
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as IJsonRpcResponse;
      expect("error" in body).toBe(true);
      if ("error" in body) {
        expect(body.error.code).toBe(-32700); // PARSE_ERROR
      }
    } finally {
      bridge.stop();
    }
  });

  test("rejects an envelope that is not a JSON-RPC request with 400", async () => {
    const bridge = await bootBridge({ security: false });
    try {
      const { status, body } = await postJson(bridge.url, {
        jsonrpc: "2.0",
        id: 1,
        result: { ok: true }, // a response, not a request
      });
      expect(status).toBe(400);
      const response = body as IJsonRpcResponse;
      expect("error" in response).toBe(true);
      if ("error" in response) {
        expect(response.error.code).toBe(-32600); // INVALID_REQUEST
      }
    } finally {
      bridge.stop();
    }
  });
});

// ── Security envelope ───────────────────────────────────────────────────

describe("http bridge — security envelope", () => {
  test("rejects a request from a foreign origin with 403", async () => {
    const bridge = await bootBridge({ security: true });
    try {
      const res = await fetch(`${bridge.url}/api`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://evil.example.com",
          "x-tanit-token": bridge.token,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "echo", params: {} }),
      });
      expect(res.status).toBe(403);
    } finally {
      bridge.stop();
    }
  });

  test("accepts a request without an Origin header (curl / scripts)", async () => {
    // Per the existing `ui-server.service.ts` rule: a request
    // without `Origin` is a non-browser caller — let it through
    // so terminal use keeps working.
    const bridge = await bootBridge({ security: true });
    try {
      const { status } = await postJson(
        bridge.url,
        { jsonrpc: "2.0", id: 1, method: "echo", params: {} },
        { "x-tanit-token": bridge.token },
      );
      expect(status).toBe(200);
    } finally {
      bridge.stop();
    }
  });

  test("rejects a request with the wrong token", async () => {
    const bridge = await bootBridge({ security: true });
    try {
      const res = await fetch(`${bridge.url}/api`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tanit-token": "wrong-token",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "echo", params: {} }),
      });
      expect(res.status).toBe(403);
    } finally {
      bridge.stop();
    }
  });

  test("rejects a request with no token header", async () => {
    const bridge = await bootBridge({ security: true });
    try {
      const res = await fetch(`${bridge.url}/api`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "echo", params: {} }),
      });
      expect(res.status).toBe(403);
    } finally {
      bridge.stop();
    }
  });

  test("accepts a request with the matching token", async () => {
    const bridge = await bootBridge({ security: true });
    try {
      const { status } = await postJson(
        bridge.url,
        { jsonrpc: "2.0", id: 1, method: "echo", params: { ok: true } },
        { "x-tanit-token": bridge.token },
      );
      expect(status).toBe(200);
    } finally {
      bridge.stop();
    }
  });
});

// ── Status mapping ──────────────────────────────────────────────────────

describe("http bridge — HTTP status mapping", () => {
  test("handler error maps to 500 by default", async () => {
    const registry: HandlerRegistry = {
      "throw.error": {
        name: "throw.error",
        input: z.unknown(),
        async handle() {
          throw new Error("boom");
        },
      },
    };
    const bridge = await bootBridge({ security: false, registry });
    try {
      const { status, body } = await postJson(bridge.url, {
        jsonrpc: "2.0",
        id: 1,
        method: "throw.error",
      });
      expect(status).toBe(500);
      const response = body as IJsonRpcResponse;
      expect("error" in response).toBe(true);
      if ("error" in response) {
        expect(response.error.code).toBe(-32603); // INTERNAL_ERROR
      }
    } finally {
      bridge.stop();
    }
  });

  test("UNKNOWN_HANDLER maps to 404", async () => {
    const bridge = await bootBridge({ security: false });
    try {
      const { status } = await postJson(bridge.url, {
        jsonrpc: "2.0",
        id: 1,
        method: "does.not.exist",
      });
      expect(status).toBe(404);
    } finally {
      bridge.stop();
    }
  });
});

// ── Real registry integration ───────────────────────────────────────────

describe("http bridge — real handler registry", () => {
  test("validates input via the handler's zod schema (400 INVALID_INPUT)", async () => {
    const bridge = await bootBridge({
      security: false,
      registry: buildRegistry(),
    });
    try {
      const { status, body } = await postJson(bridge.url, {
        jsonrpc: "2.0",
        id: 1,
        method: "open-project",
        params: {}, // missing required `projectRoot`
      });
      expect(status).toBe(400);
      const response = body as IJsonRpcResponse;
      expect("error" in response).toBe(true);
      if ("error" in response) {
        const data = response.error.data as { code?: string } | undefined;
        expect(data?.code).toBe("INVALID_INPUT");
      }
    } finally {
      bridge.stop();
    }
  });

  test("`caller` defaults to `browser` when not specified", async () => {
    const bridge = await bootBridge({ security: false });
    try {
      const { body } = await postJson(bridge.url, {
        jsonrpc: "2.0",
        id: 1,
        method: "with.caller",
      });
      const response = body as IJsonRpcResponse;
      if ("result" in response) {
        const value = (response.result as { ok: true; value: { caller: string } }).value;
        expect(value.caller).toBe("browser");
      } else {
        throw new Error("expected success response");
      }
    } finally {
      bridge.stop();
    }
  });

  test("`caller` can be overridden to `desktop`", async () => {
    const bridge = await bootBridge({ security: false, caller: "desktop" });
    try {
      const { body } = await postJson(bridge.url, {
        jsonrpc: "2.0",
        id: 1,
        method: "with.caller",
      });
      const response = body as IJsonRpcResponse;
      if ("result" in response) {
        const value = (response.result as { ok: true; value: { caller: string } }).value;
        expect(value.caller).toBe("desktop");
      } else {
        throw new Error("expected success response");
      }
    } finally {
      bridge.stop();
    }
  });
});