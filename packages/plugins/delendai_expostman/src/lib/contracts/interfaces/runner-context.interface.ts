/**
 * Contexto de runtime que `runner.helper` necesita para invocar al CLI.
 *
 * El plugin corre dentro de un host delendai de vida larga, y ese
 * host ya tiene un `ctx.workspace` y un set de `options` validadas con
 * Zod. Lo que el runner necesita sale de ahí:
 *
 *   - `cwd`: el workspace del host o el `projectRoot` que pidió el
 *     agente. NO leer de `process.cwd()`: depende de desde dónde se
 *     arrancó el host y cambia entre dev y producción.
 *   - `env`: el subset del entorno que el CLI debe heredar. El host lo
 *     filtra (algunos clientes AI recortan `PATH` y similares); el
 *     plugin debe pasarlo explícitamente para que los tests no
 *     dependan del shell de quien corre la suite.
 *   - `bunBin`: ruta absoluta al binario `bun`. El host lo resuelve
 *     una vez al arrancar y lo inyecta; si el agente lo necesita
 *     también lo puede fijar vía `MCP_VERTEX_BUN_BIN` (lo lee el
 *     runner si `bunBin` no se le pasa).
 *
 * Cada campo es opcional: si falta, el runner cae a su default
 * documentado (el snapshot del boot en `process-snapshot.helper`,
 * `Bun.which("bun")` y `"bun"` como último fallback).
 *
 * Diseño:
 *   - Interfaz narrow, no clase. Cumple el §6 del universal: quien
 *     consume depende de la abstracción, no de quien la cumple.
 *   - Readonly para que nadie lo mute mientras un spawn está en vuelo.
 */
export interface IRunnerContext {
  /** Working dir de spawn. Default: el snapshot del cwd al boot. */
  readonly cwd?: string;
  /** Entorno a heredar para el subproceso. Default: el snapshot del env al boot. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Path absoluta al binario `bun`. Default: `MCP_VERTEX_BUN_BIN` → `Bun.which("bun")` → `command -v bun` → `"bun"`. */
  readonly bunBin?: string;
}
