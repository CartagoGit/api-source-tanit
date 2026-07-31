/**
 * Helpers puros para ejecutar scripts del proyecto postman-exporter.
 *
 * Single Responsibility: abstraer `Bun.spawn` con timeout, captura
 * de stdout/stderr y parseo seguro de output. Sin estado global, sin
 * dependencias de filesystem fuera del path que se le pasa.
 */

import { spawnSync } from "node:child_process";

/** Resultado de ejecutar un script via bun. */
export interface IRunScriptResult {
  readonly ok: boolean;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

/**
 * Ejecuta un script `.ts` con bun en modo síncrono, con timeout.
 * Devuelve `ok=false` si el proceso terminó con código != 0 o si
 * el timeout se agotó (exit 124).
 */
export function runBunScript(
  scriptPath: string,
  args: ReadonlyArray<string>,
  options: { readonly cwd: string; readonly timeoutMs?: number } = {
    cwd: process.cwd(),
  },
): IRunScriptResult {
  const start = Date.now();
  const timeout = options.timeoutMs ?? 60_000;
  const result = spawnSync("bun", ["run", scriptPath, ...args], {
    cwd: options.cwd,
    encoding: "utf8",
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    return {
      ok: false,
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? String(result.error),
      durationMs: Date.now() - start,
    };
  }
  return {
    ok: result.status === 0,
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    durationMs: Date.now() - start,
  };
}

/**
 * Parsea la salida de `bun run scripts/generate.script.ts` para
 * extraer rutas de artefactos generados. Tolerante a cambios de formato.
 */
export function parseGenerateOutput(stdout: string): {
  readonly collectionPath: string | null;
  readonly environmentPaths: ReadonlyArray<string>;
} {
  const collectionMatch = stdout.match(
    /Colecci[oó]n escrita en (.+\.postman_collection\.json)/,
  );
  const collectionPath = collectionMatch?.[1] ?? null;

  const envPaths: string[] = [];
  const envRe = /Environment "[^"]+"\s*→\s*(.+\.postman_environment\.json)/g;
  let m: RegExpExecArray | null;
  while ((m = envRe.exec(stdout)) !== null) {
    if (m[1]) envPaths.push(m[1]);
  }

  return {
    collectionPath,
    environmentPaths: envPaths,
  };
}

/** Parsea el conteo final "X requests en Y carpetas (Z KB)". */
export function parseRequestCount(
  stdout: string,
): { readonly requests: number; readonly folders: number } | null {
  const m = stdout.match(/(\d+)\s+requests en\s+(\d+)\s+carpetas/);
  if (!m) return null;
  return { requests: Number(m[1]), folders: Number(m[2]) };
}
