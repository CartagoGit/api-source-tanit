/** Options and runtime handle exposed by the HTTP application bridge. */
export interface IHttpBridgeOptions {
  readonly registry: Readonly<Record<string, unknown>>;
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
  /**
   * A folder of static files to serve besides the API.
   *
   * The desktop app in the browser needs the **same origin** for the
   * page and for `POST /api` — a page on one port asking another
   * port is a cross-origin request, and the answer to that is either
   * CORS or a token that a third party could read. Serving the files
   * from here avoids both.
   *
   * The token is planted in the served HTML (`data-tanit-token` on the
   * `<html>` element), so the page can authenticate without the server
   * having to hand it out anywhere else.
   */
  readonly staticDir?: string;
}

/** Observable state of a started HTTP application bridge. */
export interface IHttpBridge {
  readonly url: string;
  readonly port: number;
  readonly token: string;
  stop(): void;
}

/** Options injected into the stdio application bridge. */
export interface IStdioBridgeOptions {
  readonly registry: Readonly<Record<string, unknown>>;
  readonly input: AsyncIterable<string> | Iterable<string>;
  readonly output: { write(line: string): void };
  /** What the bridges pass as `IRequestContext.caller`. Always "desktop". */
  readonly caller?: "desktop";
  /** Workspace root to forward into `IRequestContext.workspace`. */
  readonly workspace?: string;
  /** Optional orchestrator the registry handlers expect. */
  readonly orchestrator?: unknown;
  /** Surface fatal startup errors (e.g. malformed frame). */
  readonly onError?: (err: unknown) => void;
}