/**
 * Main script: generates the Postman v2.1.0 collection by automatically
 * discovering endpoints from `routes/*.php` + controller signatures
 * (FormRequest), and enriching with variants.
 *
 * The host configuration is loaded in a framework-agnostic way via
 * `loadProject()` (`--config`, `POSTMAN_CONFIG`, or
 * `examples/<project>/config.constant.ts`).
 *
 * Usage:
 *   bun scripts/generate.script.ts
 *   bun scripts/generate.script.ts --config ./examples/example-app/config.constant.ts
 *   bun run build
 */
import { mkdir } from "node:fs/promises";
import {
  writeFileAtomic,
  writeJsonAtomic,
} from "../../core/helpers/atomic-write.helper.js";
import { dirname, join } from "node:path";
import { exportTo, exportWarnings, parseFormats } from "../../core/exporters/export-registry.service.js";
import { generateWithAllFrameworks } from "../../frameworks/index.js";

import { enrichCatalogWithFormRequests, LARAVEL_FORM_REQUEST_ENRICHER, enrichValidationSources } from "../../frameworks/laravel/catalog-enricher.service.js";
import { registerValidationEnricher } from "../../core/validation/validation-enricher.service.js";
import {
  normalizeForComparison,
  stripApiPrefix,
} from "../../core/helpers/uri.helper.js";
import { countItems, walkCollection } from "../../core/helpers/postman.helper.js";
import { postmanMethodFor } from "../../core/domain/postman-method.helper.js";
import {
  describeDiscoveredPaths,
  outputCollectionPath,
  outputEnvironmentPath,
} from "../../core/discovery/output-paths.helper.js";
import { resolveProjectContext } from "../../core/discovery/project-context.service.js";
import type { IProjectContext } from "../../contracts/interfaces/core/project-context.interface.js";
import { main as runOpenPostman } from "./open-postman.script.js";
import { buildEnvironments, defaultEnvironments } from "../../core/domain/environment-builder.service.js";
import type { DiscoveredRoute } from "../../contracts/interfaces/core/postman.interface.js";
import {
  GENERATE_REPORT_VERSION,
  type IGenerateReport,
} from "../../contracts/interfaces/core/generate-report.interface.js";

import type { IGenerationResult } from "../../contracts/interfaces/core/discovery.interface.js";
import type { IGenerateOutcome } from "../../contracts/interfaces/cli/command-outcomes.interface.js";
import { DEFAULT_EXPORT_FORMAT } from "../../contracts/constants/core/export-formats.constant.js";
import { AUTH_TOKEN_VARIABLE } from "../../contracts/constants/core/auth.constant.js";
import { MultipleServicesWithoutCombineError } from "../../core/discovery/generation.pipeline.js";

/**
 * Discovers endpoints and builds the collection using the shared
 * pipeline (`services/generation.pipeline.ts`).
 *
 * This script only adds what is its own: flag parsing, console
 * traces, variant enrichment, and writing artifacts. The order of the
 * pipeline steps lives in the service, so the CLI, the tests, and the
 * gate execute exactly the same thing.
 */
async function runPipeline(
  basename: string | null,
  forceFramework: string | null,
  context: IProjectContext,
  frameworkSearchRoot: string | null,
  combineServices: boolean,
): Promise<IGenerationResult> {
  console.log("→ Resolved paths:");
  console.log(describeDiscoveredPaths(context));

  // WARNING: do NOT use `process.cwd()` or `"."`. The CLI spawns this
  // script with `cwd` = package root, so a relative path points at
  // api-source-tanit itself and the scan comes back empty.
  // `projectRoot()` resolves the `--project-root` flag and
  // `POSTMAN_PROJECT_ROOT`. With injected context (ui, tests, tools)
  // the singleton is not even consulted: r00008 S2 — the process argv
  // is not the one from the request.
  const root = context.projectRoot;
  const result = await generateWithAllFrameworks(root, {
    ...(basename ? { collectionName: basename } : {}),
    ...(forceFramework ? { forceFramework } : {}),
    ...(frameworkSearchRoot ? { frameworkSearchRoot } : {}),
    ...(combineServices ? { combineServices: true } : {}),
  });

  console.log(
    result.match
      ? `→ Orchestrator: framework=${result.match.framework}`
      : "→ Orchestrator: no match → legacy zero-config flow.",
  );
  console.log(
    `  · ${result.metrics.routes} routes in code, ${result.metrics.specs} specs ` +
      `(with rules: ${result.metrics.withValidation}, without: ${result.metrics.withoutValidation}).`,
  );
  console.log(
    `→ Framework-agnostic inference: ${result.metrics.bodiesInferred} bodies + ` +
      `${result.metrics.queriesInferred} query params filled in.`,
  );
  return result;
}

/**
 * Warns when a collection with the SAME name but a DIFFERENT
 * `_postman_id` already exists at the output path.
 *
 * It means two different projects will compete for the same slot in
 * Postman: when the second is imported, the user ends up with two
 * homonymous collections and cannot tell which is which. The fix is
 * to set `collectionId` in one of the two configs.
 */
async function warnOnIdentityClash(
  outputPath: string,
  collection: { info: { name: string; _postman_id?: string } },
): Promise<void> {
  const { existsSync } = await import("node:fs");
  const { readFile } = await import("node:fs/promises");
  if (!existsSync(outputPath)) return;
  try {
    const previous = JSON.parse(await readFile(outputPath, "utf8")) as {
      info?: { name?: string; _postman_id?: string };
    };
    const sameName = previous.info?.name === collection.info.name;
    const differentId =
      Boolean(previous.info?._postman_id) &&
      previous.info?._postman_id !== collection.info._postman_id;
    if (sameName && differentId) {
      console.warn(
        `\n⚠ A collection named "${collection.info.name}" already exists with a different id.\n` +
          "  Importing both into Postman leaves two collections with the same name.\n" +
          "  Set `collectionId` in one project's config to tell them apart.",
      );
    }
  } catch {
    // A previous unreadable JSON is not a reason to abort generation.
  }
}

/**
 * Generates, writes, and returns the report. Without printing the JSON.
 *
 * `main` is the wrapper that prints it when `--json` is requested;
 * whoever wants the data calls here and skips the intermediary.
 */
export async function runGenerate(
  argv: string[] = process.argv.slice(2),
  context?: IProjectContext,
): Promise<IGenerateOutcome> {
  const args = argv;
  const resolvedContext = context ?? resolveProjectContext({ argv: args });
  const startedAt = Date.now();
  const jsonMode = args.includes("--json");

  // In `--json` mode stdout belongs to the report and no one else. The
  // human-readable trace is not lost: it goes to stderr, which is
  // where what accompanies a result without being part of it belongs.
  const humanLog = console.log;
  if (jsonMode) {
    console.log = (...parts: unknown[]) => {
      process.stderr.write(`${parts.map(String).join(" ")}\n`);
    };
  }
  const environmentPaths: string[] = [];
  /** Files in formats other than Postman. */
  const extraPaths: string[] = [];
  let collectionPath: string | null = null;

  const openAfter = args.includes("--open");
  const inspectMode = args.includes("--inspect");
  const outputIdx = args.indexOf("--output");
  const outputFlag = outputIdx !== -1 ? args[outputIdx + 1] ?? null : null;
  const basenameIdx = args.indexOf("--basename");
  const basenameFlag =
    basenameIdx !== -1 ? args[basenameIdx + 1] ?? null : null;
  // `--framework <id>` skips detection. It is the escape hatch for
  // projects where autodetection CANNOT be right: monorepos whose
  // manifest lives at the root, dependencies with aliases, manifests
  // generated at build time. Whoever runs this knows what their API
  // is.
  const frameworkIdx = args.indexOf("--framework");
  const frameworkFlag = frameworkIdx !== -1 ? (args[frameworkIdx + 1] ?? null) : null;

  // `--framework-search-root <subdir>` points at the specific workspace
  // of the framework inside the project. It has two uses:
  //   1. Force a subdir that the monorepo detection would miss
  //      (several workspaces with a single manifest at the root).
  //   2. Point at a subdir when autodetection does not either
  //      (manifest at root, dependency with an alias, ...).
  //
  // If it is omitted and the project is a monorepo with a single
  // workspace, the orchestrator fills it in automatically. Path
  // validation (no leading `/`, no `..`) lives in the pipeline; here
  // it is only read.
  const searchRootIdx = args.indexOf("--framework-search-root");
  const frameworkSearchRoot =
    searchRootIdx !== -1 ? (args[searchRootIdx + 1] ?? null) : null;

  // a00013 S3: `--combine-services` merges the services of a monorepo
  // into a single collection (legacy mode). Default false: one
  // collection per service. For flat projects (a single service) the
  // flag is ignored.
  const combineServicesFlag = args.includes("--combine-services");

  // `--format a,b,c`. Validated BEFORE scanning: a misspelled format
  // name discovered at the end, after walking the project and having
  // not written the file that was asked for, says nothing about what
  // happened.
  const formatIdx = args.indexOf("--format");
  const parsedFormats = parseFormats(formatIdx !== -1 ? (args[formatIdx + 1] ?? null) : null);
  if (!parsedFormats.ok) {
    console.error(
      `\n✗ Formato desconocido: ${parsedFormats.invalid.join(", ")}\n` +
        `  Válidos: ${parsedFormats.valid.join(", ")}`,
    );
    return { code: 1, report: null };
  }
  const formats = parsedFormats.formats;

  const envsIdx = args.indexOf("--envs");
  const envsFlag =
    envsIdx !== -1
      ? (args[envsIdx + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean)
      : null;

  const pipeline = await runPipeline(
    basenameFlag,
    frameworkFlag,
    resolvedContext,
    frameworkSearchRoot,
    combineServicesFlag,
  );
  const discoveredSpecs = pipeline.specs;

  // Warnings go BEFORE writing anything: if someone aborts the run on
  // seeing half an API is missing, better they find out here.
  for (const warning of pipeline.warnings) {
    console.log(`\n⚠ ${warning}`);
  }
  if (pipeline.frameworks.length > 1) {
    console.log(`  · Frameworks escaneados: ${pipeline.frameworks.join(", ")}`);
  }
  const config = pipeline.config;
  const origin = pipeline.match?.framework ?? "legacy";

  // --inspect mode: only print the discovery, do not write any files.
  // Designed so that `summary` (and similar tools) can query the
  // project state without producing artifacts.
  if (inspectMode) {
    console.log("\n→ --inspect mode (no files written)");
    console.log(`  · Framework:      ${origin}`);
    console.log(`  · Project name:   ${config.name}`);
    console.log(`  · Routes:         ${pipeline.metrics.routes}`);
    console.log(`  · Specs:          ${pipeline.metrics.specs}`);
    console.log(`  · With rules:     ${pipeline.metrics.withValidation}`);
    console.log(`  · Without rules:  ${pipeline.metrics.withoutValidation}`);
    if (pipeline.match?.frameworkSearchRoot) {
      console.log(
        `  · Search root:    ${pipeline.match.frameworkSearchRoot}` +
          (frameworkSearchRoot ? " (--framework-search-root)" : " (auto-detected)"),
      );
    } else if (frameworkSearchRoot) {
      // Audit 2026-09-04 (monorepo expansion): with an override, if
      // the workspace does not contain the framework (typical case:
      // user typo, subdir that does not exist), the match has no
      // frameworkSearchRoot and the row is skipped. But the user DID
      // pass the flag and deserves to see it in `--inspect`. It is
      // printed whenever the flag is present.
      console.log(
        `  · Search root:    ${frameworkSearchRoot} (--framework-search-root, no framework matched)`,
      );
    }
    console.log(`  · Bodies inferred:${pipeline.metrics.bodiesInferred}`);
    console.log(`  · Query inferred: ${pipeline.metrics.queriesInferred}`);
    console.log(`  · Base URL:       ${config.baseUrl}`);
    return { code: 0, report: null };
  }

  // method+uri → FormRequest index for the enricher.
  const frIndex = new Map<string, string>();
  for (const spec of discoveredSpecs) {
    if (!spec.formRequest) continue;
    const key = `${spec.method} ${normalizeForComparison(spec.uri.replace(/^\//, ""))}`;
    frIndex.set(key, spec.formRequest);
  }

  const collection = pipeline.collection;
  const authFlow = pipeline.authFlow;
  if (authFlow?.login) {
    console.log(
      `→ Auth: login at "${authFlow.login.name}" stores the token automatically` +
        (authFlow.refresh ? ", refresh wired" : "") +
        (authFlow.logout ? ", logout clears the token" : "") +
        ".",
    );
  } else {
    console.log("→ Auth: no login endpoint found (collection has no session flow).");
  }

  console.log("→ Enriching with validation-rule variants…");
  // S5 (a00012): side-effect registration of the Laravel enricher. The
  // registry is process-global; registering it here guarantees that
  // any tool/test importing `runValidationEnrichers` after `generate`
  // starts sees the provider. Phase 2 will move the registration to
  // the bootstrap, but as long as `core` does not know about Laravel,
  // this lives in the script that knows both sides.
  registerValidationEnricher(LARAVEL_FORM_REQUEST_ENRICHER);
  // S5: dispatches the specs by provider through the registry. Those
  // without `validationSource` or whose provider is not registered
  // come back identical (Phase 1: `LARAVEL_FORM_REQUEST_ENRICHER` is
  // idempotent). The actual variant generation stays in
  // `enrichCatalogWithFormRequests`, called just below.
  enrichValidationSources(discoveredSpecs);
  const stats = await enrichCatalogWithFormRequests(collection, frIndex, pipeline.context);
  console.log(`  · Body variants:   ${stats.bodyVariants}`);
  console.log(`  · Query variants:  ${stats.queryVariants}`);
  console.log(`  · Rules resolved:  ${stats.resolved}`);
  console.log(`  · Rules missing:   ${stats.unresolved}`);
  if (stats.rulesWithUnknown.length > 0) {
    console.log(
      `  · Dynamic rules skipped: ${stats.rulesWithUnknown.length}`,
    );
  }

  // Cobertura bidireccional
  const sourceRoutes = new Map<string, DiscoveredRoute>();
  for (const r of pipeline.routes) {
    // Only Laravel (legacy) strips the `api/` prefix. Other frameworks
    // have a real prefix (api/v1, etc.) and must keep it.
    const uri = pipeline.origin === "legacy" ? stripApiPrefix(r.uri) : r.uri;
    // x00056 S1 follow-up: the source `method` is in Tanit's vocabulary
    // (`ALL` for "any method") while the collection builder emits
    // Postman's vocabulary (`ANY`). Translating here means the two
    // sides of the bidirectional check agree on what an endpoint
    // means. Without this, a Hono `app.all('/x')` aborts the CLI with
    // `ALL /x in routes but NOT in collection` even though the
    // collection has the request under the same key.
    const method = postmanMethodFor(r.method);
    const key = `${method} ${normalizeForComparison(uri)}`;
    sourceRoutes.set(key, { method, uri });
  }
  const declared = walkCollection(collection);
  const collectionRoutes = new Map<
    string,
    { method: string; uri: string; name: string }
  >();
  for (const r of declared) {
    const key = `${r.method} ${normalizeForComparison(r.uri)}`;
    collectionRoutes.set(key, r);
  }
  console.log(
    `  · ${declared.length} final requests (${collectionRoutes.size} unique method+uri).`,
  );

  const missingInSource: Array<{ method: string; uri: string; name: string }> =
    [];
  for (const [key, info] of collectionRoutes) {
    if (!sourceRoutes.has(key)) missingInSource.push(info);
  }
  const missingInCollection: DiscoveredRoute[] = [];
  for (const [key, info] of sourceRoutes) {
    if (info.uri === "auth-test") continue;
    if (!collectionRoutes.has(key)) missingInCollection.push(info);
  }
  if (missingInSource.length) {
    console.error(
      `\n✘ ${missingInSource.length} in the collection but NOT in the routes:`,
    );
    for (const m of missingInSource.slice(0, 20)) {
      console.error(`    ${m.method.padEnd(6)} /${m.uri} (${m.name})`);
    }
  }
  if (missingInCollection.length) {
    console.error(
      `\n✘ ${missingInCollection.length} in the routes but NOT in the collection:`,
    );
    for (const m of missingInCollection.slice(0, 20)) {
      console.error(`    ${m.method.padEnd(6)} /${m.uri}`);
    }
  }
  if (missingInSource.length || missingInCollection.length) {
    console.error("\n→ Generation aborted.");
    return { code: 1, report: null };
  }

  // --output / --basename respect environment variables + flags.
  if (basenameFlag) {
    process.env.POSTMAN_OUTPUT_BASENAME = basenameFlag;
  }
  const OUTPUT_PATH = outputFlag
    ? outputFlag
    : await outputCollectionPath(resolvedContext, config.name);
  await warnOnIdentityClash(OUTPUT_PATH, collection);
  const json = JSON.stringify(collection, null, 2);
  await writeFileAtomic(OUTPUT_PATH, json + "\n");
  collectionPath = OUTPUT_PATH;
  const { requests, folders } = countItems(collection);

  // Zero endpoints with exit 0 is a non-success: a CI step running
  // this would pass even if nothing was found, and someone would
  // import an empty collection without noticing. The opposite can be
  // requested with --allow-empty (useful for a project that does not
  // have routes yet).
  if (requests === 0 && !args.includes("--allow-empty")) {
    console.error(
      "\n✗ No endpoints were found, so nothing was written.\n" +
        "  · Check that `--project-root` points at your API's root.\n" +
        "  · See docs/FRAMEWORKS.md for what each scanner looks for.\n" +
        "  · If the project genuinely has no routes yet, use `--allow-empty`.",
    );
    return { code: 1, report: null };
  }
  // Extra formats are serialized from the SAME endpoint catalog as the
  // Postman collection: two formats from the same project cannot
  // disagree because each scanned on its own.
  const extraFormats = formats.filter((f) => f !== DEFAULT_EXPORT_FORMAT);
  if (extraFormats.length > 0) {
    const dir = resolvedContext.outputDir;
    const exportInput = {
      specs: discoveredSpecs,
      config,
      auth: {
        type: pipeline.authScheme.type,
        keyName: pipeline.authScheme.keyName,
        keyIn: pipeline.authScheme.keyIn,
      },
    };
    const artifacts = exportTo(extraFormats, exportInput);
    for (const artifact of artifacts) {
      const target = join(dir, artifact.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFileAtomic(target, artifact.content);
      extraPaths.push(target);
    }
    console.log(`  · ${artifacts.length} file(s) in ${extraFormats.join(", ")}`);
    // A format that does not represent everything says so: the file
    // comes out the same, but incomplete.
    for (const warning of exportWarnings(extraFormats, exportInput)) {
      console.warn(`\n⚠ ${warning}`);
    }
  }

  const sizeKb = (json.length / 1024).toFixed(1);
  console.log(`\n✔ Collection written to ${OUTPUT_PATH}`);
  console.log(
    `  · ${requests} requests in ${folders} folders (${sizeKb} KB).`,
  );

  // --- Genera environments si --envs o config.environments ------------
  const configEnvs = config.environments
    ? [...config.environments]
    : [];
  if (envsFlag) {
    const auto = defaultEnvironments(config.baseUrl);
    const merged = [...configEnvs];
    for (const name of envsFlag) {
      const found = auto.find((e) => e.name.toLowerCase() === name.toLowerCase());
      if (found) merged.push(found);
      else
        merged.push({
          name,
          overrides: { baseUrl: config.baseUrl },
        });
    }
    config.environments = merged;
  }
  const envsToWrite = config.environments ?? [];
  for (const e of envsToWrite) {
    const envs = buildEnvironments(
      [...discoveredSpecs],
      config.variables,
      [e],
      collection.info._postman_id ?? "",
    );
    const env = envs[0];
    if (!env) continue;
    const envPath = await outputEnvironmentPath(resolvedContext, env.name, config.name);
    await writeJsonAtomic(envPath, env);
    environmentPaths.push(envPath);
    console.log(
      `  · Environment "${env.name}" → ${envPath} (${env.values.length} vars)`,
    );
  }

  if (openAfter) {
    // Previously this did `spawnSync("bun", ["run", "<dir>/open-postman.script.ts", …])`
    // with `(import.meta as { dir?: string }).dir ?? process.cwd()`.
    // Three flaws at once: the cast silenced a field that does not
    // exist in `import.meta`, the fallback landed on `process.cwd()`
    // (banned by `lint:tools`/`lint:lint-tool-no-process.script.ts`),
    // and the built path did not resolve to the file after the
    // `packages/` reorg. Calling the sibling module's `main` in
    // process is the correct version: same exit code, no spawn, no
    // globals.
    console.log("\n→ --open: launching open-postman…");
    const exit = await runOpenPostman();
    if (exit !== 0) {
      console.error("✘ open-postman.script.ts falló.");
      return { code: exit, report: null };
    }
  }

  const report: IGenerateReport = {
      version: GENERATE_REPORT_VERSION,
      ok: true,
      framework: pipeline.match?.framework ?? null,
      frameworks: pipeline.frameworks,
      warnings: pipeline.warnings,
      projectRoot: pipeline.context.projectRoot,
      projectName: config.name,
      collectionPath,
      collectionId: collection.info._postman_id ?? null,
      environmentPaths,
      extraPaths,
      requests,
      folders,
      auth: pipeline.authFlow?.login
        ? {
            // The login is a `PostmanItem`: method and URL live on its
            // `request`, not on the item itself.
            loginEndpoint: `${pipeline.authFlow.login.request?.method ?? "POST"} ${
              pipeline.authFlow.login.request?.url?.raw ?? pipeline.authFlow.login.name
            }`,
            tokenVariable: AUTH_TOKEN_VARIABLE,
          }
        : null,
    durationMs: Date.now() - startedAt,
  };
  if (jsonMode) humanLog(JSON.stringify(report, null, 2));
  return { code: 0, report };
}

/** The wrapper used by the CLI: only the exit code. */
export async function main(
  argv: string[] = process.argv.slice(2),
  context?: IProjectContext,
): Promise<number> {
  return (await runGenerate(argv, context)).code;
}

/**
 * Translates a filesystem error into something actionable.
 *
 * Without this, a directory without write permission would print
 * `EACCES: permission denied, mkdir ...` with Bun's trace on top: the
 * information was there, but buried and without saying what to do.
 */
function explainWriteError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  const message = error instanceof Error ? error.message : String(error);

  if (code === "EACCES" || code === "EPERM") {
    return (
      `No permission to write the output.\n  ${message}\n` +
      "  Use `--output-dir <path>` to write elsewhere, or check the permissions."
    );
  }
  if (code === "ENOSPC") return `No queda espacio en disco.\n  ${message}`;
  if (code === "EROFS") {
    return (
      `El sistema de ficheros es de solo lectura.\n  ${message}\n` +
      "  Use `--output-dir <path>` to write elsewhere."
    );
  }
  return message;
}

if (import.meta.main) {
  try {
    process.exit(await main());
  } catch (error) {
    // x00024: the pipeline now throws this error when there is >1
    // service and the caller did not request --combine-services. It
    // is translated to exit 64 (EX_USAGE) with an actionable message:
    // CI scripts detect the case without parsing text, and the person
    // reading it on screen sees which services were detected and how
    // to resolve it.
    if (error instanceof MultipleServicesWithoutCombineError) {
      console.error(`\n✗ ${error.message}`);
      if (error.serviceIds.length > 0) {
        console.error(`\n  Detected services:`);
        for (const id of error.serviceIds) console.error(`    - ${id}`);
      }
      console.error(`\n  Re-run with --combine-services to merge them into one collection,`);
      console.error(`  or omit --combine-services to emit one collection per service.`);
      process.exit(64); // EX_USAGE
    }
    console.error(`\n✗ ${explainWriteError(error)}`);
    process.exit(1);
  }
}
