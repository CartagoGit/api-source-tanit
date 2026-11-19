/**
 * Formats that an API can be exported to.
 *
 * Same case as `FRAMEWORK_IDS`, and for the same reason: the list was
 * derived from `TARGETS` inside `export-registry.service`, so reading
 * six names meant importing the five exporters — OpenAPI, Insomnia,
 * Bruno, HAR, cURL — with their serializers behind. The MCP plugin
 * did that just to declare a `z.enum`.
 *
 * The catalog is **data**; the registry is what fulfills it. A test
 * compares the two lists and fails on a missing or extra name,
 * which is what makes a parallel list safe.
 *
 * ## Why `postman` is separate
 *
 * Because no exporter produces it: the pipeline builds it with
 * `buildCollection`, which does much more than serialize — auth flow,
 * assertions, collection identity. It is named the same way so
 * `--format postman,openapi` works and so the CLI does not treat it
 * as an unknown format.
 */

/**
 * The default format, and the only one that cannot be removed.
 *
 * Not produced by an exporter; the pipeline emits it.
 */
export const DEFAULT_EXPORT_FORMAT = "postman";

/** Formats produced by a registered exporter. */
export const EXPORTER_FORMATS = [
  "openapi",
  "insomnia",
  "bruno",
  "har",
  "curl",
] as const;

/** Every valid format, with `postman` first. */
export const EXPORT_FORMATS = [
  DEFAULT_EXPORT_FORMAT,
  ...EXPORTER_FORMATS,
] as const;

/** A known output format. */
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
