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

/**
 * Carpeta donde se escriben los artefactos, dentro del proyecto que se
 * escanea.
 *
 * Antes era `build/`, y eso hacía daño: `build/` es la salida por
 * defecto de Gradle, de Maven con ciertas configuraciones, de muchos
 * proyectos de Go y de la mitad de los Makefile del mundo. Escribir ahí
 * mezcla las colecciones con los artefactos de compilación de quien usa
 * la herramienta, en una carpeta que su `clean` borra entera.
 *
 * `export-to-postman/` es el nombre del proyecto: nadie tiene una
 * carpeta así, y si la tiene, es la nuestra.
 *
 * Se sobrescribe con `--output-dir` o `POSTMAN_OUTPUT_DIR`.
 */
export const OUTPUT_DIR_NAME = "export-to-postman";

