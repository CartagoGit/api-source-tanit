import { Injectable } from "@angular/core";
import type {
  IHostBridge,
  IHostRequestMap,
  IHostResponseMap,
} from "../../../../../contracts/interfaces/ui/host-bridge.interface";
import { translate } from "../i18n/i18n.state";

/** What Tauri puts on the window. */
interface ITauriEventApi {
  listen?: (name: string, callback: (event: { payload: unknown }) => void) => Promise<() => void>;
}

/** The part of Tauri's global this connector uses. */
interface ITauriGlobal {
  invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  core?: Pick<ITauriGlobal, "invoke">;
  event?: ITauriEventApi;
}

/** The JSON-RPC envelope on the wire. */
interface IWireFrame {
  readonly jsonrpc: string;
  readonly id?: string | number | null;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code?: number; readonly message?: string };
}

/**
 * How long a request may wait for its answer.
 *
 * Without a deadline, a request whose answer never arrives — the
 * sidecar died, the bridge lost the line — stays pending for ever:
 * the screen spins, and nothing says why. Half a minute is longer
 * than any local operation should take and short enough that the
 * user is not left staring.
 */
const REQUEST_TIMEOUT_MS = 30_000;
const BROWSE_TIMEOUT_MS = 5_000;

/**
 * The connector.
 *
 * One object, two carriers, **one** contract. Whether the app runs
 * inside Tauri (the sidecar over stdio) or in a browser (the bridge
 * over HTTP), the app asks for operations here and gets answers back
 * here. Nothing above this file knows which one is running.
 *
 * ## What was broken
 *
 * This class had three faults, and each of them alone was enough to
 * make the desktop app useless:
 *
 *   · **The Tauri answer was thrown away.** The Rust side emits the
 *     JSON-RPC line as a **string** (`app.emit("tanit://ipc-message",
 *     trimmed)`), and this class checked `typeof event !== "object"`
 *     and returned. Every response was discarded, and every request
 *     hung forever waiting for one.
 *   · **The listener was only registered for events.** `request()`
 *     waited for a response that nothing was listening for. The
 *     listener is now registered once, for both.
 *   · **Nobody unwrapped the answer.** The bridge answers with the
 *     JSON-RPC envelope, whose `result` is the application's
 *     `ApiResult` — `{ ok: true, value }`. The callers want the
 *     value. Both carriers now unwrap it in the same place.
 */
@Injectable({ providedIn: "root" })
export class HostBridgeClient implements IHostBridge {
  private nextId = 0;
  private browserTokenRequest: Promise<string> | undefined;
  private readonly listeners = new Set<(event: unknown) => void>();
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  private listening: Promise<void> | undefined;
  private readonly streams = new Map<string, AbortController>();

  request<K extends keyof IHostRequestMap>(
    operation: K,
    input: IHostRequestMap[K],
  ): Promise<IHostResponseMap[K]> {
    return this.send(operation as string, input) as Promise<IHostResponseMap[K]>;
  }

  subscribe(listener: (event: unknown) => void): () => void {
    this.listeners.add(listener);
    if (this.tauri()) void this.ensureListening().catch(() => undefined);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        for (const controller of this.streams.values()) controller.abort();
        this.streams.clear();
      }
    };
  }

  /**
   * Builds the frame once and hands it to whichever carrier is
   * running. The frame is the same in both cases — that is what makes
   * the two faces of the app behave the same.
   */
  private async send(operation: string, input: unknown): Promise<unknown> {
    const id = `ui-${++this.nextId}`;
    const frame = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: operation,
      params: input ?? {},
    });
    const tauri = this.tauri();
    const invoke = tauri?.core?.invoke ?? tauri?.invoke;
    if (invoke) return this.requestTauri(id, frame, operation, invoke);
    return this.requestBrowser(frame, operation, input);
  }

  /**
   * Registers the listener **once**, and for both purposes.
   *
   * The Tauri side answers a request and pushes an event through the
   * same channel (`tanit://ipc-message`), so one listener serves the
   * two. Registering it lazily — and only once — is what keeps a
   * request from hanging: before, the listener only existed if
   * something had called `subscribe()`, and nothing did.
   */
  private ensureListening(): Promise<void> {
    if (!this.listening) {
      let expired = false;
      const register = async () => {
        const event = this.tauri()?.event;
        if (!event?.listen) throw new Error(translate("common.hostRequestFailed"));
        const unlisten = await event.listen("tanit://ipc-message", (message) => {
          if (!expired) this.dispatch(message.payload);
        });
        if (expired) unlisten();
      };
      this.listening = withTimeout(register(), BROWSE_TIMEOUT_MS,
        () => new Error(translate("common.hostRequestFailed")), () => { expired = true; },
      ).catch((error: unknown) => {
        this.listening = undefined;
        throw error;
      });
    }
    return this.listening;
  }

  private async requestTauri(
    id: string,
    frame: string,
    operation: string,
    invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
  ): Promise<unknown> {
    const browse = operation === "browse";
    const response = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    const send = this.ensureListening().then(async () => {
      if (this.pending.has(id)) await invoke("send_to_sidecar", { frame });
    }).catch((error: unknown) => {
      if (browse) throw new Error(translate("home.pickerDesktopUnavailable"));
      throw error instanceof Error ? error : new Error(String(error));
    });
    const deadline = browse ? BROWSE_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
    try {
      const [value] = await withTimeout(Promise.all([response, send]), deadline, () =>
        new Error(browse ? translate("home.pickerDesktopUnavailable")
          : `The host did not answer request ${id} within ${deadline / 1000} seconds.`),
      );
      return value;
    } finally {
      this.pending.delete(id);
    }
  }

  private async requestBrowser(frame: string, operation: string, input: unknown): Promise<unknown> {
    const browse = operation === "browse";
    const controller = browse ? new AbortController() : undefined;
    const clientAnalysis = operation === "client-usage";
    const request = async () => {
      const token = await this.browserToken().catch((error: unknown) => {
        if (clientAnalysis) throw new Error(translate("clientUsage.browserUnavailable"));
        throw error;
      });
      controller?.signal.throwIfAborted();
      const response = await fetch("/api", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tanit-token": token,
        },
        body: frame,
        signal: controller?.signal,
      });
      if (browse && (response.status === 401 || response.status === 403)) {
        this.browserTokenRequest = undefined;
        throw new Error(translate("common.hostRequestFailed"));
      }
      const payload = await readFrame(response);
      if (clientAnalysis && payload === null) throw new Error(translate("clientUsage.browserUnavailable"));
      if (browse && (!payload || !("result" in payload || payload.error))) {
        throw new Error(translate("common.hostRequestFailed"));
      }
      return { token, response, payload };
    };
    const unavailable = () => new Error(translate("home.pickerBrowserUnavailable"));
    const { token, response, payload } = controller
      ? await withTimeout(request().catch(() => { throw unavailable(); }),
          BROWSE_TIMEOUT_MS, unavailable, () => controller.abort())
      : await request();
    if (!response.ok || payload?.error) {
      throw new Error(payload?.error?.message ?? `${translate("common.hostRequestFailed")} (${response.status})`);
    }
    const value = unwrap(payload?.result, translate("common.hostRequestFailed"));
    if (operation === "watch") {
      const id = subscriptionIdOf(value);
      if (id !== null) {
        try { await this.openBrowserStream(id, token); }
        catch (error) {
          await this.send("cancel", { subscriptionId: id }).catch(() => undefined);
          throw error;
        }
      }
    } else if (operation === "cancel" && typeof input === "object" && input !== null &&
               "subscriptionId" in input && typeof input.subscriptionId === "string") {
      this.streams.get(input.subscriptionId)?.abort();
      this.streams.delete(input.subscriptionId);
    }
    return value;
  }

  private async browserToken(): Promise<string> {
    const embedded = document.documentElement.dataset.tanitToken;
    if (embedded) return embedded;
    if (!this.browserTokenRequest) {
      const controller = new AbortController();
      const loadToken = async () => {
        const response = await fetch("/api/bootstrap", {
          headers: { "x-tanit-bootstrap": "1" },
          signal: controller.signal,
        });
        if (response.ok && response.headers.get("content-type")?.includes("application/json")) {
          const body: unknown = await response.json();
          if (typeof body === "object" && body !== null && "token" in body &&
              typeof body.token === "string" && body.token.length > 0) return body.token;
        }
        throw new Error(`${translate("common.hostRequestFailed")} (${response.status})`);
      };
      this.browserTokenRequest = withTimeout(loadToken(), BROWSE_TIMEOUT_MS,
        () => new Error(translate("common.hostRequestFailed")), () => controller.abort(),
      ).catch((error: unknown) => {
        this.browserTokenRequest = undefined;
        throw error;
      });
    }
    return this.browserTokenRequest;
  }

  private async openBrowserStream(subscriptionId: string, token: string): Promise<void> {
    const controller = new AbortController();
    this.streams.set(subscriptionId, controller);
    const response = await fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tanit-token": token },
      body: JSON.stringify({ subscriptionId }), signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      this.streams.delete(subscriptionId);
      controller.abort();
      throw new Error(`Live event stream failed (${response.status})`);
    }
    const reader = response.body.getReader();
    const abortReader = () => { void reader.cancel().catch(() => undefined); };
    controller.signal.addEventListener("abort", abortReader, { once: true });
    const decoder = new TextDecoder();
    const consume = async () => {
      let pending = "";
      let ended = false;
      try {
        while (!controller.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          pending += decoder.decode(chunk.value, { stream: true });
          let newline: number;
          while ((newline = pending.indexOf("\n")) >= 0) {
            const line = pending.slice(0, newline);
            pending = pending.slice(newline + 1);
            const frame = parseFrame(line);
            if (frame) {
              const params = frame.params;
              if (typeof params === "object" && params !== null && "type" in params &&
                  (params.type === "subscription-closed" || params.type === "session-closed")) ended = true;
              this.dispatch(frame);
            }
          }
        }
        if (!controller.signal.aborted && !ended) throw new Error("Live connection closed");
      } catch (error) {
        if (!controller.signal.aborted) this.dispatch({ jsonrpc: "2.0", method: "tanit/connection-error",
          params: { subscriptionId, message: error instanceof Error ? error.message : String(error) } });
      } finally {
        if (this.streams.get(subscriptionId) === controller) this.streams.delete(subscriptionId);
        controller.signal.removeEventListener("abort", abortReader);
        controller.abort();
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    };
    void consume();
  }

  /**
   * Handles whatever came through the channel: a response to a request
   * that is waiting, and/or an event for the subscribers.
   */
  private dispatch(raw: unknown): void {
    const frame = parseFrame(raw);
    if (frame === null) return;

    const id = frame.id;
    if (typeof id === "string") {
      const waiting = this.pending.get(id);
      if (waiting !== undefined) {
        this.pending.delete(id);
        if (frame.error) {
          waiting.reject(new Error(frame.error.message ?? translate("common.hostRequestFailed")));
        } else {
          try {
            waiting.resolve(unwrap(frame.result, translate("common.hostRequestFailed")));
          } catch (error) {
            waiting.reject(error instanceof Error ? error : new Error(String(error)));
          }
        }
        return;
      }
    }
    // Not an answer to anything we asked: the backend is pushing.
    for (const listener of this.listeners) listener(frame);
  }

  private tauri(): ITauriGlobal | undefined {
    return (globalThis as { __TAURI__?: ITauriGlobal }).__TAURI__;
  }
}

/**
 * Reads the envelope.
 *
 * The Tauri side carries the frame as **text** — the Rust side hands
 * over the line it read, not a parsed object — so a string is the
 * normal case there, not the exception. The browser side already
 * delivers an object.
 */
function parseFrame(raw: unknown): IWireFrame | null {
  if (typeof raw === "string") {
    try {
      return parseFrame(JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }
  if (typeof raw !== "object" || raw === null) return null;
  const frame = raw as IWireFrame;
  if (frame.jsonrpc !== "2.0") return null;
  return frame;
}

/**
 * Reads the answer of the browser carrier.
 *
 * The body may not be JSON at all: a proxy in the middle, or a
 * server that answered with an HTML error page. Saying "the answer
 * was not JSON" beats a `SyntaxError` about a character the user
 * never wrote.
 */
async function readFrame(response: Response): Promise<IWireFrame | null> {
  return parseFrame(await response.text());
}

/**
 * Gives a request a deadline.
 *
 * A promise that never settles is the worst kind of failure: the
 * caller waits, the spinner spins, and nobody learns anything. When
 * the deadline passes, the request fails with a sentence that says
 * what happened, and the pending entry is forgotten — otherwise the
 * map would keep the answer nobody will ever read.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  timeoutError: () => Error,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(timeoutError());
    }, ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * Unwraps the application's answer.
 *
 * The bridge answers with `{ result: { ok: true, value } }` — the
 * `ApiResult` — and the callers want the value. A failure comes as
 * `{ ok: false, error }`, and that is an exception: the caller asked
 * for something and did not get it.
 *
 * A payload that is not an `ApiResult` is passed through untouched:
 * a transport that answers something else is not this function's
 * business to reinterpret.
 */
function unwrap(result: unknown, fallback: string): unknown {
  if (typeof result !== "object" || result === null) return result;
  const envelope = result as { ok?: boolean; value?: unknown; error?: { message?: string } };
  if (envelope.ok === true) return envelope.value;
  if (envelope.ok === false) {
    throw new Error(envelope.error?.message ?? fallback);
  }
  return result;
}

/** Read only the subscription identity from a successful watch result. */
function subscriptionIdOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("subscription" in value) ||
      typeof value.subscription !== "object" || value.subscription === null ||
      !("subscriptionId" in value.subscription)) return null;
  return typeof value.subscription.subscriptionId === "string" ? value.subscription.subscriptionId : null;
}
