/**
 * Helpers puros para ejecutar scripts del proyecto postman-exporter.
 *
 * Single Responsibility: abstraer `Bun.spawn` con timeout, captura
 * de stdout/stderr y parseo seguro de output. Sin estado global, sin
 * dependencias de filesystem fuera del path que se le pasa.
 */

import { spawnSync } from "node:child_process";

// `Bun.spawnSync` evita el `posix_spawn 'bun' ENOENT` que se
// reproduce cuando el host MCP arranca el plugin bajo Bun y el
// helper usa `node:child_process.spawnSync` (un nivel de indirección
// que rompe la herencia del bun executable). El plugin asume runtime
// Bun (lo exige `engines.bun` en su package.json).
type BunSpawnSync = (opts: {
  cmd: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: "inherit" | "ignore" | "pipe";
  stdout?: "inherit" | "pipe";
  stderr?: "pipe";
  timeout?: number;
}) => {
  exitCode: number;
  stdout: ReadableStream<Uint8Array> | undefined;
  stderr: ReadableStream<Uint8Array> | undefined;
  success: boolean;
};
const bunSpawnSync = (Bun as { spawnSync?: BunSpawnSync }).spawnSync;
const useBunSpawn = typeof bunSpawnSync === "function";

/** Resultado de ejecutar un script via bun. */
export interface IRunScriptResult {
  readonly ok: boolean;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

/**
 * Resuelve la path absoluta del binario `bun`. En el host el plugin
 * corre dentro de un proceso Bun (no Node), pero el helper usa
 * `node:child_process.spawnSync` para mantener el sync; resolvemos
 * la path absoluta una vez para sobrevivir a `env` recortadas por
 * hosts AI (algunos clientes MCP filtran `PATH` antes de spawn).
 */
function resolveBunBin(): string {
  // 1) Variable de entorno explícita (operador puede forzarla).
  const fromEnv = process.env["MCP_VERTEX_BUN_BIN"];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  // 2) `Bun.which` (disponible en runtime Bun).
  const w = (Bun as { which?: (bin: string) => string | null }).which?.("bun");
  if (typeof w === "string" && w.length > 0) return w;
  // 3) `which` por stdlib (cubre ejecución vía Node puro).
  try {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const out = execSync("command -v bun", { encoding: "utf8" }).trim();
    if (out.length > 0) return out;
  } catch {
    // ignore — caemos al fallback
  }
  // 4) Fallback: dejar que spawnSync intente resolver del PATH.
  return "bun";
}

/**
 * Normaliza un cwd para spawnSync. Acepta:
 *   - paths absolutos (`/foo/bar`)
 *   - URLs file:// (`file:///foo/bar/`)
 *   - `process.cwd()` cuando se pasa un string vacío o "."
 *
 * `Bun.spawnSync` con `cwd: "file:///..."` falla con ENOENT porque no
 * entiende el prefijo — necesitamos un path real del FS.
 */
export function normalizeCwd(cwd: string | undefined): string {
  if (!cwd || cwd === "." || cwd === "./") return process.cwd();
  if (cwd.startsWith("file://")) {
    try {
      return new URL(cwd).pathname;
    } catch {
      return cwd;
    }
  }
  return cwd;
}

/**
 * Ejecuta `bun <args...>` directo desde un cwd, con timeout.
 * Útil para sub-comandos (`bun test <file>`, `bun run <script>`) que NO
 * son un script .ts específico.
 *
 * Devuelve `ok=false` si el proceso terminó con código != 0 o si el
 * timeout se agotó.
 */
export function runBunCommand(
  args: ReadonlyArray<string>,
  options: { readonly cwd: string; readonly timeoutMs?: number } = {
    cwd: process.cwd(),
  },
): IRunScriptResult {
  const start = Date.now();
  const timeout = options.timeoutMs ?? 60_000;
  const bunBin = resolveBunBin();
  const cmd = [bunBin, ...args];
  const cwd = normalizeCwd(options.cwd);
  const result = useBunSpawn
    ? runBunSpawnSyncArray(cmd, cwd, timeout, process.env)
    : spawnSync(bunBin, args, {
        cwd,
        encoding: "utf8",
        timeout,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
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
  const bunBin = resolveBunBin();
  const cmd = [bunBin, "run", scriptPath, ...args];
  const cwd = normalizeCwd(options.cwd);
  const result = useBunSpawn
    ? runBunSpawnSyncArray(cmd, cwd, timeout, process.env)
    : spawnSync(cmd[0] ?? "bun", cmd.slice(1), {
        cwd,
        encoding: "utf8",
        timeout,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
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

function runBunSpawnSyncArray(
  cmd: string[],
  cwd: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv | undefined,
): {
  error?: Error;
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const envRecord: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env ?? {})) {
    envRecord[k] = v;
  }
  const r = bunSpawnSync!({
    cmd,
    cwd,
    env: envRecord,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
  });
  return {
    status: r.exitCode,
    stdout: r.stdout ? new TextDecoder().decode(r.stdout as unknown as Uint8Array) : "",
    stderr: r.stderr ? new TextDecoder().decode(r.stderr as unknown as Uint8Array) : "",
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
