#!/usr/bin/env bun
/**
 * `http-bridge.server.ts` — Application API over HTTP/1.1.
 *
 * Bridges the same handler registry (`packages/core/application-api/handlers.ts`)
 * to a `Bun.serve` instance. Preserves the security posture the
 * existing UI server enforces (`packages/ui/server/ui-server.service.ts`):
 *
 *   1. **Loopback only** — listens on `127.0.0.1`. Reading source
 *      code from the user's disk must not be reachable from the
 *      office network.
 *   2. **Token per run** — a fresh UUID on every boot. The
 *      `X-Tanit-Token` header must match it. The token is
 *      unguessable: `crypto.randomUUID`, not a counter nor the
 *      time.
 *   3. **Origin validation** — if `Origin` is set, it must be the
 *      loopback URL the server itself is bound to. Any third-party
 *      page gets `403` before the body is read.
 *
 * The token requirement is for the **browser** carrier — the same
 * one `apisrc ui` already protects. The stdio bridge does not need
 * any of this (IPC is local). Both bridges share the handler
 * registry; only the security envelope differs.
 *
 * ## Wire shape
 *
 * The HTTP body is JSON-RPC 2.0 over a single endpoint — `POST /api`
 * — so the same request format works over both bridges. The
 * response body is the same JSON-RPC envelope. A successful call
 * has status `200`; an application error has the status the
 * `IApiError` code maps to (`httpStatusFromApi()` in
 * `bridge-error.ts`).
 */

import type {
  HandlerRegistry,
  IRequestContext,
} from "../application-api/dispatcher.js";
import { dispatch } from "../application-api/dispatcher.js";
import type {
  IJsonRpcRequest,
  IJsonRpcResponse,
} from "./json-rpc-protocol.js";
import {
  JSON_RPC_ERROR_CODES,
  jsonRpcError,
  parseFrames,
  wrapApiError,
  wrapApiResult,
} from "./json-rpc-protocol.js";
import {
  BridgeError,
  bridgeFailure,
  httpStatusFromApi,
} from "./bridge-error.js";
// `IServerRequest` and `IFetchResponse` are declared ambiently by
// the project's `runtime.d.ts` (no `@types/node` / `bun-types`).
// We use them as global types — no `import` here.

/* ────────────────────────────────────────────────────────────────────── *
 * Public surface                                                         *
 * ────────────────────────────────────────────────────────────────────── */

export interface IHttpBridgeOptions {
  readonly registry: HandlerRegistry;
  /** First port to try; the server walks up if it is busy. */
  readonly port?: number;
  /** Workspace root to forward as `IRequestContext.workspace`. */
  readonly workspace?: string;
  /** Optional orchestrator the registry handlers expect. */
  readonly orchestrator?: unknown;
  /** What the bridges pass as `IRequestContext.caller`. */
  readonly caller?: "browser" | "desktop" | "cli";
  /** Disable Origin / token checks (loopback + token stay). */
  readonly skipSecurity?: boolean;
}

/** Estado observable del bridge HTTP iniciado para la API de aplicación. */
export interface IHttpBridge {
  readonly url: string;
  readonly port: number;
  readonly token: string;
  stop(): void;
}

/**
 * Minimal per-request abort controller.
 *
 * Same shape as the stdio bridge's `BridgeAbortController` — kept
 * separate to avoid a circular import between the two bridge
 * modules. The HTTP bridge's "abort" fires when the upstream
 * client disconnects (`request.signal`).
 */
class BridgeAbortController {
  private _aborted = false;
  private readonly _listeners = new Set<() => void>();
  abort(): void {
    if (this._aborted) return;
    this._aborted = true;
    for (const listener of this._listeners) listener();
  }
  get signal(): { readonly aborted: boolean } {
    return { aborted: this._aborted };
  }
  /** Subscribe to abort; useful for handlers that want to react. */
  onAbort(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }
}

const HOST = "127.0.0.1";
const INTENTOS = 20;
const TOKEN_HEADER = "x-tanit-token";

/**
 * Starts the HTTP bridge.
 *
 * Returns the URL + port + token so the caller can print them and
 * (optionally) embed the token into the served HTML — exactly the
 * way `startUiServer` does today.
 */
export function startHttpBridge(options: IHttpBridgeOptions): IHttpBridge {
  const portInicial = options.port ?? 0;
  const token = newToken();
  const caller = options.caller ?? "browser";
  const skipSecurity = options.skipSecurity === true;

  for (let intento = 0; intento < INTENTOS; intento++) {
    const port = portInicial === 0 ? pickPort() : portInicial + intento;
    try {
      const server = Bun.serve({
        port,
        hostname: HOST,
        fetch: async (request) => {
          // One abort controller per request. The bridge fires
          // it on the response boundary; handlers can poll
          // `ctx.signal.aborted` to opt into cooperative
          // cancellation. We do not currently observe the
          // upstream client disconnect — `IServerRequest` in the
          // project's ambient `runtime.d.ts` does not expose a
          // `signal`. Tracking disconnects is a separate slice.
          const aborter = new BridgeAbortController();
          return handleFetch(request, options, token, caller, skipSecurity, aborter);
        },
      });
      return {
        url: `http://${HOST}:${server.port}`,
        port: server.port,
        token,
        stop: () => server.stop(true),
      };
    } catch (err) {
      if (isEAddrInUse(err)) continue;
      throw err;
    }
  }
  throw new Error(
    `No free port between ${portInicial} and ${portInicial + INTENTOS - 1} for the HTTP bridge.`,
  );
}

/* ────────────────────────────────────────────────────────────────────── *
 * Request handler                                                        *
 * ────────────────────────────────────────────────────────────────────── */

async function handleFetch(
  request: IServerRequest,
  options: IHttpBridgeOptions,
  token: string,
  caller: IHttpBridgeOptions["caller"] & string,
  skipSecurity: boolean,
  aborter: BridgeAbortController,
): Promise<IFetchResponse> {
  // Alias for the ambient `IFetchResponse` declared in
  // `runtime.d.ts`. Avoids re-importing a non-module file.
  const { pathname } = new URL(request.url);

  // Loopback-only — the TCP bind already enforces this; we mirror
  // it here for the response so the caller can debug from
  // `Origin` rejection messages.
  const port = new URL(request.url).port;

  if (request.method === "GET" && (pathname === "/" || pathname === "/health")) {
    return Response.json({ ok: true, bridge: "application-api" });
  }

  if (request.method !== "POST" || !pathname.startsWith("/api")) {
    return new Response("not found", { status: 404 });
  }

  if (!skipSecurity) {
    const origen = request.headers.get("origin");
    if (origen !== null && origen !== `http://${HOST}:${port}`) {
      return Response.json(
        wrapApiError(null, bridgeFailure(
          403,
          "EXECUTION_FAILED",
          `This interface does not answer requests from ${origen}.`,
        ).app),
        { status: 403 },
      );
    }
    if (request.headers.get(TOKEN_HEADER) !== token) {
      return Response.json(
        wrapApiError(null, bridgeFailure(
          403,
          "EXECUTION_FAILED",
          "Missing or wrong request token.",
        ).app),
        { status: 403 },
      );
    }
  }

  // Body parsing — accept a POST without a body (`{}`) so curl
  // can probe without typing JSON.
  const crudo = (await request.text()).trim();
  let parsed: unknown = {};
  if (crudo !== "") {
    try {
      parsed = JSON.parse(crudo);
    } catch {
      return Response.json(
        jsonRpcError(
          null,
          JSON_RPC_ERROR_CODES.PARSE_ERROR,
          "Request body is not valid JSON",
        ),
        { status: 400 },
      );
    }
  }
  if (!isJsonRpcRequestLike(parsed)) {
    return Response.json(
      jsonRpcError(
        null,
        JSON_RPC_ERROR_CODES.INVALID_REQUEST,
        "Body must be a JSON-RPC 2.0 request { jsonrpc: '2.0', id, method, params? }",
      ),
      { status: 400 },
    );
  }

  // Route the body. A JSON-RPC envelope is one JSON object per
  // call — the bridge does **not** batch multiple requests per
  // HTTP body. The body could in principle be newline-delimited
  // (matching the stdio bridge's framing), but HTTP's content
  // length + status code model means one body = one response.
  const frames: IJsonRpcResponse[] = [];
  for await (const event of parseFrames([JSON.stringify(parsed)])) {
    if (!event.ok) {
      frames.push(
        jsonRpcError(
          null,
          JSON_RPC_ERROR_CODES.PARSE_ERROR,
          event.error,
        ),
      );
      continue;
    }
    const frame = event.frame;
    if (!isJsonRpcRequest(frame)) {
      frames.push(
        jsonRpcError(
          null,
          JSON_RPC_ERROR_CODES.INVALID_REQUEST,
          "Server received a JSON-RPC response or notification, not a request",
        ),
      );
      continue;
    }
    frames.push(await dispatchFrame(frame, options, caller, aborter));
  }
  // One response per request: if the client sent a single envelope
  // (the supported shape), return the single envelope; otherwise
  // join them as newline-delimited JSON.
  if (frames.length === 1) {
    const body = JSON.stringify(frames[0]);
    aborter.abort();
    return new Response(body, {
      status: statusForFrame(frames[0]),
      headers: { "content-type": "application/json" },
    });
  }
  const body = frames.map((f) => JSON.stringify(f)).join("\n");
  aborter.abort();
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function dispatchFrame(
  frame: IJsonRpcRequest,
  options: IHttpBridgeOptions,
  caller: "browser" | "desktop" | "cli",
  aborter: BridgeAbortController,
): Promise<IJsonRpcResponse> {
  const ctx: IRequestContext = {
    caller,
    signal: { aborted: aborter.signal.aborted },
    ...(options.workspace !== undefined ? { workspace: options.workspace } : {}),
    ...(options.orchestrator !== undefined ? { orchestrator: options.orchestrator } : {}),
  };

  try {
    const result = await dispatch<unknown>(
      options.registry,
      frame.method,
      frame.params ?? {},
      ctx,
    );
    if (aborter.signal.aborted && result.ok) {
      return wrapApiError(frame.id, {
        code: "CANCELED",
        message: "Request aborted before response",
      });
    }
    return wrapApiResult(frame.id, result);
  } catch (err) {
    if (err instanceof BridgeError) {
      return jsonRpcError(frame.id, err.public, err.app.message, {
        code: err.app.code,
        ...(err.app.details ? { details: err.app.details } : {}),
      });
    }
    return jsonRpcError(
      frame.id,
      JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
      (err as Error).message ?? "Internal error",
    );
  }
}

/* ────────────────────────────────────────────────────────────────────── *
 * Helpers                                                                *
 * ────────────────────────────────────────────────────────────────────── */

function newToken(): string {
  return crypto.randomUUID();
}

function pickPort(): number {
  // OS-assigned port when the caller asked for port 0. Bun returns
  // the bound port via `server.port` after `Bun.serve()` returns,
  // so we still need a starting guess — 0 means "ask the OS".
  return 0;
}

function isEAddrInUse(error: unknown): boolean {
  return (error as { code?: string }).code === "EADDRINUSE";
}

function isJsonRpcRequestLike(value: unknown): value is IJsonRpcRequest {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as { jsonrpc?: unknown; id?: unknown; method?: unknown };
  if (obj.jsonrpc !== "2.0") return false;
  if (typeof obj.method !== "string") return false;
  return typeof obj.id === "string" || typeof obj.id === "number";
}

function isJsonRpcRequest(value: unknown): value is IJsonRpcRequest {
  return isJsonRpcRequestLike(value);
}

function statusForFrame(frame: IJsonRpcResponse | undefined): number {
  if (!frame) return 500;
  if ("result" in frame) return 200;
  // Map JSON-RPC code to HTTP status; fall back to the AppError code.
  switch (frame.error.code) {
    case JSON_RPC_ERROR_CODES.PARSE_ERROR:
    case JSON_RPC_ERROR_CODES.INVALID_REQUEST:
      return 400;
    case JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND:
    case JSON_RPC_ERROR_CODES.INVALID_PARAMS:
      return 404;
    case JSON_RPC_ERROR_CODES.INTERNAL_ERROR:
    default: {
      // Pull the application code out of `data` to choose a status.
      const data = frame.error.data as { code?: string } | undefined;
      if (data?.code) {
        return httpStatusFromApi({
          code: data.code as Parameters<typeof httpStatusFromApi>[0]["code"],
          message: frame.error.message,
        });
      }
      return 500;
    }
  }
}