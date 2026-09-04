/**
 * Package-wide constants (project-agnostic).
 *
 * Everything project-specific (variables, folders, prefixes, auth
 * descriptions) lives in `examples/<project>/config.ts` and is
 * injected via `ProjectConfig`.
 */

/** URL of the Postman v2.1.0 schema. */
/**
 * The schema URL that declares the format's version.
 *
 * Postman uses it to decide how to read the file on import; a
 * collection without it, or with a different version, is interpreted
 * differently.
 */
export const POSTMAN_SCHEMA_URL =
  "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

/** Tag appended to the names of auto-generated variants. */
export const VARIANT_TAG = " (auto · FormRequest)";

/**
 * Folder where the artefacts are written, inside the scanned project.
 *
 * It used to be `build/`, which was dangerous: `build/` is the default
 * output of Gradle, of Maven under certain configurations, of many
 * Go projects, and of half the Makefiles in the world. Writing there
 * mixed the collections with the user's build artefacts, in a folder
 * their `clean` wipes whole.
 *
 * `tanit/` is the project name (Tanit — API Source Discovery):
 * brand-first, short, no collision with `build/` or `dist/` from the
 * frameworks the tool scans.
 *
 * Overridden by `--output-dir` or `POSTMAN_OUTPUT_DIR`.
 */
export const OUTPUT_DIR_NAME = "tanit";

/**
 * HTTP methods that the collection emits.
 *
 * This is the SAME list as `EndpointSpec["method"]` type, and exists so
 * it can be iterated at runtime. The adapter uses it to filter: when
 * it was hardcoded, adding a method to the type did nothing and the
 * `HEAD` requests that scanners did detect silently disappeared.
 *
 * `TRACE` was added in a00012 S3.c because the OpenAPI scanner
 * recognized it (`paths./y.trace`) but the adapter filtered it; the
 * other frameworks do not emit it, so the entry only materializes
 * when the spec brings one.
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
 * Name of the executable that is distributed.
 *
 * Same as the `bin` in `package.json` and the one typed at the
 * terminal. It used to be hard-coded in the build script and stayed
 * as `postman-from-routes` — the old name — when the product
 * rebranded: release artefacts came out with a name that did not
 * exist anywhere else in the project.
 */
export const BIN_NAME = "apisrc" as const;
