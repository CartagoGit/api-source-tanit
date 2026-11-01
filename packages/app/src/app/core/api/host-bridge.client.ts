import { Injectable } from "@angular/core";
import type {
  IHostBridge,
  IHostRequestMap,
  IHostResponseMap,
  IPendingHostRequestMap,
} from "../../../../../contracts/interfaces/ui/host-bridge.interface";
import type { PendingAppOperation } from "../../../../../contracts/constants/core/cli-app-parity.constant";
import { translate } from "../i18n/i18n.state";

/** What Tauri puts on the window. */
interface ITauriEventApi {
  listen?: (name: string, callback: (event: { payload: unknown }) => void) => Promise<() => void>;
}

/** The part of Tauri's global this connector uses. */
interface ITauriGlobal {
  invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  event?: ITauriEventApi;
}

/** The JSON-RPC envelope on the wire. */
interface IWireFrame {
  readonly jsonrpc: string;
  readonly id?: string | number | null;
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
  private readonly listeners = new Set<(event: unknown) => void>();
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  private listening = false;

  request<K extends keyof IHostRequestMap>(
    operation: K,
    input: IHostRequestMap[K],
  ): Promise<IHostResponseMap[K]> {
    return this.send(operation as string, input) as Promise<IHostResponseMap[K]>;
  }

  requestPending<K extends PendingAppOperation>(
    operation: K,
    input: IPendingHostRequestMap[K],
  ): Promise<unknown> {
    return this.send(operation as string, input);
  }

  subscribe(listener: (event: unknown) => void): () => void {
    this.listeners.add(listener);
    this.ensureListening();
    return () => this.listeners.delete(listener);
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
    if (tauri?.invoke) {
      this.ensureListening();
      return this.requestTauri(id, frame, tauri.invoke);
    }
    return this.requestBrowser(frame);
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
  private ensureListening(): void {
    if (this.listening) return;
    this.listening = true;
    const tauri = this.tauri();
    void tauri?.event?.listen?.("tanit://ipc-message", (event) => {
      this.dispatch(event.payload);
    });
  }

  private async requestTauri(
    id: string,
    frame: string,
    invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
  ): Promise<unknown> {
    const response = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    try {
      await invoke("send_to_sidecar", { frame });
    } catch (error) {
      // The sidecar could not be reached. Without this, the entry
      // stayed in `pending` for ever: a leak per failed call, and a
      // promise that never settled.
      const waiting = this.pending.get(id);
      this.pending.delete(id);
      waiting?.reject(error instanceof Error ? error : new Error(String(error)));
      throw error instanceof Error ? error : new Error(String(error));
    }
    return withTimeout(response, REQUEST_TIMEOUT_MS, id, () => {
      this.pending.delete(id);
    });
  }

  private async requestBrowser(frame: string): Promise<unknown> {
    const token = typeof document !== "undefined"
      ? document.documentElement.dataset.tanitToken
      : undefined;
    const response = await fetch("/api", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { "x-tanit-token": token } : {}),
      },
      body: frame,
    });
    // The body may not be JSON at all: a proxy in the middle, or a
    // server that answered with an HTML error page. Saying "the
    // answer was not JSON" beats a `SyntaxError` about a character
    // the user never wrote.
    const payload = await readFrame(response);
    if (!response.ok || payload.error) {
      throw new Error(payload.error?.message ?? `${translate("common.hostRequestFailed")} (${response.status})`);
    }
    return unwrap(payload.result, translate("common.hostRequestFailed"));
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
          waiting.resolve(unwrap(frame.result, translate("common.hostRequestFailed")));
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
async function readFrame(response: Response): Promise<IWireFrame> {
  const text = await response.text();
  try {
    return parseFrame(JSON.parse(text) as unknown) ?? { jsonrpc: "2.0" };
  } catch {
    return { jsonrpc: "2.0" };
  }
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
  id: string,
  onTimeout: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new Error(`The host did not answer request ${id} within ${ms / 1000} seconds.`));
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
