/**
 * Script principal: genera la colección Postman v2.1.0 descubriendo
 * automáticamente los endpoints desde `routes/*.php` + firmas de
 * controladores (FormRequest), y enriqueciendo con variantes.
 *
 * La configuración del host se carga de forma agnóstica vía
 * `loadProject()` (`--config`, `POSTMAN_CONFIG` o `examples/<proyecto>/config.constant.ts`).
 *
 * Uso:
 *   bun scripts/generate.script.ts
 *   bun scripts/generate.script.ts --config ./examples/example-app/config.constant.ts
 *   bun run build
 */
import { writeFile } from "node:fs/promises";
import { generateWithAllFrameworks } from "../../frameworks/index.js";
import type { IGenerationResult } from "../../core/discovery/generation.pipeline.js";
import { enrichCatalogWithFormRequests } from "../../frameworks/laravel/catalog-enricher.service.js";
import { loadProject } from "../../core/discovery/project-loader.service.js";
import {
  normalizeForComparison,
  stripApiPrefix,
} from "../../core/helpers/uri.helper.js";
import { countItems, walkCollection } from "../../core/helpers/postman.helper.js";
import {
  describeDiscoveredPaths,
  outputCollectionPath,
  outputEnvironmentPath,
  projectRoot,
} from "../../core/discovery/paths.service.js";
import {
  buildEnvironments,
  defaultEnvironments,
} from "../../core/domain/environment-builder.service.js";
import type { EndpointSpec } from "../../core/contracts/postman.interface.js";
import type { DiscoveredRoute } from "../../core/contracts/postman.interface.js";
import {
  GENERATE_REPORT_VERSION,
  type IGenerateReport,
} from "../../core/contracts/generate-report.interface.js";
import { AUTH_TOKEN_VARIABLE } from "../../core/domain/auth-flow.service.js";


/**
 * Descubre endpoints y construye la colección usando el pipeline
 * compartido (`services/generation.pipeline.ts`).
 *
 * Este script solo pone lo que es suyo: parseo de flags, trazas por
 * consola, enriquecido con variantes y escritura de artefactos. El orden
 * de los pasos del pipeline vive en el servicio, para que el CLI, los
 * tests y el gate ejecuten exactamente lo mismo.
 */
async function runPipeline(basename: string | null): Promise<IGenerationResult> {
  console.log("→ Resolved paths:");
  console.log(describeDiscoveredPaths());

  // OJO: NO usar `process.cwd()` ni `"."`. El CLI spawnea este script
  // con `cwd` = raíz del paquete, así que un path relativo apunta al
  // propio postman-exporter y el escaneo sale vacío. `projectRoot()`
  // resuelve el flag `--project-root` y `POSTMAN_PROJECT_ROOT`.
  const root = projectRoot();
  if (!root) {
    throw new Error(
      "No se pudo determinar la raíz del proyecto. Pasa `--project-root <ruta>` " +
        "o define POSTMAN_PROJECT_ROOT.",
    );
  }
  const result = await generateWithAllFrameworks(root, {
    ...(basename ? { collectionName: basename } : {}),
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
 * Avisa si en la ruta de salida ya hay una colección con el MISMO nombre
 * pero DISTINTO `_postman_id`.
 *
 * Significa que dos proyectos diferentes van a competir por el mismo
 * hueco en Postman: al importar el segundo, el usuario acaba con dos
 * colecciones homónimas y no sabe cuál es cuál. La salida es fijar
 * `collectionId` en el config de uno de los dos.
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
        `\n⚠ Ya existe una colección llamada "${collection.info.name}" con otro id.\n` +
          "  Al importar ambas en Postman tendrás dos colecciones homónimas.\n" +
          "  Fija `collectionId` en el config de uno de los proyectos para distinguirlas.",
      );
    }
  } catch {
    // Un JSON previo ilegible no es motivo para abortar la generación.
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = argv;
  const startedAt = Date.now();
  const jsonMode = args.includes("--json");

  // En modo `--json` el stdout es del informe y de nadie más. La traza
  // legible no se pierde: se va a stderr, que es donde va lo que
  // acompaña a un resultado sin formar parte de él.
  const humanLog = console.log;
  if (jsonMode) {
    console.log = (...parts: unknown[]) => {
      process.stderr.write(`${parts.map(String).join(" ")}\n`);
    };
  }
  const environmentPaths: string[] = [];
  let collectionPath: string | null = null;

  const openAfter = args.includes("--open");
  const inspectMode = args.includes("--inspect");
  const outputIdx = args.indexOf("--output");
  const outputFlag = outputIdx !== -1 ? args[outputIdx + 1] ?? null : null;
  const basenameIdx = args.indexOf("--basename");
  const basenameFlag =
    basenameIdx !== -1 ? args[basenameIdx + 1] ?? null : null;
  const envsIdx = args.indexOf("--envs");
  const envsFlag =
    envsIdx !== -1
      ? (args[envsIdx + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean)
      : null;

  const pipeline = await runPipeline(basenameFlag);
  const discoveredSpecs = pipeline.specs;

  // Los avisos van ANTES de escribir nada: si alguien corta la
  // ejecución al ver que le falta media API, mejor que se entere aquí.
  for (const warning of pipeline.warnings) {
    console.log(`\n⚠ ${warning}`);
  }
  if (pipeline.frameworks.length > 1) {
    console.log(`  · Frameworks escaneados: ${pipeline.frameworks.join(", ")}`);
  }
  const config = pipeline.config;
  const origin = pipeline.match?.framework ?? "legacy";

  // Modo --inspect: solo imprimir discovery, sin escribir archivos.
  // Pensado para que `summary` (y herramientas similares) puedan
  // consultar el estado del proyecto sin generar artefactos.
  if (inspectMode) {
    console.log("\n→ --inspect mode (no files written)");
    console.log(`  · Framework:      ${origin}`);
    console.log(`  · Project name:   ${config.name}`);
    console.log(`  · Routes:         ${pipeline.metrics.routes}`);
    console.log(`  · Specs:          ${pipeline.metrics.specs}`);
    console.log(`  · With rules:     ${pipeline.metrics.withValidation}`);
    console.log(`  · Without rules:  ${pipeline.metrics.withoutValidation}`);
    console.log(`  · Bodies inferred:${pipeline.metrics.bodiesInferred}`);
    console.log(`  · Query inferred: ${pipeline.metrics.queriesInferred}`);
    console.log(`  · Base URL:       ${config.baseUrl}`);
    return 0;
  }

  // Índice method+uri → FormRequest para el enricher.
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
  const stats = await enrichCatalogWithFormRequests(collection, frIndex);
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
    // Solo Laravel (legacy) quita el prefijo `api/`. Otros frameworks
    // tienen prefix real (api/v1, etc.) y deben conservarse.
    const uri = pipeline.origin === "legacy" ? stripApiPrefix(r.uri) : r.uri;
    const key = `${r.method} ${normalizeForComparison(uri)}`;
    sourceRoutes.set(key, { method: r.method, uri });
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
      `\n✘ ${missingInSource.length} en colección pero NO en routes:`,
    );
    for (const m of missingInSource.slice(0, 20)) {
      console.error(`    ${m.method.padEnd(6)} /${m.uri} (${m.name})`);
    }
  }
  if (missingInCollection.length) {
    console.error(
      `\n✘ ${missingInCollection.length} en routes pero NO en colección:`,
    );
    for (const m of missingInCollection.slice(0, 20)) {
      console.error(`    ${m.method.padEnd(6)} /${m.uri}`);
    }
  }
  if (missingInSource.length || missingInCollection.length) {
    console.error("\n→ Generación abortada.");
    return 1;
  }

  // --output / --basename respetan variables de entorno + flags.
  if (basenameFlag) {
    process.env.POSTMAN_OUTPUT_BASENAME = basenameFlag;
  }
  const OUTPUT_PATH = outputFlag
    ? outputFlag
    : await outputCollectionPath(config.name);
  await warnOnIdentityClash(OUTPUT_PATH, collection);
  const json = JSON.stringify(collection, null, 2);
  await writeFile(OUTPUT_PATH, json + "\n", "utf8");
  collectionPath = OUTPUT_PATH;
  const { requests, folders } = countItems(collection);
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
    const envPath = await outputEnvironmentPath(env.name, config.name);
    await writeFile(envPath, JSON.stringify(env, null, 2) + "\n", "utf8");
    environmentPaths.push(envPath);
    console.log(
      `  · Environment "${env.name}" → ${envPath} (${env.values.length} vars)`,
    );
  }

  if (openAfter) {
    const { spawnSync } = await import("node:child_process");
    const start =
      (import.meta as { dir?: string }).dir ?? process.cwd();
    const openScript = `${start}/open-postman.script.ts`;
    console.log("\n→ --open: lanzando open-postman…");
    const r = spawnSync(
      "bun",
      ["run", openScript, "--file", OUTPUT_PATH],
      { stdio: "inherit" },
    );
    if (r.status !== 0) {
      console.error("✘ open-postman.script.ts falló.");
      return r.status ?? 1;
    }
  }

  if (jsonMode) {
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
      requests,
      folders,
      auth: pipeline.authFlow?.login
        ? {
            // El login es un `PostmanItem`: método y URL viven en su
            // `request`, no en el item.
            loginEndpoint: `${pipeline.authFlow.login.request?.method ?? "POST"} ${
              pipeline.authFlow.login.request?.url?.raw ?? pipeline.authFlow.login.name
            }`,
            tokenVariable: AUTH_TOKEN_VARIABLE,
          }
        : null,
      durationMs: Date.now() - startedAt,
    };
    humanLog(JSON.stringify(report, null, 2));
  }
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
