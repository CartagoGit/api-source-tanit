/**
 * Informe legible por máquina de una generación (`generate --json`).
 *
 * Existe porque el plugin de delendai necesitaba saber qué ficheros se
 * habían escrito y cuántos endpoints había, y lo sacaba con expresiones
 * regulares sobre el texto que el CLI imprime para personas. Eso se
 * rompió en silencio en cuanto el CLI se tradujo al inglés: el plugin
 * seguía buscando "Colección escrita en" y devolvía `collectionPath:
 * null` sin dar ningún error.
 *
 * Con `--json` el contrato es explícito y versionado, y el texto para
 * personas puede cambiar de idioma, de formato o de orden sin romper a
 * nadie. En ese modo la salida legible se va a **stderr** y `stdout`
 * contiene exactamente un documento JSON.
 *
 * @example
 * ```sh
 * apisrc generate --project-root ./mi-api --json | jq .collectionPath
 * ```
 */

/**
 * Versión del contrato. Sube al cambiar la forma de manera incompatible.
 *
 * v2: añade `frameworks` y `warnings` (proyectos híbridos).
 */
export const GENERATE_REPORT_VERSION = 3;

/** Lo que el flujo de login detectado dejó montado en la colección. */
export interface IGenerateReportAuth {
  /** El endpoint de login, como `POST /auth/login`. */
  readonly loginEndpoint: string;
  /** Variable de entorno donde se guarda el token capturado. */
  readonly tokenVariable: string;
}

/** Resultado de `generate --json`. */
export interface IGenerateReport {
  readonly version: number;
  /** `false` si la generación terminó con un código distinto de 0. */
  readonly ok: boolean;
  /** Framework detectado, o `null` si no se reconoció ninguno. */
  readonly framework: string | null;
  /**
   * Todos los frameworks que reconocieron el proyecto.
   *
   * Más de uno significa proyecto híbrido: se han escaneado todos y se
   * han fusionado sus endpoints.
   */
  readonly frameworks: ReadonlyArray<string>;
  /**
   * Avisos para quien lo ejecuta. No son errores — la colección existe
   * igual —, son las cosas que de no decirse dejan a alguien con una
   * colección incompleta sin saberlo.
   */
  readonly warnings: ReadonlyArray<string>;
  /** Raíz del proyecto escaneado, absoluta. */
  readonly projectRoot: string;
  /** Nombre del proyecto tal como aparece en la colección. */
  readonly projectName: string;
  /** Ruta de la colección escrita. `null` en `--inspect`. */
  readonly collectionPath: string | null;
  /** `_postman_id` de la colección: es lo que la identifica al reimportar. */
  readonly collectionId: string | null;
  readonly environmentPaths: readonly string[];
  /**
   * Ficheros escritos en formatos distintos de Postman.
   *
   * Vacío cuando no se pidió ninguno. Van aparte de `environmentPaths`
   * porque no son environments: son la misma API en otro idioma
   * (OpenAPI, Insomnia, Bruno, HAR, cURL).
   */
  readonly extraPaths: readonly string[];
  readonly requests: number;
  readonly folders: number;
  /** `null` si el proyecto no tiene endpoint de login. */
  readonly auth: IGenerateReportAuth | null;
  readonly durationMs: number;
}
