/**
 * Snapshot inmutable del `process.env` y `process.cwd()` capturados al
 * boot del plugin.
 *
 * El universal §6 dice "Async I/O only in hot paths; `*Sync` is boot-time
 * only" — la captura de un snapshot del entorno del proceso **es**
 * boot-time: se hace una vez al cargar el módulo, no en cada tool
 * call. El resultado es `readonly`, así que nadie puede mutarlo
 * mientras un spawn está en vuelo.
 *
 * Por qué existe:
 *   - `runner.helper` necesita el `env` y `bunBin` para invocar al CLI.
 *   - `IMcpPluginContext` no expone `env` directamente (lo deja al
 *     plugin decidir).
 *   - `lint:tools` (universal §6, mirrored por `lint-tool-no-process`)
 *     prohíbe leer `process.env` desde tools y helpers.
 *
 * La solución es: leer **una vez** aquí, exponer el snapshot como
 * constantes, y dejar que el resto del plugin las consuma. Eso
 * cumple el universal §6 sin obligar al host a inyectar un env
 * arbitrario.
 */

/** Snapshot del entorno capturado al cargar el módulo. */
export const ENV_SNAPSHOT: Readonly<Record<string, string | undefined>> =
  Object.freeze({ ...process.env });

/** Snapshot del cwd capturado al cargar el módulo. */
export const CWD_SNAPSHOT: string = process.cwd();

/**
 * Snapshot del binario `bun`, con la cascada documentada:
 *   1. `MCP_VERTEX_BUN_BIN` del entorno capturado (operador forzado).
 *   2. `undefined` para que `runner.helper` aplique su propio fallback
 *      (Bun.which / command -v / "bun").
 *
 * El helper `Bun.which("bun")` no entra en el snapshot porque sólo
 * está disponible en runtime Bun y se consulta en cada spawn (es
 * barato, y si el host cambia de binario a mitad de sesión lo
 * respeta).
 */
export const BUN_BIN_SNAPSHOT: string | undefined = (() => {
  const fromEnv = ENV_SNAPSHOT["MCP_VERTEX_BUN_BIN"];
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  return undefined;
})();
