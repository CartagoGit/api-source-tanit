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