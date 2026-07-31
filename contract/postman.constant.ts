/**
 * Constantes universales del paquete (agnósticas del proyecto).
 *
 * Todo lo específico de un proyecto (variables, zonas, prefijos,
 * descripciones de auth) vive en `examples/<proyecto>/config.ts` y
 * se inyecta vía `ProjectConfig`.
 */

/** URL del schema Postman v2.1.0. */
export const POSTMAN_SCHEMA_URL =
  "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

/** Tag que se añade al nombre de las variantes auto-generadas. */
export const VARIANT_TAG = " (auto · FormRequest)";