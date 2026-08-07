/**
 * Re-enriquece la colección reconstruyendo desde discovery + FormRequests.
 *
 * Uso:
 *   bun scripts/enrich.script.ts
 *   bun scripts/enrich.script.ts --in-place
 *   bun scripts/enrich.script.ts --config ./examples/example-app/config.constant.ts
 */
import { writeFile } from "node:fs/promises";
import { buildCollection } from "../../core/domain/collection-builder.service.js";
import { applyAuthFlow } from "../../core/domain/auth-flow.service.js";
import { enrichCatalogWithFormRequests } from "../../frameworks/laravel/catalog-enricher.service.js";
import { discoverEndpoints } from "../../frameworks/laravel/endpoint-discovery.service.js";
import { loadProject } from "../../core/discovery/project-loader.service.js";
import {
  outputCollectionPath,
  outputEnrichedPath,
} from "../../core/discovery/paths.service.js";
import { countItems } from "../../core/helpers/postman.helper.js";
import { normalizeForComparison } from "../../core/helpers/uri.helper.js";

export async function main(_argv: string[] = process.argv.slice(2)): Promise<number> {
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

  // Sin esto, `enrich --in-place` **destruía** la colección.
  //
  // Este comando descubre por el camino legacy de Laravel, no por el
  // registro de scanners, así que en los otros veinte frameworks
  // `discovered.specs` sale vacío. Y aquí abajo se escribía igual: una
  // colección de 27 KB con nueve requests quedaba en 502 bytes con
  // ninguna, sobre el fichero bueno, imprimiendo un ✔ y saliendo con 0.
  //
  // Escribir cero endpoints no es un resultado, es haber fallado al
  // descubrirlos. La decisión de qué hacer con este comando —hacerlo
  // agnóstico o retirarlo, porque `generate` ya enriquece igual— está
  // en la auditoría; esto solo impide que mientras tanto se pierda
  // trabajo.
  if (discovered.specs.length === 0) {
    console.error("\n✗ El descubrimiento no encontró ningún endpoint: no se escribe nada.");
    console.error(`  · '${outPath}' se queda como estaba.`);
    console.error(
      "  · `enrich` hoy solo descubre proyectos Laravel. Para el resto, `generate`\n" +
        "    aplica el mismo enriquecimiento de reglas y sí usa todos los scanners.",
    );
    return 1;
  }

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
