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
import {
  applyAuthFlow,
  authEnvironmentVariables,
} from "../service/auth-flow.service.js";
import {
  generateCollection,
  type IGenerationResult,
} from "../service/generation.pipeline.js";
import { enrichCatalogWithFormRequests } from "../service/catalog-enricher.service.js";
import { loadProject } from "../service/project-loader.service.js";
import {
  normalizeForComparison,
  stripApiPrefix,
} from "../helper/uri.helper.js";
import { countItems, walkCollection } from "../helper/postman.helper.js";
import {
  describeDiscoveredPaths,
  outputCollectionPath,
  outputEnvironmentPath,
  projectRoot,
} from "../service/paths.service.js";
import {
  buildEnvironments,
  defaultEnvironments,
} from "../service/environment-builder.service.js";
import type { EndpointSpec } from "../contract/postman.interface.js";
import type { DiscoveredRoute } from "../contract/postman.interface.js";


/**
 * Detecta heurísticamente el dot-path del token en el AuthController.
 * Mira los archivos `app/Http/Controllers/*Auth*Controller.php` y busca
 * patrones de respuesta. Si no encuentra nada, devuelve undefined.
 */
async function detectTokenPath(): Promise<string | undefined> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { projectRoot } = await import("../service/paths.service.js");
  const root = projectRoot();
  if (!root) return undefined;
  const ctlDir = path.join(root, "app/Http/Controllers");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(ctlDir);
  } catch {
    return undefined;
  }
  const authFiles = entries.filter(
    (f) => /Auth(entic|oriz)?/i.test(f) && f.endsWith("Controller.php"),
  );
  for (const f of authFiles) {
    const text = await fs.readFile(path.join(ctlDir, f), "utf8").catch(() => "");
    // Patrones comunes: 'access_token' => $t, 'data' => ['token' => ...]
    if (/'access_token'\s*=>/.test(text) || /"access_token"\s*=>/.test(text))
      return "access_token";
    if (/'token'\s*=>\s*\$/.test(text) || /"token"\s*=>\s*\$/.test(text)) {
      // JWT: token suele ir en raíz. Sanctum: suele ir en data.token.
      // Si hay 'data' => 'token', preferimos data.token.
      if (/'data'\s*=>\s*\[[\s\S]*?'token'\s*=>/.test(text)) return "data.token";
      return "token";
    }
    if (/'data'\s*=>\s*\[[\s\S]*?'access_token'\s*=>/.test(text))
      return "data.access_token";
  }
  return undefined;
}

/**
 * Descubre endpoints y construye la colección usando el pipeline
 * compartido (`service/generation.pipeline.ts`).
 *
 * Este script solo pone lo que es suyo: parseo de flags, trazas por
 * consola, enriquecido con variantes y escritura de artefactos. El orden
 * de los pasos del pipeline vive en el servicio, para que el CLI, los
 * tests y el gate ejecuten exactamente lo mismo.
 */
async function runPipeline(basename: string | null): Promise<IGenerationResult> {
  console.log("→ Rutas detectadas:");
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
  const result = await generateCollection(root, {
    ...(basename ? { collectionName: basename } : {}),
  });

  console.log(
    result.match
      ? `→ Orchestrator: framework=${result.match.framework}`
      : "→ Orchestrator: sin match → flujo zero-config legacy.",
  );
  console.log(
    `  · ${result.metrics.routes} rutas en código, ${result.metrics.specs} specs ` +
      `(con validación: ${result.metrics.withValidation}, sin: ${result.metrics.withoutValidation}).`,
  );
  console.log(
    `→ Inferencia agnóstica: ${result.metrics.bodiesInferred} bodies + ` +
      `${result.metrics.queriesInferred} queries auto-rellenados.`,
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
/**
 * Añade las variables de credenciales sin pisar las que el host ya
 * declare (puede tener un `token` con valor propio, por ejemplo).
 */
function mergeAuthVariables(
  existing: Array<{ key: string; value: string; type?: string }>,
): Array<{ key: string; value: string; type?: string }> {
  const known = new Set(existing.map((v) => v.key));
  return [...existing, ...authEnvironmentVariables().filter((v) => !known.has(v.key))];
}

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

async function main(): Promise<number> {
  const args = process.argv.slice(2);
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
  const config = pipeline.config;
  const origin = pipeline.match?.framework ?? "legacy";

  // Modo --inspect: solo imprimir discovery, sin escribir archivos.
  // Pensado para que `summary` (y herramientas similares) puedan
  // consultar el estado del proyecto sin generar artefactos.
  if (inspectMode) {
    console.log("\n→ Modo --inspect (no se escriben artefactos)");
    console.log(`  · Framework:    ${origin}`);
    console.log(`  · ProjectName:  ${config.name}`);
    console.log(`  · Rutas:        ${pipeline.metrics.routes}`);
    console.log(`  · Specs:        ${pipeline.metrics.specs}`);
    console.log(`  · Con FR:       ${pipeline.metrics.withValidation}`);
    console.log(`  · Sin FR:       ${pipeline.metrics.withoutValidation}`);
    console.log(`  · Bodies auto:  ${pipeline.metrics.bodiesInferred}`);
    console.log(`  · Queries auto: ${pipeline.metrics.queriesInferred}`);
    console.log(`  · BaseUrl:      ${config.baseUrl}`);
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
  const detectedTokenPath = config.tokenResponsePath ?? (await detectTokenPath());
  const authFlow = applyAuthFlow(collection, {
    tokenResponsePath: detectedTokenPath,
    loginEndpointName: config.loginEndpointName,
  });
  if (authFlow?.login) {
    console.log(
      `→ Auth: login en "${authFlow.login.name}" guarda el token automáticamente` +
        (authFlow.refresh ? ", refresh cableado" : "") +
        (authFlow.logout ? ", logout limpia el token" : "") +
        ".",
    );
    // Las credenciales viven en el environment, marcadas como secret.
    config.variables = mergeAuthVariables(config.variables);
  } else {
    console.log("→ Auth: no se detectó endpoint de login (colección sin flujo de sesión).");
  }

  console.log("→ Enriqueciendo con variantes FormRequest…");
  const stats = await enrichCatalogWithFormRequests(collection, frIndex);
  console.log(`  · Variantes body:  ${stats.bodyVariants}`);
  console.log(`  · Variantes query: ${stats.queryVariants}`);
  console.log(`  · Resueltos FR:    ${stats.resolved}`);
  console.log(`  · Sin FR:          ${stats.unresolved}`);
  if (stats.rulesWithUnknown.length > 0) {
    console.log(
      `  · FR con reglas dinámicas: ${stats.rulesWithUnknown.length}`,
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
    `  · ${declared.length} requests finales (${collectionRoutes.size} únicos method+uri).`,
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
  const { requests, folders } = countItems(collection);
  const sizeKb = (json.length / 1024).toFixed(1);
  console.log(`\n✔ Colección escrita en ${OUTPUT_PATH}`);
  console.log(
    `  · ${requests} requests en ${folders} carpetas (${sizeKb} KB).`,
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
  return 0;
}

process.exit(await main());
