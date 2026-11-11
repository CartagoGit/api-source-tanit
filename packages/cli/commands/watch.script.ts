#!/usr/bin/env bun
/**
 * `apisrc watch` — regenerates the collection on save.
 *
 * Generates once and then keeps watching. Every time something changes
 * under the project root, it regenerates and reports what changed
 * compared to the previous run.
 *
 * The output folder is **always** ignored — it lives inside what is
 * being watched, so without this the first write would trigger the
 * next one and never stop. That logic lives in `watcher.service.ts`,
 * with its tests.
 *
 * Usage:
 *   apisrc watch --project-root ./my-api
 *   apisrc watch --project-root ./my-api --once   # one pass and exit
 *   apisrc watch --format postman,openapi         # regenerates both
 */
import { dirname, join, relative } from "node:path";
import { mkdir } from "node:fs/promises";

import { exportTo, parseFormats } from "../../core/exporters/export-registry.service.js";

import { generateWithAllFrameworks } from "../../frameworks/index.js";
import { readFlag } from "../../core/helpers/argv.helper.js";
import { resolveProjectContext } from "../../core/discovery/project-context.service.js";
import { outputCollectionPath } from "../../core/discovery/output-paths.helper.js";
import { countItems } from "../../core/helpers/postman.helper.js";
import { watchProject } from "../../core/domain/watcher.service.js";
import {
  writeFileAtomic,
  writeJsonAtomic,
} from "../../core/helpers/atomic-write.helper.js";
import { DEFAULT_EXPORT_FORMAT } from "../../contracts/constants/core/export-formats.constant.js";

/** `18:05:42`, which is what makes a growing trace legible. */
function stamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

/** `+2` / `-1` / empty string if it did not change. */
function delta(current: number, previous: number | null): string {
  if (previous === null || current === previous) return "";
  const diff = current - previous;
  return ` (${diff > 0 ? "+" : ""}${diff})`;
}

interface IRunResult {
  readonly requests: number;
  readonly folders: number;
  /** Files written in formats other than Postman. */
  readonly extra: number;
  readonly ms: number;
  readonly framework: string;
}

/**
 * A complete generation: scan, build, and write.
 *
 * Writes **all** requested formats, not just Postman. Regenerating the
 * collection while leaving the half-hour-old `.openapi.yaml` next to
 * it is worse than regenerating nothing: the two files say different
 * things about the same project and there is no way to tell which one
 * is up to date.
 */
async function regenerate(
  root: string,
  forceFramework: string | null,
  formats: ReadonlyArray<string>,
  context = resolveProjectContext({ projectRoot: root }),
  frameworkSearchRoot: string | null = null,
): Promise<IRunResult> {
  const started = Date.now();
  const result = await generateWithAllFrameworks(root, {
    ...(forceFramework ? { forceFramework } : {}),
    ...(frameworkSearchRoot ? { frameworkSearchRoot } : {}),
  });
  const path = await outputCollectionPath(context, result.config.name);
  await writeJsonAtomic(path, result.collection);

  let extra = 0;
  const others = formats.filter((f) => f !== DEFAULT_EXPORT_FORMAT);
  if (others.length > 0) {
    const dir = context.outputDir;
    const artifacts = exportTo(others, {
      specs: result.specs,
      config: result.config,
      auth: {
        type: result.authScheme.type,
        keyName: result.authScheme.keyName,
        keyIn: result.authScheme.keyIn,
      },
    });
    for (const artifact of artifacts) {
      const target = join(dir, artifact.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFileAtomic(target, artifact.content);
    }
    extra = artifacts.length;
  }

  const { requests, folders } = countItems(result.collection);
  return {
    requests,
    folders,
    extra,
    ms: Date.now() - started,
    framework: result.match?.framework ?? "unknown",
  };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  // `watch` keeps watching a whole tree, so knowing **which** one matters
  // more than in any other command. Without `--project-root` it falls
  // back to the current directory, and running it from the wrong place
  // silently walked whatever was underneath. That is why `watch`
  // resolves its own root with a `cwd` fallback instead of delegating
  // the decision to `resolveProjectContext`, which is strict on purpose.
  const explicitRoot =
    readFlag(argv, "--project-root") ?? process.env["POSTMAN_PROJECT_ROOT"];
  const root = explicitRoot ?? process.cwd();
  if (explicitRoot === undefined) {
    console.log(`→ No --project-root: watching the current directory (${root}).`);
  }
  const context = resolveProjectContext({ argv, projectRoot: root });

  const frameworkIdx = argv.indexOf("--framework");
  const forceFramework = frameworkIdx !== -1 ? (argv[frameworkIdx + 1] ?? null) : null;
  // `--framework-search-root` is passed to the pipeline as-is. Path
  // validation (no leading `/`, no `..`) lives in
  // `generation.pipeline.ts`; `watch` only reads it.
  const searchRootIdx = argv.indexOf("--framework-search-root");
  const frameworkSearchRoot =
    searchRootIdx !== -1 ? (argv[searchRootIdx + 1] ?? null) : null;
  const debounceIdx = argv.indexOf("--debounce");
  const debounceMs =
    debounceIdx !== -1 ? Number(argv[debounceIdx + 1] ?? "") : undefined;
  if (debounceMs !== undefined && (!Number.isFinite(debounceMs) || debounceMs < 0)) {
    console.error("`--debounce` espera milisegundos, un número positivo.");
    return 1;
  }

  // `--format` works here the same way as in `generate`: it is
  // validated before the first pass, not on the first file change.
  const formatIdx = argv.indexOf("--format");
  const parsedFormats = parseFormats(formatIdx !== -1 ? (argv[formatIdx + 1] ?? null) : null);
  if (!parsedFormats.ok) {
    console.error(
      `✗ Formato desconocido: ${parsedFormats.invalid.join(", ")}\n` +
        `  Válidos: ${parsedFormats.valid.join(", ")}`,
    );
    return 1;
  }
  const formats = parsedFormats.formats;

  // One pass before watching: if the project does not generate, better
  // to find out now than to keep waiting for changes on something
  // broken.
  let previous: IRunResult;
  try {
    previous = await regenerate(root, forceFramework, formats, context, frameworkSearchRoot);
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  console.log(
    `[${stamp()}] ✔ ${previous.requests} requests en ${previous.folders} carpetas ` +
      `· ${previous.framework}` +
      (previous.extra > 0 ? ` · +${previous.extra} en otros formatos` : "") +
      ` · ${previous.ms} ms`,
  );

  // `--once` generates and exits. That is what is needed in a pipeline:
  // a check that the collection still comes out, without a process that
  // never terminates.
  if (argv.includes("--once")) return 0;

  console.log(`[${stamp()}] → watching ${root} (Ctrl+C to stop)`);

  let last = previous;
  const handle = watchProject({
    root,
    ...(debounceMs !== undefined ? { debounceMs } : {}),
    onChange: async (changed) => {
      const first = changed[0] ?? "?";
      const more = changed.length > 1 ? ` y ${changed.length - 1} más` : "";
      console.log(`[${stamp()}] · cambió ${relative(root, first) || first}${more}`);
      try {
        const now = await regenerate(root, forceFramework, formats, context, frameworkSearchRoot);
        console.log(
          `[${stamp()}] ✔ ${now.requests}${delta(now.requests, last.requests)} requests ` +
            `en ${now.folders} carpetas` +
            (now.extra > 0 ? ` · +${now.extra} en otros formatos` : "") +
            ` · ${now.ms} ms`,
        );
        last = now;
      } catch (error) {
        // A failure must not take down the watcher: while editing, it is
        // normal for the file to be half-written for an instant.
        console.error(`[${stamp()}] ✗ ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  });

  // Ctrl+C closes the watcher before exiting. Without this the handle
  // stays open and the process never terminates.
  await new Promise<void>((resolve) => {
    const stop = (): void => {
      handle.close();
      console.log(`\n[${stamp()}] → watch detenido`);
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
