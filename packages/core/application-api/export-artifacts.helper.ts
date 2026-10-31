/**
 * Turning a snapshot into files on disk.
 *
 * ## Why this file exists
 *
 * The `export` handler used to answer `{ outputPath, bytes: 0 }`:
 * it computed the path the file *would* go to and wrote nothing.
 * The comment said it was a synthetic payload to keep the API
 * surface stable. It did keep the surface stable, and it also kept
 * the app from ever exporting anything — the Export Center drew a
 * beautiful preview of a file that was never written.
 *
 * The building blocks were already there: `selectExporters()` picks
 * the exporters for a format, `buildArtifacts()` runs them over a
 * snapshot, and `writeFileAtomic()` writes without leaving a file
 * half-written. What was missing was the glue, and this is it.
 *
 * ## The two things a caller can ask for
 *
 *   · **Preview** — what would be written, and would it change
 *     anything that is already there. Nothing is written.
 *   · **Write** — the same files, written.
 *
 * Both go through the same build, so the preview cannot promise
 * something the write does not do. The artifacts are built **once**:
 * a preview that built them again could promise a file the write
 * would not produce.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { buildArtifacts } from "../discovery/generation.pipeline.js";
import { selectExporters } from "../exporters/registry.js";
import { writeFileAtomic } from "../helpers/atomic-write.helper.js";
import { apiError } from "./error.js";
import type { IProjectSnapshot } from "../../contracts/interfaces/core/session.interface.js";
import type { IExportResult } from "../exporters/result.js";
import type { ExportFormatId } from "../../contracts/interfaces/core/exporter.interface.js";
import type {
  ExportChange,
  IExportFilePreview,
  IExportPlan,
} from "../../contracts/interfaces/core/application-api.interface.js";
import { EXPORT_FORMATS } from "../../contracts/constants/core/export-formats.constant.js";

/** One file, with what would be written in it. */
interface IPlannedFile {
  /** Absolute path. */
  readonly path: string;
  readonly change: ExportChange;
  readonly bytes: number;
  readonly content: string;
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
 * The format, or a clear error.
 *
 * `selectExporters` throws a plain `Error` for an unknown format,
 * which would reach the bridge as an unknown failure. A format that
 * does not exist is a bad argument, and it is said so.
 */
function asFormat(target: string): ExportFormatId {
  const format = EXPORT_FORMATS.find((item) => item === target.toLowerCase().trim());
  if (format === undefined) {
    throw apiError(
      "INVALID_INPUT",
      `Unknown export format: ${target}. The known ones are ${EXPORT_FORMATS.join(", ")}.`,
    );
  }
  return format;
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
  outputDirectory: string,
): Promise<IExportPlan> {
  const planned = await buildPlan(snapshot, target, outputDirectory);
  return {
    files: planned.files.map(
      ({ path, change, bytes }): IExportFilePreview => ({ path, change, bytes }),
    ),
    outputPath: planned.outputPath,
    diagnostics: planned.diagnostics,
  };
}

/**
 * Builds the artifacts and **writes** them.
 *
 * The write is atomic: a file that is half-written is worse than no
 * file, because the user cannot tell which half is the truth.
 */
export async function writeExport(
  snapshot: IProjectSnapshot,
  target: string,
  outputDirectory: string,
): Promise<{
  readonly outputPath: string;
  readonly bytes: number;
  readonly files: ReadonlyArray<string>;
}> {
  const planned = await buildPlan(snapshot, target, outputDirectory);
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
  };
}

/** The plan, with the content each file would hold. */
interface IBuiltPlan {
  readonly files: ReadonlyArray<IPlannedFile>;
  readonly outputPath: string;
  readonly diagnostics: ReadonlyArray<string>;
}

/** Builds once, and says what each file would change. */
async function buildPlan(
  snapshot: IProjectSnapshot,
  target: string,
  outputDirectory: string,
): Promise<IBuiltPlan> {
  const exporters = selectExporters([asFormat(target)]);
  const results: IExportResult[] = await buildArtifacts(snapshot, exporters);

  const diagnostics: string[] = [];
  for (const result of results) {
    for (const diagnostic of result.diagnostics) {
      diagnostics.push(`${diagnostic.code}: ${diagnostic.message}`);
    }
  }
  const errors = results.flatMap((result) =>
    result.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
  );
  if (errors.length > 0) {
    throw apiError(
      "EXPORT_FAILED",
      `The ${target} exporter could not produce its artifact: ${errors
        .map((diagnostic) => diagnostic.message)
        .join("; ")}`,
    );
  }

  const directory = resolve(outputDirectory);
  const files: IPlannedFile[] = [];

  for (const result of results) {
    // An exporter whose artifact IS the primary output declares no
    // files: the writer puts that artifact in the output path the
    // caller chose.
    if (result.files.length === 0) {
      const path = join(directory, `${baseName(snapshot)}.${extensionOf(result.format)}`);
      const content = JSON.stringify(result.artifact ?? {}, null, 2) + "\n";
      files.push(await describeFile(path, content));
      continue;
    }
    for (const artifact of result.files) {
      const path = join(directory, artifact.path);
      files.push(await describeFile(path, artifact.content));
    }
  }

  if (files.length === 0) {
    throw apiError("EXPORT_FAILED", `The ${target} exporter produced no files`);
  }
  return { files, outputPath: files[0]!.path, diagnostics };
}

/** What would happen to one file. */
async function describeFile(path: string, content: string): Promise<IPlannedFile> {
  const bytes = utf8Length(content);
  if (!existsSync(path)) return { path, change: "NEW", bytes, content };
  try {
    const previous = await readFile(path, "utf8");
    return {
      path,
      change: previous === content ? "UNCHANGED" : "UPDATE",
      bytes,
      content,
    };
  } catch {
    // An unreadable file is not "unchanged": the write would replace
    // it, and the user should hear about it.
    return { path, change: "UPDATE", bytes, content };
  }
}

/** The name of the project's primary artifact. */
function baseName(snapshot: IProjectSnapshot): string {
  const root = snapshot.projectRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? "postman";
  return root.replace(/[^\w.-]+/g, "-");
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
