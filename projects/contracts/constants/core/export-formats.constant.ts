/**
 * Los formatos a los que se puede exportar una API.
 *
 * Mismo caso que `FRAMEWORK_IDS`, y por el mismo motivo: la lista se
 * derivaba de `TARGETS` dentro de `export-registry.service`, así que
 * leer seis nombres obligaba a importar los cinco exportadores —OpenAPI,
 * Insomnia, Bruno, HAR y cURL— con sus serializadores detrás. El plugin
 * MCP lo hacía solo para declarar un `z.enum`.
 *
 * El catálogo es **dato**; el registro es quien lo cumple. Un test
 * compara las dos listas y falla si sobra o falta una, que es lo único
 * que hace segura una lista paralela.
 *
 * ## Por qué `postman` va aparte
 *
 * Porque no lo produce un exportador: lo construye el pipeline con
 * `buildCollection`, que hace bastante más que serializar —flujo de
 * auth, aserciones, identidad de la colección—. Se nombra igualmente
 * para que `--format postman,openapi` funcione y para que el CLI no lo
 * trate como un formato desconocido.
 */

/**
 * El formato por defecto, y el único que no se puede quitar.
 *
 * No sale de un exportador; lo produce el pipeline.
 */
export const DEFAULT_EXPORT_FORMAT = "postman";

/** Los formatos que produce un exportador del registro. */
export const EXPORTER_FORMATS = [
  "openapi",
  "insomnia",
  "bruno",
  "har",
  "curl",
] as const;

/** Todos los formatos válidos, con `postman` a la cabeza. */
export const EXPORT_FORMATS = [
  DEFAULT_EXPORT_FORMAT,
  ...EXPORTER_FORMATS,
] as const;

/** Un formato de salida conocido. */
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
