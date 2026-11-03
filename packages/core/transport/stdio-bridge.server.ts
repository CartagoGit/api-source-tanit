#!/usr/bin/env bun
/**
 * `stdio-bridge.server.ts` — newline-delimited JSON-RPC 2.0 bridge.
 *
 * Reads one JSON-RPC frame per line from `stdin`, dispatches each
 * request through the Application API registry, and writes one
 * JSON-RPC response per line to `stdout`. Cancellation travels the
 * same carrier via the standard `$/cancelRequest` notification.
 *
 * ## Why this shape
 *
 * - **One process ⇒ one stream ⇒ many concurrent calls.** Tanit
 *   Desktop's Tauri sidecar spawns `apisrc serve --stdio` as a
 *   child process; the parent talks over stdin/stdout. Every
 *   request carries an `id`; the bridge keeps a per-id abort
 *   controller so `$/cancelRequest` from the parent aborts the
 *   in-flight handler.
 * - **No HTTP, no token.** The sidecar's IPC channel is the OS
 *   pipe; the only attacker is the local user. The HTTP bridge
 *   keeps the security surface (loopback + token + Origin); the
 *   stdio bridge does not need any of it.
 * - **Same handlers, same dispatcher.** The bridge imports the
 *   `HandlerRegistry` from `packages/core/application-api/handlers.ts`
 *   and never re-implements handler logic — that is the whole
 *   point of f00016 S4.
 *
 * ## Stderr discipline
 *
 * - **stdout is the wire.** Nothing else goes there.
 * - **stderr is for humans.** The bridge logs fatal startup errors
 *   and per-request diagnostics. The Tauri sidecar captures stderr
 *   and writes it to a rotating log file — the bridge does not
 *   own log rotation.
 */

import type {
  HandlerRegistry,
  IRequestContext,
} from "../application-api/dispatcher.js";
import type { IStdioBridgeOptions } from "../../contracts/interfaces/core/bridge.interface.js";
import { dispatch } from "../application-api/dispatcher.js";
import type {
  IJsonRpcFrame,
  IJsonRpcRequest,
  JsonRpcId,
} from "../../contracts/interfaces/core/json-rpc.interface.js";
import {
  jsonRpcError,
  jsonRpcSuccess,
  parseFrames,
  wrapApiError,
  wrapApiResult,
} from "./json-rpc-protocol.js";
import { JSON_RPC_ERROR_CODES } from "../../contracts/constants/core/json-rpc.constant.js";
import { BridgeError } from "./bridge-error.js";

/* ────────────────────────────────────────────────────────────────────── *
 * Minimal abort controller — the project does not depend on `AbortController` *
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Per-request abort controller.
 *
 * The Application API's `IAbortSignalLike` only needs an `aborted`
 * boolean. The bridge gives each in-flight call its own controller
 * so a `$/cancelRequest` notification can flip exactly that one to
 * aborted.
 *
 * Intentionally **not** `AbortController`: the project pins
 * `lib: ["ES2022"]` (no DOM / web-worker types) and does not want
 * `@types/node` in the binary.
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
  onAbort(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }
}

/* ────────────────────────────────────────────────────────────────────── *
 * Public surface                                                         *
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Options the caller hands to `serveStdio`.
 *
 * `input` / `output` are injected so the test suite can drive the
 * bridge with a fake carrier (the real sidecar uses
 * `Bun.stdin.stream()` + `process.stdout.write`).
 *
 * `caller` is always `"desktop"` for the stdio bridge — the
 * Application API's caller discriminator is a contract; the bridge
 * pins it to avoid accidentally emitting `caller: "cli"` over an
 * IPC channel.
 */
export type { IStdioBridgeOptions } from "../../contracts/interfaces/core/bridge.interface.js";
export type {
  IJsonRpcFrame,
  IJsonRpcRequest,
  JsonRpcId,
} from "../../contracts/interfaces/core/json-rpc.interface.js";

interface IInFlight {
  readonly id: JsonRpcId;
  readonly controller: BridgeAbortController;
  readonly context: IRequestContext;
}

/**
 * Runs the bridge until the input is exhausted.
 *
 * Resolves once the input iterator ends (EOF on stdin) or the
 * caller calls the returned `close()`. Returns a `close()` function
 * the CLI / tests call to drain pending responses and release the
 * controller map.
 */
export function serveStdio(opts: IStdioBridgeOptions): {
  readonly closed: Promise<void>;
  close(): void;
} {
  const inFlight = new Map<JsonRpcId, IInFlight>();
  const caller = opts.caller ?? "desktop";
  let resolveDone!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const emitError = (err: unknown): void => {
    if (opts.onError) opts.onError(err);
  };

  // Pump frames asynchronously. We use an async generator so
  // `await` between frames works (cancellation, huge payloads).
  const drive = async (): Promise<void> => {
    try {
      const source = opts.input as AsyncIterable<string>;
      for await (const event of parseFrames(source)) {
        if (!event.ok) {
          opts.output.write(
            JSON.stringify(
              jsonRpcError(null, JSON_RPC_ERROR_CODES.PARSE_ERROR, event.error),
            ) + "\n",
          );
          continue;
        }
        const frame = event.frame;
        if (!("method" in frame)) {
          opts.output.write(
            JSON.stringify(
              jsonRpcError(
                null,
                JSON_RPC_ERROR_CODES.INVALID_REQUEST,
                "Server received a JSON-RPC response, not a request",
              ),
            ) + "\n",
          );
          continue;
        }
        if (!("id" in frame)) {
          // Notification: cancel by id (the only one today).
          handleNotification(frame, inFlight);
          continue;
        }
        await handleRequest(frame as IJsonRpcRequest, opts, inFlight, caller, emitError);
      }
    } catch (err) {
      emitError(err);
    } finally {
      // Drain in-flight on EOF / error.
      for (const entry of inFlight.values()) entry.controller.abort();
      inFlight.clear();
      resolveDone();
    }
  };

  void drive();

  return {
    closed,
    close(): void {
      for (const entry of inFlight.values()) entry.controller.abort();
      inFlight.clear();
      resolveDone();
    },
  };
}

/* ────────────────────────────────────────────────────────────────────── *
 * Frame handling                                                         *
 * ────────────────────────────────────────────────────────────────────── */

function handleNotification(
  frame: IJsonRpcFrame & { method: string },
  inFlight: Map<JsonRpcId, IInFlight>,
): void {
  if (frame.method !== "$/cancelRequest") {
    // Unknown notification — silently ignored per JSON-RPC 2.0 §4.1.
    return;
  }
  const params =
    "params" in frame && frame.params != null
      ? (frame.params as { id?: unknown })
      : undefined;
  const target = params?.id;
  if (typeof target !== "string" && typeof target !== "number") {
    return;
  }
  const entry = inFlight.get(target);
  if (entry) {
    entry.controller.abort();
    inFlight.delete(target);
  }
}

async function handleRequest(
  frame: IJsonRpcRequest,
  opts: IStdioBridgeOptions,
  inFlight: Map<JsonRpcId, IInFlight>,
  caller: "desktop",
  emitError: (err: unknown) => void,
): Promise<void> {
  const controller = new BridgeAbortController();
  const ctx: IRequestContext = {
    caller,
    signal: { aborted: controller.signal.aborted },
    ...(opts.workspace !== undefined ? { workspace: opts.workspace } : {}),
    ...(opts.orchestrator !== undefined ? { orchestrator: opts.orchestrator } : {}),
  };
  inFlight.set(frame.id, { id: frame.id, controller, context: ctx });

  try {
    if (frame.method === "$/cancelRequest") {
      const params = (frame.params ?? {}) as { id?: unknown };
      const target = params.id;
      if (typeof target !== "string" && typeof target !== "number") {
        opts.output.write(
          JSON.stringify(
            jsonRpcError(
              frame.id,
              JSON_RPC_ERROR_CODES.INVALID_PARAMS,
              "$/cancelRequest requires params.id (string|number)",
            ),
          ) + "\n",
        );
        return;
      }
      const existing = inFlight.get(target);
      if (existing) {
        existing.controller.abort();
        inFlight.delete(target);
      }
      opts.output.write(
        JSON.stringify(jsonRpcSuccess(frame.id, { cancelled: existing != null })) + "\n",
      );
      return;
    }

    const result = await dispatch<unknown>(
      opts.registry as HandlerRegistry,
      frame.method,
      frame.params ?? {},
      ctx,
    );
    if (controller.signal.aborted && result.ok) {
      opts.output.write(
        JSON.stringify(
          wrapApiError(frame.id, {
            code: "CANCELED",
            message: "Request aborted before response",
          }),
        ) + "\n",
      );
      return;
    }
    opts.output.write(JSON.stringify(wrapApiResult(frame.id, result)) + "\n");
  } catch (err) {
    emitError(err);
    if (err instanceof BridgeError) {
      opts.output.write(
        JSON.stringify(
          jsonRpcError(frame.id, err.public, err.app.message, {
            code: err.app.code,
            ...(err.app.details ? { details: err.app.details } : {}),
          }),
        ) + "\n",
      );
      return;
    }
    opts.output.write(
      JSON.stringify(
        jsonRpcError(
          frame.id,
          JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
          (err as Error).message ?? "Internal error",
        ),
      ) + "\n",
    );
  } finally {
    inFlight.delete(frame.id);
  }
}

/* ────────────────────────────────────────────────────────────────────── *
 * CLI entry — `apisrc serve --stdio` (see                                *
 * `packages/cli/commands/serve.script.ts`) is the documented entry.      *
 * Running this file directly is supported only for debugging; the CLI    *
 * command wires the bridge to the orchestrator + handler registry.       *
 * ────────────────────────────────────────────────────────────────────── */