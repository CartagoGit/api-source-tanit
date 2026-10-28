/**
 * Identifiers of every exporter in the universal export pipeline.
 *
 * The catalog is deliberately separate from the registry that fulfils it:
 * consumers that only need to validate a format must not import the
 * exporter implementations (and their serializers) to do it.
 */
import { EXPORT_FORMATS } from "./export-formats.constant.js";

/** Every format that can be selected for an export run. */
export const EXPORTER_IDS = EXPORT_FORMATS;

/** The exhaustive union of exporter identifiers. */
export type ExporterId = (typeof EXPORTER_IDS)[number];
