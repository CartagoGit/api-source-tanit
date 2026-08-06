/**
 * Lanzar un proceso desde un test, de forma portable.
 *
 * Los tests que ejercitan el CLI o el binario compilado necesitan
 * arrancar un proceso de verdad. Usaban `Bun.spawn`, que solo existe
 * cuando el runner ES bun: bajo vitest los tests corren en workers de
 * Node y `Bun` no está definido. Este helper usa `node:child_process`,
 * que funciona en los dos.
 *
 * Devuelve stdout y stderr por separado **y** concatenados, porque casi
 * todas las aserciones son del tipo "el CLI dijo esto en algún sitio" y
 * repartir la búsqueda entre dos streams solo genera tests frágiles.
 */
import { spawn } from "node:child_process";

/** Salida completa de un proceso ya terminado. */
export interface IProcessResult {
  /** Código de salida. `-1` si murió por señal. */
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** `stdout + stderr`, para aserciones que no distinguen. */
  readonly output: string;
}

/** Opciones del lanzamiento. */
export interface IRunProcessOptions {
  readonly cwd?: string;
  /** Variables que se **añaden** a las del proceso actual. */
  readonly env?: Record<string, string | undefined>;
  /**
   * Entorno exacto, sin heredar nada del proceso actual.
   *
   * Lo usa el test del binario compilado: recorta el `PATH` para que no
   * haya ni bun ni node y así comprobar que el ejecutable es de verdad
   * autocontenido. Si esto heredase el entorno, el test pasaría siempre
   * y no probaría nada.
   */
  readonly exactEnv?: Record<string, string>;
  /** Milisegundos antes de matarlo. Por defecto 120 s. */
  readonly timeoutMs?: number;
}

/**
 * Ejecuta `command args…` y espera a que termine.
 *
 * Nunca lanza por un exit code distinto de 0: el código es parte del
 * resultado y muchos tests lo comprueban a propósito. Sí lanza si el
 * binario no se puede ejecutar (ENOENT), que es un fallo del test.
 */
export function runProcess(
  command: string,
  args: readonly string[],
  options: IRunProcessOptions = {},
): Promise<IProcessResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, [...args], {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      env: options.exactEnv ?? { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const decoder = new TextDecoder();
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += decoder.decode(chunk, { stream: true })));
    child.stderr?.on("data", (chunk) => (stderr += decoder.decode(chunk, { stream: true })));

    const timer: ReturnType<typeof setTimeout> = setTimeout(
      () => child.kill("SIGKILL"),
      options.timeoutMs ?? 120_000,
    );

    child.on("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? -1, stdout, stderr, output: stdout + stderr });
    });
  });
}
