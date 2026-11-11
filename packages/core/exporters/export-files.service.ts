/**
 * Shared preparation and atomic writing of export artifacts.
 * A prepared plan holds the exact content used by previews and every host's writer.
 * Building all plans before writing lets callers reject exporter failures without
 * replacing any previous output.
 */
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { buildArtifacts } from "../discovery/generation.pipeline.js";
import { collectionBasename } from "../discovery/output-paths.helper.js";
import { resolveProjectContext } from "../discovery/project-context.service.js";
import { selectExporters } from "./registry.js";
import { writeFileAtomic } from "../helpers/atomic-write.helper.js";
import type { IPreparedExport, IPreparedExportFile } from "../../contracts/interfaces/core/export-files.interface.js";
import type { PostmanCollection } from "../../contracts/interfaces/core/postman.interface.js";
import type { IProjectSnapshot } from "../../contracts/interfaces/core/session.interface.js";
import type { IExportResult } from "../exporters/result.js";
import type { ExportFormatId } from "../../contracts/interfaces/core/exporter.interface.js";
import type {
  IExportFilePreview,
  IExportPlan,
} from "../../contracts/interfaces/core/application-api.interface.js";
import type { IExporterDiagnostic } from "../../contracts/interfaces/core/exporter.interface.js";
import { EXPORT_FORMATS } from "../../contracts/constants/core/export-formats.constant.js";
import { OUTPUT_DIR_NAME } from "../../contracts/constants/core/postman.constant.js";

/** A preparation failure that presentation adapters can translate without parsing text. */
export class ExportPreparationError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "EXPORT_FAILED", message: string) {
    super(message);
    this.name = "ExportPreparationError";
  }
}

/** The minimum Postman artifact shape required by every writer. */
function isPostmanCollection(value: unknown): value is PostmanCollection {
  return typeof value === "object" && value !== null && "info" in value && "item" in value;
}

/**
 * The name of the file a format's primary artifact goes to.
 *
 * `postman` is a single JSON file; the others are folders of files,
 * and their primary artifact is the first file the exporter
 * declared.
 */
function extensionOf(format: ExportFormatId): string {
  switch (format) {
    case "curl": return "sh";
    case "bruno": return "bru";
    case "har": return "har";
    default: return "json";
  }
}

/**
 * The name of the file the format's primary artifact is written to.
 *
 * For Postman it is the **same name the CLI writes**: the CLI's
 * `generate` produces `<name>.postman_collection.json`, and the
 * export used to produce `<name>.json` — two files for the same
 * collection, one per face. Then the CLI's `check` could not see what
 * the app wrote, and the app's `check` could not see what the CLI
 * wrote.
 *
 * One name, both faces: the app's export writes the file the CLI
 * would write, and the readers (`check`, `validate`, `stats`) look
 * for the file that is actually there.
 */
function primaryFileName(snapshot: IProjectSnapshot, format: ExportFormatId): string {
  if (format !== "postman") {
    return `${baseName(snapshot)}.${extensionOf(format)}`;
  }
  const context = resolveProjectContext({ projectRoot: snapshot.projectRoot });
  const name = snapshot.results[0]?.config.name;
  return `${collectionBasename(context, name)}.json`;
}

/**
 * The format, or a clear error.
 *
 * `selectExporters` throws a plain `Error` for an unknown format,
 * which would reach the bridge as an unknown failure. A format that
 * does not exist is a bad argument, and it is said so.
 */
function asFormat(target: string): ExportFormatId {
  const format = EXPORT_FORMATS.find((item) => item === target.toLowerCase().trim());
  if (format === undefined) {
    throw new ExportPreparationError(
      "INVALID_INPUT",
      `Unknown export format: ${target}. The known ones are ${EXPORT_FORMATS.join(", ")}.`,
    );
  }
  return format;
}

/**
 * Resolves user destinations against the project being exported.
 *
 * An explicit directory takes precedence over the directory in outputPath;
 * outputPath still supplies the file name. Without either, use the project's
 * standard output directory. Both preview and write consume this resolution.
 */
export function resolveExportDestination(
  snapshot: IProjectSnapshot,
  outputDirectory?: string,
  outputPath?: string,
): { readonly directory: string; readonly outputPath?: string } {
  if (outputPath !== undefined &&
      (/[\\/]$/.test(outputPath) || basename(outputPath) === "." || basename(outputPath) === "..")) {
    throw new ExportPreparationError("INVALID_INPUT", "outputPath must name a file; use outputDirectory for a directory");
  }
  const requested = outputPath === undefined
    ? undefined
    : resolve(snapshot.projectRoot, outputPath);
  const directory = outputDirectory !== undefined
    ? resolve(snapshot.projectRoot, outputDirectory)
    : requested !== undefined
      ? dirname(requested)
      : resolve(snapshot.projectRoot, OUTPUT_DIR_NAME);
  return {
    directory,
    ...(requested !== undefined ? { outputPath: join(directory, basename(requested)) } : {}),
  };
}

/**
 * Builds the artifacts of one format and says where they would go.
 *
 * Nothing is written. The paths are absolute, so the caller can show
 * them and the user can see where the tool is about to write.
 */
export async function planExport(
  snapshot: IProjectSnapshot,
  target: string,
  outputDirectory?: string,
  outputPath?: string,
): Promise<IExportPlan> {
  const planned = await prepareExport(snapshot, target, outputDirectory, outputPath);
  return {
    files: planned.files.map(
      ({ path, change, bytes }): IExportFilePreview => ({ path, change, bytes }),
    ),
    outputPath: planned.outputPath,
    diagnostics: planned.diagnostics,
  };
}

/**
 * Builds the artifacts once, says what each file would change, and
 * **writes** them.
 *
 * The write is atomic: a file that is half-written is worse than no
 * file, because the user cannot tell which half is the truth.
 */
export async function writeExport(
  snapshot: IProjectSnapshot,
  target: string,
  outputDirectory?: string,
  outputPath?: string,
): Promise<{
  readonly outputPath: string;
  readonly bytes: number;
  readonly files: ReadonlyArray<string>;
}> {
  const written = await writeExportWithPlan(snapshot, target, outputDirectory, outputPath);
  return {
    outputPath: written.outputPath,
    bytes: written.bytes,
    files: written.files,
  };
}

/**
 * Writes the artifacts and tells what was written, **and** what would
 * have been written.
 *
 * The build happens **once**: a preview that built the artifacts
 * again could promise a file the write would not produce, and a
 * `sync` that builds them twice spends twice the time on the most
 * expensive step of the pipeline.
 */
export async function writeExportWithPlan(
  snapshot: IProjectSnapshot,
  target: string,
  outputDirectory?: string,
  outputPath?: string,
): Promise<{
  readonly outputPath: string;
  readonly bytes: number;
  readonly files: ReadonlyArray<string>;
  readonly plan: IExportPlan;
}> {
  return writePreparedExport(await prepareExport(snapshot, target, outputDirectory, outputPath));
}

/** Writes a previously prepared plan without rebuilding artifacts. */
export async function writePreparedExport(planned: IPreparedExport): Promise<{
  readonly outputPath: string;
  readonly bytes: number;
  readonly files: ReadonlyArray<string>;
  readonly plan: IExportPlan;
}> {
  let bytes = 0;
  const written: string[] = [];
  for (const file of planned.files) {
    await writeFileAtomic(file.path, file.content);
    written.push(file.path);
    bytes += file.bytes;
  }
  return {
    outputPath: planned.outputPath,
    bytes,
    files: written,
    plan: {
      files: planned.files.map(({ path, change, bytes: size }) => ({ path, change, bytes: size })),
      outputPath: planned.outputPath,
      diagnostics: planned.diagnostics,
    },
  };
}

/** Builds once, and says what each file would change. */
export async function prepareExport(
  snapshot: IProjectSnapshot,
  target: string,
  outputDirectory?: string,
  outputPath?: string,
): Promise<IPreparedExport> {
  const exporters = selectExporters([asFormat(target)]);
  const results: IExportResult[] = await buildArtifacts(snapshot, exporters);

  const diagnostics: IExporterDiagnostic[] = [];
  for (const result of results) {
    for (const diagnostic of result.diagnostics) {
      diagnostics.push(diagnostic);
    }
  }
  const errors = results.flatMap((result) =>
    result.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
  );
  if (errors.length > 0) {
    throw new ExportPreparationError(
      "EXPORT_FAILED",
      `The ${target} exporter could not produce its artifact: ${errors
        .map((diagnostic) => diagnostic.message)
        .join("; ")}`,
    );
  }

  if (exporters[0]?.id === "postman" && !isPostmanCollection(results[0]?.artifact)) {
    throw new ExportPreparationError("EXPORT_FAILED", "The Postman exporter did not produce a collection, so nothing was written");
  }

  const destination = resolveExportDestination(snapshot, outputDirectory, outputPath);
  if (destination.outputPath !== undefined &&
      results.reduce((count, result) => count + Math.max(1, result.files.length), 0) > 1) {
    throw new ExportPreparationError(
      "INVALID_INPUT",
      `The ${target} exporter produces multiple files; use outputDirectory instead of outputPath to preserve their layout`,
    );
  }
  const directory = destination.directory;
  const files: IPreparedExportFile[] = [];

  for (const result of results) {
    // An exporter whose artifact IS the primary output declares no
    // files: the writer puts that artifact in the output path the
    // caller chose.
    if (result.files.length === 0) {
      const path = destination.outputPath ?? join(directory, primaryFileName(snapshot, result.format));
      const content = JSON.stringify(result.artifact ?? {}, null, 2) + "\n";
      files.push(await describeFile(path, content));
      continue;
    }
    for (const artifact of result.files) {
      const path = destination.outputPath ?? join(directory, artifact.path);
      files.push(await describeFile(path, artifact.content));
    }
  }

  if (files.length === 0) {
    throw new ExportPreparationError("EXPORT_FAILED", `The ${target} exporter produced no files`);
  }
  return { format: exporters[0]!.id, artifact: results[0]?.artifact, files, outputPath: files[0]!.path, diagnostics };
}

/** What would happen to one file. */
async function describeFile(path: string, content: string): Promise<IPreparedExportFile> {
  const bytes = utf8Length(content);
  try {
    const previous = await readFile(path, "utf8");
    return {
      path,
      change: previous === content ? "UNCHANGED" : "UPDATE",
      bytes,
      content,
    };
  } catch (error) {
    const missing = typeof error === "object" && error !== null &&
      "code" in error && error.code === "ENOENT";
    // Read directly: avoid a blocking existence probe and its race with reading.
    return { path, change: missing ? "NEW" : "UPDATE", bytes, content };
  }
}

/** The name of the project's primary artifact. */
function baseName(snapshot: IProjectSnapshot): string {
  const configured = snapshot.results[0]?.config.name;
  const source =
    configured !== undefined && configured.trim() !== ""
      ? configured
      : (snapshot.projectRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? "postman");
  return source.replace(/[^\w.-]+/g, "-");
}

/**
 * The size of a text in bytes, once it is written as UTF-8.
 *
 * Not `content.length`: that counts characters, and a file with one
 * emoji in it is four bytes longer than it looks. The number is
 * shown to the user before writing, so it has to be the size the file
 * will really have.
 */
function utf8Length(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}
