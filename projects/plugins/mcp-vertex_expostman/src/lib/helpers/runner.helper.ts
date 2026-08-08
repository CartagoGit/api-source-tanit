/**
 * Helpers puros para ejecutar scripts del proyecto export-to-postman.
 *
 * Single Responsibility: abstraer `Bun.spawn` con timeout, captura
 * de stdout/stderr y parseo seguro de output. Sin estado global, sin
 * dependencias de filesystem fuera del path que se le pasa.
 */

import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter as pathDelimiter } from "node:path";
import { z } from "zod";

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
  /**
   * En **síncrono** con `stdout: "pipe"`, Bun devuelve los bytes ya
   * leídos, no un stream: `spawnSync` no puede devolver algo que haya
   * que consumir después. La declaración decía `ReadableStream` y los
   * dos usos lo esquivaban con `as unknown as Uint8Array`, que es el
   * casting tapando una declaración equivocada en vez de arreglarla.
   */
  stdout: Uint8Array | undefined;
  stderr: Uint8Array | undefined;
  success: boolean;
};
/** Lo que este helper necesita del global `Bun`, si existe. */
interface IBunGlobal {
  readonly spawnSync?: BunSpawnSync;
  readonly which?: (bin: string) => string | null;
}

/**
 * `Bun` a pelo es un identificador libre: fuera de Bun no es
 * `undefined`, es un **ReferenceError** en cuanto se evalúa el módulo.
 * Como esto estaba en el top level, importar el helper desde cualquier
 * runtime que no fuese Bun reventaba antes de llegar al fallback de
 * `node:child_process` — o sea, la rama "ejecución vía Node puro" que
 * el propio fichero documenta no se podía alcanzar nunca.
 *
 * Leerlo desde `globalThis` sí devuelve `undefined` y deja que el
 * fallback funcione. Es lo que permite que los tests del plugin corran
 * bajo vitest.
 */
const bunGlobal = (globalThis as { Bun?: IBunGlobal }).Bun;
const bunSpawnSync = bunGlobal?.spawnSync;
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
  const w = bunGlobal?.which?.("bun");
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
  options: {
    readonly cwd: string;
    readonly timeoutMs?: number;
    /**
     * Raíces donde el CLI puede escribir. El plugin las declara porque
     * aquí la ruta de salida la elige un agente, no la persona que está
     * delante.
     */
    readonly containRoots?: ReadonlyArray<string>;
  } = { cwd: process.cwd() },
): IRunScriptResult {
  const start = Date.now();
  const timeout = options.timeoutMs ?? 60_000;
  const bunBin = resolveBunBin();
  const cmd = [bunBin, ...args];
  const cwd = normalizeCwd(options.cwd);
  const raw = useBunSpawn
    ? runBunSpawnSyncArray([...cmd], cwd, timeout, process.env)
    : spawnSync(bunBin, [...args], {
        cwd,
        encoding: "utf8",
        timeout,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });

  return toRunResult(raw, start);
}

/** La forma cruda que devuelven los dos `spawnSync`. */
interface IRawSpawnResult {
  readonly error?: Error | undefined;
  readonly status: number | null;
  readonly stdout: string | Uint8Array | null;
  readonly stderr: string | Uint8Array | null;
}

/**
 * Normaliza la salida de cualquiera de los dos `spawnSync`.
 *
 * `Bun.spawnSync` y `child_process.spawnSync` devuelven formas
 * distintas (una trae `error`, la otra puede dar Buffer o `null` en los
 * streams), así que se unifican aquí y el resto del plugin lee una sola.
 *
 * El detalle que importa: cuando el proceso **no llega a arrancar**
 * (cwd inexistente, binario no encontrado) `stderr` no es `null`, es la
 * cadena vacía — y el `stderr ?? String(error)` que había aquí antes se
 * quedaba con el `""`, tirando el único mensaje que explicaba el fallo.
 * El consumidor recibía `ok: false` sin ningún `detail`, que es
 * exactamente lo peor: sabes que falló y no por qué.
 */
function toRunResult(raw: IRawSpawnResult, startedAt: number): IRunScriptResult {
  const stdout = decodeStream(raw.stdout);
  const stderr = decodeStream(raw.stderr);
  const durationMs = Date.now() - startedAt;

  if (raw.error) {
    return {
      ok: false,
      exitCode: raw.status ?? 1,
      stdout,
      // `||`, no `??`: el caso a cubrir es el string vacío.
      stderr: stderr || `${raw.error.name}: ${raw.error.message}`,
      durationMs,
    };
  }
  return { ok: raw.status === 0, exitCode: raw.status ?? 1, stdout, stderr, durationMs };
}

/** Buffer, string o nada → siempre string. */
function decodeStream(stream: string | Uint8Array | null | undefined): string {
  if (typeof stream === "string") return stream;
  if (stream instanceof Uint8Array) return new TextDecoder().decode(stream);
  return "";
}

/**
 * Ejecuta un script `.ts` con bun en modo síncrono, con timeout.
 * Devuelve `ok=false` si el proceso terminó con código != 0 o si
 * el timeout se agotó (exit 124).
 */
export function runBunScript(
  scriptPath: string,
  args: ReadonlyArray<string>,
  options: {
    readonly cwd: string;
    readonly timeoutMs?: number;
    /**
     * Raíces donde el CLI puede escribir. El plugin las declara porque
     * aquí la ruta de salida la elige un agente, no la persona que está
     * delante.
     */
    readonly containRoots?: ReadonlyArray<string>;
  } = { cwd: process.cwd() },
): IRunScriptResult {
  const start = Date.now();
  const timeout = options.timeoutMs ?? 60_000;
  const bunBin = resolveBunBin();
  const cmd = [bunBin, "run", scriptPath, ...args];
  const cwd = normalizeCwd(options.cwd);

  // El CLI lanzado a mano acepta `--output-dir` donde sea, y así debe
  // ser. A través del plugin no: un `../` en un argumento no puede
  // acabar escribiendo en el `$HOME` de nadie.
  //
  // Las raíces son varias porque una sola no describe el uso legítimo —
  // la salida puede ir con el proyecto que se escanea, dentro del
  // workspace, o en un temporal, y las tres son razonables. El temporal
  // entra a propósito: es donde va lo desechable, y dejarlo fuera
  // convertiría el guardián en un estorbo que alguien acabaría
  // quitando.
  const roots = [...(options.containRoots ?? []), cwd, tmpdir()];
  const env = { ...process.env, POSTMAN_CONTAIN_ROOT: roots.join(pathDelimiter) };

  const result = useBunSpawn
    ? runBunSpawnSyncArray(cmd, cwd, timeout, env)
    : spawnSync(cmd[0] ?? "bun", cmd.slice(1), {
        cwd,
        encoding: "utf8",
        timeout,
        stdio: ["ignore", "pipe", "pipe"],
        env,
      });
  return toRunResult(result, start);
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
  try {
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
      stdout: r.stdout ? new TextDecoder().decode(r.stdout) : "",
      stderr: r.stderr ? new TextDecoder().decode(r.stderr) : "",
    };
  } catch (err) {
    // Cwd inválido, binario no encontrado, o spawn bloqueado.
    // Devolvemos un resultado "fallido" en lugar de tirar la excepción,
    // para que el caller pueda reportarlo como un step con `ok=false`.
    const e = err as Error;
    return {
      error: e,
      status: null,
      stdout: "",
      stderr: `${e.name}: ${e.message}`,
    };
  }
}

/**
 * Forma del informe que emite `generate --json`.
 *
 * Se valida en vez de confiar: el CLI es otro paquete que se
 * actualiza por su cuenta, y un campo que desaparece tiene que dar un
 * error claro aquí y no un `undefined` que viaje hasta el agente.
 */
const GenerateReportSchema = z.object({
  version: z.number(),
  ok: z.boolean(),
  framework: z.string().nullable(),
  frameworks: z.array(z.string()),
  warnings: z.array(z.string()),
  projectRoot: z.string(),
  projectName: z.string(),
  collectionPath: z.string().nullable(),
  collectionId: z.string().nullable(),
  environmentPaths: z.array(z.string()),
  extraPaths: z.array(z.string()),
  requests: z.number(),
  folders: z.number(),
  auth: z
    .object({ loginEndpoint: z.string(), tokenVariable: z.string() })
    .nullable(),
  durationMs: z.number(),
});

/** Informe de `generate --json`, ya validado. */
export type IGenerateReport = z.infer<typeof GenerateReportSchema>;

/**
 * Versión del contrato que este plugin sabe leer.
 *
 * Tiene que ir a la par de `GENERATE_REPORT_VERSION` en
 * `contracts/generate-report.interface.ts`. Un test lo comprueba: si
 * alguien sube una y no la otra, el plugin deja de leer al CLI y hay
 * que enterarse en el gate, no en producción.
 */
export const SUPPORTED_REPORT_VERSION = 3;

/**
 * Lee el informe de `generate --json` desde el stdout del CLI.
 *
 * Antes de esto el plugin sacaba las rutas con expresiones regulares
 * sobre el texto para personas (`/Colecci[oó]n escrita en (.+)/`). Se
 * rompió sin hacer ruido en cuanto el CLI se tradujo al inglés: el tool
 * seguía devolviendo `ok: true` con `collectionPath: "<no detectado>"` y
 * `requests: 0`, o sea un éxito que no lo era. Ahora el CLI emite un
 * documento JSON versionado por stdout (la traza legible se va a
 * stderr) y aquí solo queda parsearlo y validarlo.
 */
export function readGenerateReport(
  stdout: string,
): { ok: true; report: IGenerateReport } | { ok: false; detail: string } {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { ok: false, detail: "el CLI no ha escrito nada en stdout" };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      detail:
        "stdout no es JSON — ¿se ha lanzado `generate` sin `--json`? " +
        `Primeros 200 caracteres: ${trimmed.slice(0, 200)}`,
    };
  }

  const parsed = GenerateReportSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      detail: `el informe del CLI no encaja con el contrato: ${parsed.error.message}`,
    };
  }
  if (parsed.data.version !== SUPPORTED_REPORT_VERSION) {
    return {
      ok: false,
      detail:
        `el CLI emite la versión ${parsed.data.version} del informe y este ` +
        `plugin lee la ${SUPPORTED_REPORT_VERSION}. Actualiza el plugin.`,
    };
  }
  return { ok: true, report: parsed.data };
}
