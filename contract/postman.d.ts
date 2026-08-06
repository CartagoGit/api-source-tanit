/**
 * Declaraciones de tipos mínimas para que `tsc --noEmit` no requiera
 * `@types/node` ni `bun-types` instalados.
 *
 * En tiempo de ejecución, **Bun** ya provee los módulos `node:fs/promises`,
 * `node:path`, etc. Este archivo solo satisface al compilador.
 *
 * Si en algún momento se quiere un typecheck más estricto o un IDE más
 * completo, basta con instalar `@types/node` y eliminar este archivo.
 */

// --- node:fs/promises ----------------------------------------------------
declare module "node:fs/promises" {
  export function readFile(
    path: string,
    encoding: "utf8" | "utf-8",
  ): Promise<string>;
  export function writeFile(
    path: string,
    data: string,
    encoding: "utf8" | "utf-8",
  ): Promise<void>;
  export function mkdir(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<string | undefined>;
  export function readdir(
    path: string,
    options?: { recursive?: boolean; withFileTypes?: boolean },
  ): Promise<string[]>;
  export function readdir(
    path: string,
    options: { recursive?: boolean; withFileTypes: true },
  ): Promise<Dirent[]>;

  export interface Dirent {
    name: string;
    isFile(): boolean;
    isDirectory(): boolean;
  }
  export function stat(path: string): Promise<{ isDirectory(): boolean }>;
  export function cp(
    src: string,
    dest: string,
    options?: { recursive?: boolean },
  ): Promise<void>;
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
}

// --- node:fs (sync) ------------------------------------------------------
declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function mkdirSync(
    path: string,
    options?: { recursive?: boolean },
  ): string | undefined;
  export function writeFileSync(
    path: string,
    data: string,
    encoding: BufferEncoding,
  ): void;
  export function readFileSync(
    path: string,
    encoding: BufferEncoding,
  ): string;
  export function readdirSync(
    path: string,
    options?: { recursive?: boolean; withFileTypes?: boolean },
  ): string[];
}

// --- node:child_process --------------------------------------------------
declare module "node:child_process" {
  export interface ChildProcess {
    on(event: "exit", listener: (code: number | null) => void): ChildProcess;
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
      stdio?: "inherit" | "pipe" | "ignore";
      cwd?: string;
      env?: Record<string, string | undefined>;
      shell?: boolean | string;
    },
  ): ChildProcess;
  export function spawnSync(
    command: string,
    args: string[],
    options?: {
      stdio?: "inherit" | "pipe" | "ignore";
      cwd?: string;
      env?: Record<string, string | undefined>;
      encoding?: BufferEncoding;
    },
  ): SpawnSyncResult;
}

// --- node:url ------------------------------------------------------------
declare module "node:url" {
  export function pathToFileURL(path: string): { href: string };
  export function fileURLToPath(url: string | { href: string }): string;
}

// --- node:crypto --------------------------------------------------------
declare module "node:crypto" {
  export function randomUUID(): string;
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
  platform: NodeJS.Platform;
  /** Escritura sin salto de línea, para indicadores de progreso. */
  stderr: { write(chunk: string): boolean };
  stdout: { write(chunk: string): boolean };
};
declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
};
declare const __dirname: string;
declare const URL: {
  new (url: string, base?: string): {
    hostname: string;
    protocol: string;
    port: string;
    pathname: string;
  };
};

// `import.meta` en ESM estándar solo expone `url`. Bun lo extiende con
// `dir` (directorio del archivo actual). Lo declaramos para que tsc lo
// acepte sin instalar bun-types.
interface ImportMeta {
  url: string;
  dir: string;
}
