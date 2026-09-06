/**
 * Minimal type declarations so `tsc --noEmit` does not require
 * `@types/node` or `bun-types` to be installed.
 *
 * At runtime, **Bun** already provides the `node:fs/promises`,
 * `node:path`, etc. modules. This file only satisfies the compiler.
 *
 * If at some point we want stricter typechecking or a more complete IDE,
 * just install `@types/node` and remove this file.
 */

// --- node:fs/promises ----------------------------------------------------
declare module "node:fs/promises" {
  export function readFile(
    path: string,
    encoding: "utf8" | "utf-8",
  ): Promise<string>;
  // The encoding is optional in the real API (utf8 by default for
  // strings); making it mandatory broke the typecheck of any
  // `writeFile(path, data)`.
  export function writeFile(
    path: string,
    data: string,
    encoding?: "utf8" | "utf-8",
  ): Promise<void>;
  export function mkdir(
    path: string,
    options?: { recursive?: boolean; mode?: number },
  ): Promise<string | undefined>;
  // The order matters and was inverted. TypeScript keeps the
  // **first** overload that fits, and `{ withFileTypes: true }` matches
  // `withFileTypes?: boolean`, so the call was typed as `string[]`
  // even though it returned `Dirent[]`. The whole repo worked around it
  // with `as never` —twelve places—, which silences the `entry.name`
  // and `entry.isDirectory()` checks exactly where they're needed. The
  // specific overload goes first.
  export function readdir(
    path: string,
    options: { recursive?: boolean; withFileTypes: true },
  ): Promise<Dirent[]>;
  export function readdir(
    path: string,
    options?: { recursive?: boolean; withFileTypes?: false },
  ): Promise<string[]>;

  export interface Dirent {
    name: string;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
  }
  /**
   * Within the same filesystem it is **atomic**: a reader of the
   * destination sees either the old or the new contents, never half.
   * This is what `atomic-write.helper` relies on.
   */
  export function rename(from: string, to: string): Promise<void>;
  export function realpath(path: string): Promise<string>;
  export function stat(path: string): Promise<{
    isDirectory(): boolean;
    isFile(): boolean;
    size: number;
    /** Permission bits, used to check the execute bit. */
    mode: number;
  }>;
  export function copyFile(src: string, dest: string): Promise<void>;
  export function symlink(target: string, path: string): Promise<void>;
  export function chmod(path: string, mode: number): Promise<void>;
  export function cp(
    src: string,
    dest: string,
    options?: { recursive?: boolean },
  ): Promise<void>;
  export function mkdtemp(prefix: string): Promise<string>;
  export function rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<void>;
  /**
   * Append to the end of an existing file (or create it if missing).
   *
   * On POSIX it opens with `O_APPEND`, which is atomic per `write(2)`
   * for files on the same filesystem. This is what supports the
   * `appendFileAtomic` that `history.service` uses to write
   * `~/.tanit/history.jsonl` without clobbering a concurrent writer.
   */
  export function appendFile(
    path: string,
    data: string,
    encoding?: "utf8" | "utf-8",
  ): Promise<void>;
  export function unlink(path: string): Promise<void>;
}

// --- node:os -------------------------------------------------------------
declare module "node:os" {
  export function tmpdir(): string;
  /**
   * Home directory of the current user. x00051 S1: `packages/ui`
   * (config-dir, history-paths, browse.service) resolves
   * `~/.tanit/...` from it. It was silently covered by a hoisted
   * orphan `@types/node` locally; CI, with a clean install, exposed
   * the gap.
   */
  export function homedir(): string;
}

// --- node:path -----------------------------------------------------------
declare module "node:path" {
  export function resolve(...segments: string[]): string;
  export function dirname(p: string): string;
  export function basename(p: string, ext?: string): string;
  export function extname(p: string): string;
  export function join(...segments: string[]): string;
  export function relative(from: string, to: string): string;
  export function isAbsolute(p: string): boolean;
  export const sep: string;
  /**
   * The list separator for paths: `:` on POSIX, `;` on Windows. Used
   * by `POSTMAN_CONTAIN_ROOT`, which carries several roots in one
   * variable.
   */
  export const delimiter: string;
  /**
   * Split a path into its parts. x00051 S1: `browse.service` (the
   * file explorer of the desktop UI) uses `dir`/`base`/`name` to
   * render breadcrumbs and file entries.
   */
  export function parse(p: string): {
    root: string;
    dir: string;
    base: string;
    ext: string;
    name: string;
  };
}

// --- node:fs (sync) ------------------------------------------------------
declare module "node:fs" {
  /**
   * What this repo uses from a filesystem watcher: closing it.
   *
   * Not closing it keeps the process alive forever, because the event
   * loop still has pending work.
   */
  export interface FSWatcher {
    close(): void;
  }
  /**
   * `recursive` is intentionally mandatory here.
   *
   * Without it, `fs.watch` watches **only the first level** of
   * directories and does not report anything that happens inside —
   * which in an API project is absolutely everything. It would fail
   * silently while looking like it worked.
   */
  export function watch(
    path: string,
    options: { recursive: boolean },
    listener: (event: string, fileName: string | null) => void,
  ): FSWatcher;
  export function existsSync(path: string): boolean;
  export function statSync(path: string): {
    isDirectory(): boolean;
    isFile(): boolean;
    size: number;
  };
  export function mkdtempSync(prefix: string): string;
  export function rmSync(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): void;
  export function mkdirSync(
    path: string,
    options?: { recursive?: boolean },
  ): string | undefined;
  export function writeFileSync(
    path: string,
    data: string,
    encoding?: BufferEncoding,
  ): void;
  export function readFileSync(
    path: string,
    encoding?: BufferEncoding,
  ): string;
  // Same order as in the async version, and for the same reason.
  export function readdirSync(
    path: string,
    options: { recursive?: boolean; withFileTypes: true },
  ): Dirent[];
  export function readdirSync(
    path: string,
    options?: { recursive?: boolean; withFileTypes?: false },
  ): string[];

  export interface Dirent {
    name: string;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
  }
}

// --- node:child_process --------------------------------------------------
declare module "node:child_process" {
  /** Output stream of a child, in what this repo uses of it. */
  export interface ChildStream {
    on(event: "data", listener: (chunk: Uint8Array) => void): ChildStream;
  }
  export interface ChildProcess {
    readonly stdout: ChildStream | null;
    readonly stderr: ChildStream | null;
    kill(signal?: string): boolean;
    on(event: "exit", listener: (code: number | null) => void): ChildProcess;
    on(event: "close", listener: (code: number | null) => void): ChildProcess;
    on(event: "error", listener: (error: Error) => void): ChildProcess;
    on(event: string, listener: (...args: unknown[]) => void): ChildProcess;
  }
  export interface SpawnSyncResult {
    status: number | null;
    stdout: Buffer | string;
    stderr: Buffer | string;
    pid: number;
    output: Array<Buffer | string>;
    signal: string | null;
  }
  export function spawn(
    command: string,
    args: string[],
    options?: {
      /** Global, o por descriptor (`["ignore", "pipe", "pipe"]`). */
      stdio?: "inherit" | "pipe" | "ignore" | Array<"inherit" | "pipe" | "ignore">;
      cwd?: string;
      env?: Record<string, string | undefined>;
      shell?: boolean | string;
    },
  ): ChildProcess;
  /**
   * What `spawnSync` returns when given an `encoding`.
   *
   * It lives separately because without `encoding` the streams are
   * `Buffer`, and a single declaration would force `typeof stdout ===
   * "string"` checks at every use even though `encoding` is set three
   * lines earlier.
   */
  export interface SpawnSyncStringResult {
    status: number | null;
    stdout: string;
    stderr: string;
    pid: number;
    signal: string | null;
    error?: Error;
  }
  /** Options common to both forms of `spawnSync`. */
  interface SpawnSyncOptions {
    stdio?: "inherit" | "pipe" | "ignore" | Array<"inherit" | "pipe" | "ignore">;
    cwd?: string;
    env?: Record<string, string | undefined>;
    timeout?: number;
    /**
     * Cap on captured bytes. The default is 1 MiB, and a `git log`
     * of a repo with history blows past it — past that point the
     * output is **truncated**, which is worse than failing because
     * the result looks correct.
     */
    maxBuffer?: number;
  }
  // The overload with `encoding` goes first: it is the most specific.
  export function spawnSync(
    command: string,
    args: string[],
    options: SpawnSyncOptions & { encoding: BufferEncoding },
  ): SpawnSyncStringResult;
  export function spawnSync(
    command: string,
    args: string[],
    options?: SpawnSyncOptions,
  ): SpawnSyncResult;
  /**
   * Buffered command execution with a callback. x00051 S1: the repo
   * gates (`lint-clean-tree`, `lint-proposals`, `lint-root-allowlist`,
   * `lint-no-skip-env-vars`, `lint-integration-verifier`) use it
   * wrapped in `promisify` from `node:util` to run `git status`,
   * `grep`, `git ls-files`. The callback form is declared because
   * that is what `promisify` consumes; the promisified result shape
   * is `{ stdout, stderr }` and `promisify` derives it from the
   * last callback argument — for our uses the resolution value is
   * read destructured, and the errors carry a numeric `code`
   * (grep/git exit status) on the rejected value.
   */
  export function execFile(
    file: string,
    args: ReadonlyArray<string>,
    options: { cwd?: string; maxBuffer?: number },
    callback: (
      error: (Error & { code?: number | string }) | null,
      stdout: string,
      stderr: string,
    ) => void,
  ): ChildProcess;
}

// --- node:util -----------------------------------------------------------
declare module "node:util" {
  /**
   * Deliberately narrow: the ONLY function this repo promisifies is
   * `execFile` (the gates: lint-clean-tree, lint-proposals,
   * lint-root-allowlist, lint-no-skip-env-vars,
   * lint-integration-verifier). A general `promisify` would need
   * overloads for every callback convention — none is used here, and
   * the declaration is typed with `typeof import(...)` exactly so a
   * second promisify target forces this file to grow consciously.
   * x00051 S1.
   */
  export function promisify(
    fn: typeof import("node:child_process").execFile,
  ): (
    file: string,
    args: ReadonlyArray<string>,
    options?: { cwd?: string; maxBuffer?: number },
  ) => Promise<{ stdout: string; stderr: string }>;
}

// --- node:url ------------------------------------------------------------
declare module "node:url" {
  export function pathToFileURL(path: string): { href: string };
  export function fileURLToPath(url: string | { href: string }): string;
}

// --- node:crypto --------------------------------------------------------
declare module "node:crypto" {
  export function randomUUID(): string;
  export function createHash(algorithm: string): IHash;
}

/** Subset of `Buffer` used by the package (UUID v5, byte reads). */
declare const Buffer: {
  from(value: string, encoding?: string): BufferLike;
  from(value: IBufferLike): BufferLike;
};
declare type BufferLike = IBufferLike;
/** Incremental hash from `node:crypto`. `update` chains. */
interface IHash {
  update(data: string | IBufferLike): IHash;
  digest(): IBufferLike;
  digest(encoding: string): string;
}
/**
 * What this package uses from a `Buffer`.
 *
 * **Extends `Uint8Array` because a `Buffer` is one.** The previous
 * declaration described the shape by hand —`length`, index,
 * `subarray`— without saying it was a `Uint8Array`, so returning one
 * where the other was expected required an `as unknown as Uint8Array`
 * in `collection-identity.helper`. The code wasn't wrong: this
 * declaration fell short, and the cast hid the difference instead of
 * fixing it.
 */
interface IBufferLike extends Uint8Array {
  subarray(start?: number, end?: number): IBufferLike;
  toString(encoding?: string): string;
}
declare const crypto: {
  randomUUID(): string;
};

// --- Globals extendidos ------------------------------------------------
declare const process: {
  argv: string[];
  exit(code?: number): never;
  cwd(): string;
  env: Record<string, string | undefined>;
  execPath: string;
  /**
   * Process id. Used by `atomic-write.helper` to name its temporary
   * file: two processes writing the same path concurrently cannot
   * share a temporary, or one's `rename` would clobber the other's.
   */
  pid: number;
  /**
   * Effective user id, on POSIX. It does not exist on Windows,
   * hence the optional.
   *
   * Used by the permissions test: as **root**, `chmod 0555` does not
   * prevent writing, so the scenario being tested doesn't exist and
   * the test would always pass without checking anything. This was
   * spotted running the gate inside a container.
   */
  getuid?: () => number;
  platform: NodeJS.Platform;
  /** Write without a trailing newline, for progress indicators. */
  stderr: { write(chunk: string): boolean };
  /**
   * `isTTY` and `columns` are `undefined` when output is redirected —
   * and that is exactly the signal we need: if nobody is watching,
   * don't paint with color or fit to a width that doesn't exist.
   */
  stdout: {
    write(chunk: string): boolean;
    readonly isTTY?: boolean;
    readonly columns?: number;
  };
  /**
   * System signals, once.
   *
   * Used by `watch` to close the watcher on Ctrl+C: without closing
   * it, the `fs.watch` handle stays open and the process never
   * terminates.
   */
  once(event: "SIGINT" | "SIGTERM", listener: () => void): void;
  /**
   * Same as `once`, but for what is listened to while the process is
   * alive. `ui:dev` needs it: it closes the child server on signal,
   * and that can happen at any time.
   */
  on(event: "SIGINT" | "SIGTERM", listener: () => void): void;
};
declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
};
declare const __dirname: string;

/**
 * Subset of Bun's global API used by the scripts.
 * Declared by hand for the same reason as the rest: the project
 * does not depend on `@types/bun` or `@types/node`.
 */
declare const Bun: {
  /** Standard input stream, used by the interactive assistant. */
  readonly stdin: { stream(): AsyncIterable<Uint8Array> };
  spawn(
    command: string[],
    options?: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      stdout?: "pipe" | "inherit" | "ignore";
      stderr?: "pipe" | "inherit" | "ignore";
    },
  ): {
    readonly stdout: unknown;
    readonly stderr: unknown;
    readonly exited: Promise<number>;
    /**
     * Sends a signal to the child process.
     *
     * It was missing, and the gap surfaced in `ui:dev`: without it,
     * a script that launches a server and restarts it has no way to
     * stop it, and leaves an orphan process holding the port on
     * every save.
     */
    kill(signal?: "SIGTERM" | "SIGKILL" | "SIGINT"): void;
  };
  write(path: string, data: string): Promise<number>;
  file(path: string): { text(): Promise<string>; readonly size: number };
  /**
   * Runtime HTTP server, for `apisrc ui`.
   *
   * It has been in Bun forever, so the desktop interface adds **not
   * a single dependency**: the compiled binary already carries it
   * inside. That is what made us discard Electron, which is 150 MB
   * per platform to wrap the same thing.
   *
   * `hostname` is declared because it matters: this reads the source
   * code of whoever uses it and does not have to be reachable from
   * the network.
   */
  serve(options: {
    port: number;
    hostname?: string;
    fetch: (request: IServerRequest) => Response | Promise<Response>;
  }): { readonly port: number; stop(closeActiveConnections?: boolean): void };
};

/** What this repo uses from an incoming request. */
interface IServerRequest {
  readonly url: string;
  readonly method: string;
  /**
   * The headers.
   *
   * They were missing, and the gap surfaced when closing the UI's
   * CSRF: without them there is no way to read the `Origin` or a
   * token, so the server could not distinguish its own page from any
   * web making a POST from the user's browser.
   */
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/** The response from the web standard, in what is used of it. */
declare const Response: {
  /**
   * `body` accepts `unknown` because it is also used to read streams
   * from `Bun.spawn` (`new Response(proc.stdout).text()`), which are
   * not strings. Narrowing the type to `string` broke the two scripts
   * that already did this.
   */
  new (
    body?: unknown,
    init?: { status?: number; headers?: Record<string, string> },
  ): IFetchResponse;
  json(data: unknown, init?: { status?: number }): IFetchResponse;
};

/** `Response` from the fetch standard, used to read Bun.spawn streams. */
interface IFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  /**
   * Response headers. x00051 S1: `ui-server.test.ts` asserts
   * `res.headers.get("content-security-policy")` — the test that a
   * desktop-embedded UI loads nothing from outside. The real
   * `Response.headers` is a `Headers` object; the repo needs only the
   * `get(name)` case.
   */
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}
declare type FetchResponse = IFetchResponse;

/** `fetch` from the web standard, available in Bun and Node >= 18. */
declare function fetch(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<IFetchResponse>;

/** Byte-to-text decoder, for reading stdin. */
declare class TextDecoder {
  /**
   * `stream: true` keeps state across chunks, so a multibyte
   * character that straddles two `data` events is not split.
   */
  decode(input?: Uint8Array, options?: { stream?: boolean }): string;
}
declare type Uint8Array = { readonly length: number };
declare const URL: {
  new (url: string, base?: string): {
    hostname: string;
    protocol: string;
    port: string;
    pathname: string;
  };
};

// `import.meta` in standard ESM only exposes `url`. Bun extends it
// with `dir` (directory of the current file). We declare it here so
// tsc accepts it without installing bun-types.
interface ImportMeta {
  url: string;
  dir: string;
  /** Bun/Node: true if this module is the entry point of the process. */
  main: boolean;
}

// --- Global timers ------------------------------------------------------
//
// They were undeclared and the root project didn't notice because
// `vitest.config.ts` dragged vitest types along, which in turn bring
// node's. As soon as each section started typing on its own,
// `setTimeout` ceased to exist in `core` and `frameworks`. A typing
// that only works because another file drags it along by the sleeve
// is not a typing.
declare function setTimeout(
  handler: () => void,
  timeout?: number,
): { readonly __timer: unique symbol };
declare function clearTimeout(handle: ReturnType<typeof setTimeout>): void;

/**
 * `performance.now()` — the global clock (Web + Node ≥ 16 + Bun all
 * expose it). x00051 S1: `bench-scan.script.ts` times 3 passes per
 * size and computes medians from it. Was silently satisfied by a
 * hoisted orphan `@types/node`; the CI-clean install exposed the gap.
 *
 * High-resolution monotonic clock — exactly what `Date.now()` is NOT
 * (Date is adjustable and subject to NTP jumps), so declaring only
 * `now()` is intentional: bench needs `now()`, nothing else from
 * `Performance`.
 */
declare const performance: {
  now(): number;
};

/**
 * Namespace `NodeJS` — the pieces of it our code reads explicitly.
 * x00051 S1: two usages in CI-clean typecheck:
 *
 *   - `NodeJS.Platform` — `process.platform` ("linux" | "darwin" | …);
 *     used by validate-package and others to branch.
 *   - `NodeJS.ErrnoException` — the `Error & { code?: string }` shape
 *     `history.spec` uses to read `err.code === "ENOENT"` from
 *     `readFile().catch(...)`.
 *
 * Only these two: the repo does NOT reference `NodeJS.Timeout`,
 * `NodeJS.Process`, etc. Adding more invites code that depends on
 * ambient types nobody verifies. Keep it narrow.
 */
declare namespace NodeJS {
  type Platform =
    | "aix"
    | "android"
    | "darwin"
    | "freebsd"
    | "haiku"
    | "linux"
    | "openbsd"
    | "sunos"
    | "win32"
    | "cygwin"
    | "netbsd";

  interface ErrnoException extends Error {
    /** System error code (`"ENOENT"`, `"EACCES"`, …). */
    code?: string | undefined;
    errno?: number | undefined;
    syscall?: string | undefined;
    path?: string | undefined;
  }
}
declare function setInterval(
  handler: () => void,
  timeout?: number,
): { readonly __timer: unique symbol };
declare function clearInterval(handle: ReturnType<typeof setInterval>): void;
