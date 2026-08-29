/**
 * Dónde vive el CLI que este plugin ejecuta.
 *
 * El plugin no importa el CLI: lo **spawnea**, así que lo único que
 * comparten es una ruta escrita a mano. Y una ruta escrita a mano se
 * queda vieja sin decir nada.
 *
 * Pasó: al reorganizar en `packages/`, el CLI se movió de
 * `scripts/` a `packages/cli/`, y esta cadena se quedó en tres sitios
 * (los dos tools y `mcp-vertex.config.json`) apuntando a un fichero
 * inexistente. Nada falló en los gates —
 * `runBunScript` devuelve `ok: false` con "module not found", y eso solo
 * se ve ejecutando el tool de verdad contra el host. O sea: los dos
 * tools que escriben artefactos llevaban commits rotos y los tests
 * seguían verdes, porque ninguno llegaba a spawnear nada.
 *
 * Ahora la ruta está una vez y `cli-path.constant.spec.ts` comprueba que
 * el fichero existe. Mover el CLI otra vez rompe un gate en vez de
 * romper a quien use el plugin.
 */

/**
 * Ruta del entrypoint del CLI, relativa a la raíz del workspace.
 *
 * Separadores `/` a propósito: se compone con `${workspaceRoot}/…` y
 * tanto Bun como Node los aceptan también en Windows.
 */
export const CLI_SCRIPT_RELATIVE = "packages/cli/cli.script.ts" as const;

/**
 * El entrypoint del CLI para un workspace concreto.
 *
 * `override` es la opción `cliScript` de `mcp-vertex.config.json`: quien
 * tenga el paquete instalado en otro sitio puede decirlo. Sin ella, se
 * asume que el workspace ES el repositorio de export-to-postman.
 */
export function resolveCliScript(
  workspaceRoot: string,
  override?: string | undefined,
): string {
  if (override && override.length > 0) return override;
  return `${workspaceRoot}/${CLI_SCRIPT_RELATIVE}`;
}
