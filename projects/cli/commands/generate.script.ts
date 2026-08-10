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
import { mkdir } from "node:fs/promises";
import {
  writeFileAtomic,
  writeJsonAtomic,
} from "../../core/helpers/atomic-write.helper.js";
import { dirname, join } from "node:path";
import {
  DEFAULT_FORMAT,
  exportTo,
  exportWarnings,
  parseFormats,
} from "../../core/exporters/export-registry.service.js";
import { generateWithAllFrameworks } from "../../frameworks/index.js";

import { enrichCatalogWithFormRequests } from "../../frameworks/laravel/catalog-enricher.service.js";
import {
  normalizeForComparison,
  stripApiPrefix,
} from "../../core/helpers/uri.helper.js";
import { countItems, walkCollection } from "../../core/helpers/postman.helper.js";
import { describeDiscoveredPaths, outputCollectionPath, outputDir as outputDirFor, outputEnvironmentPath, projectRoot } from "../../core/discovery/paths.service.js";
import {
  buildEnvironments,
  defaultEnvironments,
} from "../../core/domain/environment-builder.service.js";
import type { DiscoveredRoute } from "../../contracts/interfaces/core/postman.interface.js";
import {
  GENERATE_REPORT_VERSION,
  type IGenerateReport,
} from "../../contracts/interfaces/core/generate-report.interface.js";
import { AUTH_TOKEN_VARIABLE } from "../../core/domain/auth-flow.service.js";
import type { IGenerationResult } from "../../contracts/interfaces/core/discovery.interface.js";

/**
 * Descubre endpoints y construye la colección usando el pipeline
 * compartido (`services/generation.pipeline.ts`).
 *
 * Este script solo pone lo que es suyo: parseo de flags, trazas por
 * consola, enriquecido con variantes y escritura de artefactos. El orden
 * de los pasos del pipeline vive en el servicio, para que el CLI, los
 * tests y el gate ejecuten exactamente lo mismo.
 */
async function runPipeline(
  basename: string | null,
  forceFramework: string | null,
): Promise<IGenerationResult> {
  console.log("→ Resolved paths:");
  console.log(describeDiscoveredPaths());

  // OJO: NO usar `process.cwd()` ni `"."`. El CLI spawnea este script
  // con `cwd` = raíz del paquete, así que un path relativo apunta al
  // propio export-to-postman y el escaneo sale vacío. `projectRoot()`
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
    ...(forceFramework ? { forceFramework } : {}),
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

/**
 * Lo que devuelve una generación: el código de salida y el informe.
 *
 * El informe se construye **siempre**, no solo con `--json`. Antes solo
 * existía dentro de ese `if`, así que cualquier otro consumidor
 * —`expostman ui`, un test, el plugin— tenía que volver a llamar al
 * pipeline o parsear la salida por pantalla. Las dos cosas son una
 * segunda implementación, y una segunda implementación se
 * desincroniza.
 */
export interface IGenerateOutcome {
  readonly code: number;
  readonly report: IGenerateReport | null;
}

/**
 * Genera, escribe y devuelve el informe. Sin imprimir el JSON.
 *
 * `main` es la envoltura que lo imprime cuando se pide `--json`; quien
 * quiera los datos llama aquí y se ahorra el intermediario.
 */
export async function runGenerate(
  argv: string[] = process.argv.slice(2),
): Promise<IGenerateOutcome> {
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
  /** Ficheros de formatos distintos de Postman. */
  const extraPaths: string[] = [];
  let collectionPath: string | null = null;

  const openAfter = args.includes("--open");
  const inspectMode = args.includes("--inspect");
  const outputIdx = args.indexOf("--output");
  const outputFlag = outputIdx !== -1 ? args[outputIdx + 1] ?? null : null;
  const basenameIdx = args.indexOf("--basename");
  const basenameFlag =
    basenameIdx !== -1 ? args[basenameIdx + 1] ?? null : null;
  // `--framework <id>` se salta la detección. Es la salida para los
  // proyectos donde la autodetección NO PUEDE acertar: monorepos cuyo
  // manifiesto está en la raíz, dependencias con alias, manifiestos que
  // se generan en el build. Quien ejecuta esto sabe de qué es su API.
  const frameworkIdx = args.indexOf("--framework");
  const frameworkFlag = frameworkIdx !== -1 ? (args[frameworkIdx + 1] ?? null) : null;

  // `--format a,b,c`. Se valida ANTES de escanear: un nombre mal escrito
  // descubierto al final, tras recorrer el proyecto y sin haber escrito
  // el fichero que se pedía, no dice nada de lo que ha pasado.
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

  const pipeline = await runPipeline(basenameFlag, frameworkFlag);
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
    return { code: 0, report: null };
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
    return { code: 1, report: null };
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
  await writeFileAtomic(OUTPUT_PATH, json + "\n");
  collectionPath = OUTPUT_PATH;
  const { requests, folders } = countItems(collection);

  // Cero endpoints con exit 0 es un exito que no lo es: un paso de CI
  // que ejecute esto pasaria aunque no se hubiera encontrado nada, y
  // alguien importaria una coleccion vacia sin enterarse. Se puede
  // pedir lo contrario con --allow-empty (util para un proyecto que
  // todavia no tiene rutas).
  if (requests === 0 && !args.includes("--allow-empty")) {
    console.error(
      "\n✗ No se ha encontrado ningún endpoint, así que no se escribe nada.\n" +
        "  · Comprueba que `--project-root` apunta a la raíz de tu API.\n" +
        "  · Mira docs/FRAMEWORKS.md para ver qué busca cada scanner.\n" +
        "  · Si el proyecto de verdad no tiene rutas todavía, usa `--allow-empty`.",
    );
    return { code: 1, report: null };
  }
  // Los formatos extra se serializan del MISMO catálogo de endpoints que
  // la colección de Postman: dos formatos del mismo proyecto no pueden
  // discrepar porque cada uno haya escaneado por su cuenta.
  const extraFormats = formats.filter((f) => f !== DEFAULT_FORMAT);
  if (extraFormats.length > 0) {
    const dir = outputDirFor();
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
    console.log(`  · ${artifacts.length} fichero(s) en ${extraFormats.join(", ")}`);
    // Un formato que no lo representa todo lo dice: el fichero sale
    // igual, pero incompleto.
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
    const envPath = await outputEnvironmentPath(env.name, config.name);
    await writeJsonAtomic(envPath, env);
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
      return { code: r.status ?? 1, report: null };
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
  if (jsonMode) humanLog(JSON.stringify(report, null, 2));
  return { code: 0, report };
}

/** La envoltura que usa el CLI: solo el código de salida. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  return (await runGenerate(argv)).code;
}

/**
 * Traduce un error del sistema de ficheros a algo accionable.
 *
 * Sin esto, un directorio sin permiso de escritura sacaba
 * `EACCES: permission denied, mkdir ...` con su traza de Bun encima: la
 * información estaba, pero enterrada y sin decir qué hacer.
 */
function explainWriteError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  const message = error instanceof Error ? error.message : String(error);

  if (code === "EACCES" || code === "EPERM") {
    return (
      `No hay permiso para escribir la salida.\n  ${message}\n` +
      "  Usa `--output-dir <ruta>` para escribir en otro sitio, o revisa los permisos."
    );
  }
  if (code === "ENOSPC") return `No queda espacio en disco.\n  ${message}`;
  if (code === "EROFS") {
    return (
      `El sistema de ficheros es de solo lectura.\n  ${message}\n` +
      "  Usa `--output-dir <ruta>` para escribir en otro sitio."
    );
  }
  return message;
}

if (import.meta.main) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(`\n✗ ${explainWriteError(error)}`);
    process.exit(1);
  }
}
