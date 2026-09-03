/**
 * Constantes universales del paquete (agnósticas del proyecto).
 *
 * Todo lo específico de un proyecto (variables, zonas, prefijos,
 * descripciones de auth) vive en `examples/<proyecto>/config.ts` y
 * se inyecta vía `ProjectConfig`.
 */

/** URL del schema Postman v2.1.0. */
/**
 * La URL del esquema que declara la versión del formato.
 *
 * Postman la usa para decidir cómo leer el fichero al importarlo; una
 * colección sin ella o con otra versión se interpreta distinto.
 */
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

/**
 * Métodos HTTP que se emiten a la colección.
 *
 * Es la MISMA lista que el tipo `EndpointSpec["method"]`, y existe para
 * poder recorrerla en tiempo de ejecución. El adapter la usa para
 * filtrar: tenerla escrita a mano allí hacía que añadir un método al
 * tipo no sirviera de nada, y los `HEAD` que los scanners sí detectaban
 * desaparecían en silencio.
 *
 * `TRACE` se añadió en a00012 S3.c porque el scanner de OpenAPI lo
 * reconocía (`paths./y.trace`) pero el adapter lo filtraba; los demás
 * frameworks no lo emiten, así que la entrada solo se materializa
 * cuando el spec lo trae.
 */
export const SUPPORTED_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "TRACE",
] as const;


/**
 * Nombre del ejecutable que se distribuye.
 *
 * Es el mismo que el `bin` del `package.json` y el que se escribe en la
 * terminal. Estaba escrito a mano en el script de compilación, y se
 * quedó en `postman-from-routes` —el nombre viejo— cuando el producto
 * pasó a llamarse así: los binarios de las releases salían con un nombre
 * que no existe en ninguna otra parte del proyecto.
 */
export const BIN_NAME = "expostman" as const;
