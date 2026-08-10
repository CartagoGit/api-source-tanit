/**
 * Los valores fijos que el plugin comparte consigo mismo.
 */

/**
 * Versión del contrato que este plugin sabe leer.
 *
 * Tiene que ir a la par de `GENERATE_REPORT_VERSION` en
 * `contracts/generate-report.interface.ts`. Un test lo comprueba: si
 * alguien sube una y no la otra, el plugin deja de leer al CLI y hay
 * que enterarse en el gate, no en producción.
 */
export const SUPPORTED_REPORT_VERSION = 3;
