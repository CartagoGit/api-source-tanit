/**
 * Contexto del proyecto que se está escaneando.
 *
 * Sustituye a la resolución implícita por el singleton retirado de
 * `paths.service` (r00010 S2, 2026-09-03), que se calculaba **una vez
 * por proceso** desde `POSTMAN_PROJECT_ROOT` o `--project-root`. Eso
 * valía para el CLI —un proceso por proyecto— pero:
 *
 *   - Un consumidor de vida larga (el servidor MCP) que analizase el
 *     proyecto A y luego el B recibía las rutas de A.
 *   - Obligaba a los tests a manosear `process.env` y a resetear la
 *     caché a mano antes de cada llamada.
 *   - Escondía la dependencia: `LaravelFormRequestValidationProvider`
 *     recibía `match.projectRoot` y aun así leía el singleton, con lo
 *     que sin la variable de entorno no resolvía ni un FormRequest.
 *
 * Pasar el contexto explícito hace la dependencia visible en la firma y
 * el código reentrante sin trucos.
 */

/** Rutas resueltas de un proyecto host. */
export interface IProjectContext {
  /** Raíz absoluta del proyecto escaneado. */
  readonly projectRoot: string;
  /** Raíz absoluta del paquete export-to-postman. */
  readonly packageRoot: string;
  /** Nombre corto del proyecto, para nombrar los artefactos. */
  readonly projectBasename: string;
  /** Directorio donde se escriben los artefactos. */
  readonly outputDir: string;
}

/** Subdirectorios convencionales, derivados de la raíz. */
export interface IProjectDirs {
  /**
   * `<raíz>/routes` — solo lo usa el descubrimiento heredado de
   * Laravel. Un scanner moderno recibe el `projectRoot` y busca lo
   * suyo; estos tres campos desaparecen cuando se retire ese camino.
   */
  readonly routes: string;
  /** `<raíz>/app` — ídem, solo para el camino heredado. */
  readonly app: string;
  /** `<raíz>/app/Http/Requests` — ídem, solo para el camino heredado. */
  readonly requests: string;
}
