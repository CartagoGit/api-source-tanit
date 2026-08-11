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
  // El encoding es opcional en la API real (utf8 por defecto para
  // strings); declararlo obligatorio hacía fallar el typecheck de
  // cualquier `writeFile(path, data)`.
  export function writeFile(
    path: string,
    data: string,
    encoding?: "utf8" | "utf-8",
  ): Promise<void>;
  export function mkdir(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<string | undefined>;
  // El orden importa y estuvo al revés. TypeScript se queda con la
  // **primera** sobrecarga que encaje, y `{ withFileTypes: true }` encaja
  // con `withFileTypes?: boolean`, así que la llamada tipaba `string[]`
  // aunque devolviera `Dirent[]`. El repo entero lo esquivaba a base de
  // `as never` —doce sitios—, que apaga la comprobación de `entry.name`
  // y `entry.isDirectory()` justo donde hace falta. La sobrecarga
  // específica va primero.
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
   * Dentro del mismo sistema de ficheros es **atómico**: quien lea el
   * destino ve el contenido de antes o el de después, nunca la mitad.
   * Es lo que sostiene `atomic-write.helper`.
   */
  export function rename(from: string, to: string): Promise<void>;
  export function realpath(path: string): Promise<string>;
  export function stat(path: string): Promise<{
    isDirectory(): boolean;
    isFile(): boolean;
    size: number;
    /** Bits de permisos, para comprobar el de ejecución. */
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
}

// --- node:os -------------------------------------------------------------
declare module "node:os" {
  export function tmpdir(): string;
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
   * El separador de listas de rutas: `:` en POSIX, `;` en Windows. Lo
   * usa `POSTMAN_CONTAIN_ROOT`, que lleva varias raíces en una variable.
   */
  export const delimiter: string;
}

// --- node:fs (sync) ------------------------------------------------------
declare module "node:fs" {
  /**
   * Lo que este repo usa de un vigilante de ficheros: cerrarlo.
   *
   * No cerrarlo deja el proceso vivo para siempre, porque el event loop
   * sigue teniendo trabajo pendiente.
   */
  export interface FSWatcher {
    close(): void;
  }
  /**
   * `recursive` es obligatorio aquí a propósito.
   *
   * Sin él, `fs.watch` mira **solo el primer nivel** de carpetas y no
   * avisa de nada que pase dentro — que en un proyecto de API es
   * absolutamente todo. Fallaría en silencio pareciendo que funciona.
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
    encoding: BufferEncoding,
  ): void;
  export function readFileSync(
    path: string,
    encoding: BufferEncoding,
  ): string;
  // Mismo orden que en la versión asíncrona, y por el mismo motivo.
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
  /** Stream de salida de un hijo, en lo que este repo usa de él. */
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
   * Lo que devuelve `spawnSync` cuando se le pasa un `encoding`.
   *
   * Va aparte porque sin `encoding` los streams son `Buffer`, y una
   * declaración única obligaría a comprobar `typeof stdout === "string"`
   * en cada uso aunque el `encoding` esté puesto tres líneas antes.
   */
  export interface SpawnSyncStringResult {
    status: number | null;
    stdout: string;
    stderr: string;
    pid: number;
    signal: string | null;
    error?: Error;
  }
  /** Opciones comunes a las dos formas de `spawnSync`. */
  interface SpawnSyncOptions {
    stdio?: "inherit" | "pipe" | "ignore" | Array<"inherit" | "pipe" | "ignore">;
    cwd?: string;
    env?: Record<string, string | undefined>;
    timeout?: number;
    /**
     * Tope de bytes capturados. El de por defecto es 1 MiB, y un
     * `git log` de un repo con historia lo pasa de largo — a partir de
     * ahí la salida se **trunca**, que es peor que fallar porque el
     * resultado parece correcto.
     */
    maxBuffer?: number;
  }
  // El overload con `encoding` va primero: es el más específico.
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

/** Subconjunto de `Buffer` que usa el paquete (UUID v5, lectura de bytes). */
declare const Buffer: {
  from(value: string, encoding?: string): BufferLike;
  from(value: IBufferLike): BufferLike;
};
declare type BufferLike = IBufferLike;
/** Hash incremental de `node:crypto`. `update` encadena. */
interface IHash {
  update(data: string | IBufferLike): IHash;
  digest(): IBufferLike;
  digest(encoding: string): string;
}
/**
 * Lo que este paquete usa de un `Buffer`.
 *
 * **Extiende `Uint8Array` porque un `Buffer` lo es.** La declaración
 * anterior describía la forma a mano —`length`, índice, `subarray`— sin
 * decir que fuera un `Uint8Array`, así que devolver uno donde se
 * esperaba el otro exigía un `as unknown as Uint8Array` en
 * `collection-identity.helper`. No era el código el que estaba mal: era
 * esta declaración la que se quedaba corta, y el casting tapaba la
 * diferencia en vez de arreglarla.
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
   * Id del proceso. Lo usa `atomic-write.helper` para nombrar su fichero
   * temporal: dos procesos escribiendo la misma ruta a la vez no pueden
   * compartir temporal, o el `rename` de uno se lleva lo del otro.
   */
  pid: number;
  /**
   * Id del usuario efectivo, en POSIX. No existe en Windows, de ahí el
   * opcional.
   *
   * Lo usa el test de permisos: como **root**, `chmod 0555` no impide
   * escribir, así que el escenario que prueba no existe y el test
   * pasaría siempre sin comprobar nada. Se vio corriendo el gate dentro
   * de un contenedor.
   */
  getuid?: () => number;
  platform: NodeJS.Platform;
  /** Escritura sin salto de línea, para indicadores de progreso. */
  stderr: { write(chunk: string): boolean };
  /**
   * `isTTY` y `columns` son `undefined` cuando la salida está
   * redirigida — y esa es justo la señal que hace falta: si nadie mira,
   * no se pinta con color ni se ajusta a un ancho que no existe.
   */
  stdout: {
    write(chunk: string): boolean;
    readonly isTTY?: boolean;
    readonly columns?: number;
  };
  /**
   * Señales del sistema, una sola vez.
   *
   * Lo usa `watch` para cerrar el vigilante en el Ctrl+C: sin cerrarlo,
   * el handle de `fs.watch` queda abierto y el proceso no termina.
   */
  once(event: "SIGINT" | "SIGTERM", listener: () => void): void;
  /**
   * Igual que `once`, pero para lo que se escucha mientras el proceso
   * vive. `ui:dev` lo necesita: cierra el servidor hijo al recibir la
   * señal, y eso puede pasar en cualquier momento.
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
 * Subconjunto de la API global de Bun que usan los scripts.
 * Se declara a mano por el mismo motivo que el resto: el proyecto no
 * depende de `@types/bun` ni de `@types/node`.
 */
declare const Bun: {
  /** Stream de entrada estándar, usado por el asistente interactivo. */
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
     * Manda una señal al proceso hijo.
     *
     * Faltaba, y el hueco lo destapó `ui:dev`: sin esto, un script que
     * lanza un servidor y lo reinicia no tiene forma de pararlo, y deja
     * un proceso huérfano ocupando el puerto en cada guardado.
     */
    kill(signal?: "SIGTERM" | "SIGKILL" | "SIGINT"): void;
  };
  write(path: string, data: string): Promise<number>;
  file(path: string): { text(): Promise<string>; readonly size: number };
  /**
   * Servidor HTTP del runtime, para `expostman ui`.
   *
   * Está en Bun desde siempre, así que la interfaz de escritorio no
   * añade **ni una dependencia**: el binario compilado ya lo lleva
   * dentro. Es lo que hizo descartar Electron, que son 150 MB por
   * plataforma para envolver lo mismo.
   *
   * `hostname` se declara porque importa: esto lee el código fuente de
   * quien lo usa y no tiene por qué ser alcanzable desde la red.
   */
  serve(options: {
    port: number;
    hostname?: string;
    fetch: (request: IServerRequest) => Response | Promise<Response>;
  }): { readonly port: number; stop(closeActiveConnections?: boolean): void };
};

/** Lo que este repo usa de una petición entrante. */
interface IServerRequest {
  readonly url: string;
  readonly method: string;
  /**
   * Las cabeceras.
   *
   * Faltaban, y el hueco lo destapó cerrar el CSRF de la interfaz: sin
   * ellas no hay forma de mirar el `Origin` ni un testigo, o sea que el
   * servidor no podía distinguir su propia página de cualquier web que
   * le hiciera un POST desde el navegador de quien lo ejecuta.
   */
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/** La respuesta del estándar web, en lo que se usa de ella. */
declare const Response: {
  /**
   * `body` acepta `unknown` porque también se usa para leer los streams
   * de `Bun.spawn` (`new Response(proc.stdout).text()`), que no son
   * cadenas. Estrechar el tipo a `string` rompía los dos scripts que ya
   * lo hacían así.
   */
  new (
    body?: unknown,
    init?: { status?: number; headers?: Record<string, string> },
  ): IFetchResponse;
  json(data: unknown, init?: { status?: number }): IFetchResponse;
};

/** `Response` del estándar fetch, usado para leer los streams de Bun.spawn. */
interface IFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}
declare type FetchResponse = IFetchResponse;

/** `fetch` del estándar web, disponible en Bun y en Node >= 18. */
declare function fetch(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<IFetchResponse>;

/** Decodificador de bytes a texto, para leer stdin. */
declare class TextDecoder {
  /**
   * `stream: true` mantiene el estado entre trozos, para no partir un
   * carácter multibyte que caiga a caballo de dos `data` del proceso.
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

// `import.meta` en ESM estándar solo expone `url`. Bun lo extiende con
// `dir` (directorio del archivo actual). Lo declaramos para que tsc lo
// acepte sin instalar bun-types.
interface ImportMeta {
  url: string;
  dir: string;
  /** Bun/Node: true si este módulo es el punto de entrada del proceso. */
  main: boolean;
}

// --- timers globales -----------------------------------------------------
//
// Estaban sin declarar y el proyecto raíz no se enteraba porque
// `vitest.config.ts` arrastraba los tipos de vitest, que a su vez traen
// los de node. En cuanto cada sección pasó a tipar por su cuenta,
// `setTimeout` dejó de existir en `core` y en `frameworks`. Un tipado
// que solo funciona por lo que otro fichero arrastra de refilón no es
// un tipado.
declare function setTimeout(
  handler: () => void,
  timeout?: number,
): { readonly __timer: unique symbol };
declare function clearTimeout(handle: ReturnType<typeof setTimeout>): void;
declare function setInterval(
  handler: () => void,
  timeout?: number,
): { readonly __timer: unique symbol };
declare function clearInterval(handle: ReturnType<typeof setInterval>): void;
