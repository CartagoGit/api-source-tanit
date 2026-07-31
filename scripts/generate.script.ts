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
  attachLoginAutoToken,
  buildCollection,
} from "../service/collection-builder.service.js";
import { discoverEndpoints } from "../service/endpoint-discovery.service.js";
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
} from "../service/paths.service.js";
import {
  applyAgnosticInference,
  inferCollectionVariables,
} from "../service/param-inferrer.service.js";
import {
  buildEnvironments,
  defaultEnvironments,
} from "../service/environment-builder.service.js";
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

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const openAfter = args.includes("--open");
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

  console.log("→ Rutas detectadas:");
  console.log(describeDiscoveredPaths());

  const { config, manualEndpoints, configPath, endpointsPath } =
    await loadProject();
  console.log(`→ Config host: ${configPath}`);
  if (endpointsPath) {
    console.log(
      `→ Overrides manuales: ${endpointsPath} (${manualEndpoints.length})`,
    );
  } else {
    console.log("→ Overrides manuales: (ninguno)");
  }

  console.log("→ Descubriendo endpoints automáticamente…");
  const discovered = await discoverEndpoints(config, manualEndpoints);
  console.log(
    `  · ${discovered.routes.length} rutas en código, ${discovered.specs.length} specs ` +
      `(FormRequest: ${discovered.withFormRequest}, sin FR: ${discovered.withoutFormRequest}).`,
  );

  // Índice method+uri → FormRequest para el enricher
  const frIndex = new Map<string, string>();
  for (const s of discovered.specs) {
    if (!s.formRequest) continue;
    const key = `${s.method} ${normalizeForComparison(s.uri.replace(/^\//, ""))}`;
    frIndex.set(key, s.formRequest);
  }

  // Inferencia agnóstica de body/query para endpoints sin FormRequest.
  const inferStats = applyAgnosticInference(discovered.specs);
  console.log(
    `→ Inferencia agnóstica: ${inferStats.bodiesAdded} bodies + ${inferStats.queriesAdded} queries ` +
      `auto-rellenados.`,
  );

  // Variables de colección: si el host no las define, las derivamos.
  if (!config.variables || config.variables.length === 0) {
    config.variables = inferCollectionVariables(discovered.specs, []);
  } else {
    // Añade cualquier {{pathParam}} que falte en las variables del host.
    const inferred = inferCollectionVariables(
      discovered.specs,
      config.variables,
    );
    config.variables = inferred;
  }

  console.log("→ Construyendo colección Postman…");
  const collection = buildCollection(discovered.specs, config);
  const detectedTokenPath = config.tokenResponsePath ?? (await detectTokenPath());
  attachLoginAutoToken(collection, {
    loginEndpointName: config.loginEndpointName,
    loginEndpointHints: config.loginEndpointHints,
    tokenResponsePath: detectedTokenPath,
  });

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
  for (const r of discovered.routes) {
    const uri = stripApiPrefix(r.uri);
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
  if (basenameFlag) process.env.POSTMAN_OUTPUT_BASENAME = basenameFlag;
  const OUTPUT_PATH = outputFlag
    ? outputFlag
    : await outputCollectionPath(config.name);
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
    const envs = buildEnvironments(discovered.specs, config.variables, [e]);
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
