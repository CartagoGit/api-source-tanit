/**
 * The catalog of output formats.
 *
 * A new format is added here and shows up on its own in `--format`, in
 * the CLI help, and in error messages. Same rule as with scanners:
 * **no parallel lists**. A handwritten `enum` of formats goes stale the
 * day the sixth is added, and would reject as invalid something that
 * actually exists.
 */
import type {
  IExportArtifact,
  IExportInput,
  IExportTarget,
} from "../../contracts/interfaces/core/export-target.interface.js";
import { BrunoExporter } from "./bruno.exporter.js";
import { CurlExporter, HarExporter } from "./har.exporter.js";
import { InsomniaExporter } from "./insomnia.exporter.js";
import { OpenApiExporter } from "./openapi.exporter.js";
import type { IParsedFormats } from "../../contracts/interfaces/core/domain.interface.js";
import { DEFAULT_EXPORT_FORMAT } from "../../contracts/constants/core/export-formats.constant.js";

/**
 * The default format.
 *
 * It comes from the contracts catalog, not from here: reading the list
 * of names cannot cost loading the five exporters.
 */
const DEFAULT_FORMAT = DEFAULT_EXPORT_FORMAT;

const TARGETS: ReadonlyArray<IExportTarget> = [
  new OpenApiExporter(),
  new InsomniaExporter(),
  new BrunoExporter(),
  new HarExporter(),
  new CurlExporter(),
];

/**
 * The formats this registry actually produces.
 *
 * It is not the catalog — the catalog is `EXPORT_FORMATS`, in
 * contracts — but **what the registry delivers**. A test compares the
 * two: a parallel list is not dangerous, an uncompared parallel list
 * is.
 */
export function registeredFormats(): string[] {
  return [DEFAULT_FORMAT, ...TARGETS.map((t) => t.format)];
}

/** One line per format, for the help. */
export function describeFormats(): Array<{ format: string; summary: string }> {
  return [
    { format: DEFAULT_FORMAT, summary: "Postman v2.1.0 (default)" },
    ...TARGETS.map((t) => ({ format: t.format, summary: t.summary })),
  ];
}

/** The exporter for a format, or `null` if `postman`/unknown. */
export function exporterFor(format: string): IExportTarget | null {
  return TARGETS.find((t) => t.format === format.toLowerCase().trim()) ?? null;
}

/**
 * Interprets `--format a,b,c`.
 *
 * It fails **before** scanning if any format does not exist, and lists
 * the valid ones. Discovering a misspelled name at the end — after
 * walking the project and without having written the requested file
 * — says nothing about what happened. It is the same decision as in
 * `--framework`.
 */
export function parseFormats(raw: string | null | undefined): IParsedFormats {
  if (!raw || !raw.trim()) return { ok: true, formats: [DEFAULT_FORMAT] };

  const requested = raw
    .split(",")
    .map((f) => f.trim().toLowerCase())
    .filter(Boolean);
  const valid = registeredFormats();
  const invalid = requested.filter((f) => !valid.includes(f));
  if (invalid.length > 0) return { ok: false, invalid, valid };

  // Duplicates are removed preserving the order requested by the caller.
  return { ok: true, formats: [...new Set(requested)] };
}

/**
 * Serializes the project to all requested formats.
 *
 * `postman` is skipped: the pipeline writes it on its own.
 */
export function exportTo(
  formats: ReadonlyArray<string>,
  input: IExportInput,
): IExportArtifact[] {
  const out: IExportArtifact[] = [];
  for (const format of formats) {
    const target = exporterFor(format);
    if (!target) continue;
    out.push(...target.serialize(input));
  }
  return out;
}

/**
 * What the requested formats **cannot** represent.
 *
 * Returned separately from the artifacts because it does not prevent
 * generating them: the file comes out the same, just incomplete, and
 * whoever requested it must know.
 */
export function exportWarnings(
  formats: ReadonlyArray<string>,
  input: IExportInput,
): string[] {
  const out: string[] = [];
  for (const format of formats) {
    const target = exporterFor(format);
    out.push(...(target?.warnings?.(input) ?? []));
  }
  return out;
}
