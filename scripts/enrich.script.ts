/**
 * Re-enriquece la colección reconstruyendo desde discovery + FormRequests.
 *
 * Uso:
 *   bun scripts/enrich.script.ts
 *   bun scripts/enrich.script.ts --in-place
 *   bun scripts/enrich.script.ts --config ./examples/example-app/config.constant.ts
 */
import { writeFile } from "node:fs/promises";
import { buildCollection } from "../service/collection-builder.service.js";
import { applyAuthFlow } from "../service/auth-flow.service.js";
import { enrichCatalogWithFormRequests } from "../service/catalog-enricher.service.js";
import { discoverEndpoints } from "../service/endpoint-discovery.service.js";
import { loadProject } from "../service/project-loader.service.js";
import {
  outputCollectionPath,
  outputEnrichedPath,
} from "../service/paths.service.js";
import { countItems } from "../helper/postman.helper.js";
import { normalizeForComparison } from "../helper/uri.helper.js";

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const inPlace = process.argv.includes("--in-place");
  const { config, manualEndpoints, configPath } = await loadProject();
  console.log(`→ Config host: ${configPath}`);

  console.log("→ Descubriendo endpoints…");
  const discovered = await discoverEndpoints(config, manualEndpoints);
  const frIndex = new Map<string, string>();
  for (const s of discovered.specs) {
    if (!s.formRequest) continue;
    const key = `${s.method} ${normalizeForComparison(s.uri.replace(/^\//, ""))}`;
    frIndex.set(key, s.formRequest);
  }

  console.log("→ Construyendo colección base…");
  const collection = buildCollection(discovered.specs, config);
  applyAuthFlow(collection, {
    tokenResponsePath: config.tokenResponsePath,
    loginEndpointName: config.loginEndpointName,
  });

  console.log("→ Enriqueciendo con FormRequests…");
  const stats = await enrichCatalogWithFormRequests(collection, frIndex);

  console.log("\n→ Resultado del enriquecimiento:");
  console.log(`  · Variantes de body añadidas:   ${stats.bodyVariants}`);
  console.log(`  · Variantes de query añadidas:  ${stats.queryVariants}`);
  console.log(
    `  · Endpoints con body manual respetados: ${stats.skippedManualBody}`,
  );
  console.log(`  · Endpoints resueltos con FR: ${stats.resolved}`);
  console.log(`  · Endpoints sin FormRequest: ${stats.unresolved}`);
  if (stats.rulesWithUnknown.length > 0) {
    console.log(
      `  · FormRequests con reglas dinámicas: ${stats.rulesWithUnknown.length}`,
    );
    for (const r of stats.rulesWithUnknown.slice(0, 10)) {
      console.log(`      · ${r.formRequest}: ${r.unknown.join("; ")}`);
    }
  }

  const MAIN_PATH = await outputCollectionPath(config.name);
  const ENRICHED_PATH = await outputEnrichedPath(config.name);
  const outPath = inPlace ? MAIN_PATH : ENRICHED_PATH;
  const json = JSON.stringify(collection, null, 2);
  await writeFile(outPath, json + "\n", "utf8");
  const { requests, folders } = countItems(collection);
  const sizeKb = (json.length / 1024).toFixed(1);
  console.log(
    `\n✔ Colección ${inPlace ? "principal" : "enriquecida"} escrita en ${outPath}`,
  );
  console.log(
    `  · ${requests} requests in ${folders} folders (${sizeKb} KB).`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
