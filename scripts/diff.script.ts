/**
 * Compara las URIs declaradas en la colección Postman con las URIs reales
 * descubiertas en `routes/*.php`. Imprime diff y sale con código distinto
 * de 0 si hay diferencias.
 *
 * Uso:
 *   bun scripts/diff.script.ts
 *   bun run check
 */
import { readFile } from "node:fs/promises";
import { parseAllRoutes } from "../service/route-parser.service.js";
import {
  normalizeForComparison,
  stripApiPrefix,
} from "../helper/uri.helper.js";
import { walkCollection } from "../helper/postman.helper.js";
import { outputCollectionPath } from "../service/paths.service.js";
import { loadProject } from "../service/project-loader.service.js";
import type { PostmanCollection } from "../contract/postman.interface.js";

async function main(): Promise<number> {
  const { config } = await loadProject();
  const COLLECTION_PATH = await outputCollectionPath(config.name);

  const routes = await parseAllRoutes(config.filePrefixes);
  const sourceKeys = new Set<string>();
  const sourceMap = new Map<string, { method: string; uri: string }>();
  for (const r of routes) {
    const uri = stripApiPrefix(r.uri);
    const key = `${r.method} ${normalizeForComparison(uri)}`;
    sourceKeys.add(key);
    sourceMap.set(key, { method: r.method, uri });
  }

  const raw = await readFile(COLLECTION_PATH, "utf8");
  const collection = JSON.parse(raw) as PostmanCollection;
  const collKeys = new Set<string>();
  const collMap = new Map<string, { method: string; uri: string }>();

  for (const r of walkCollection(collection)) {
    const key = `${r.method} ${normalizeForComparison(r.uri)}`;
    collKeys.add(key);
    collMap.set(key, { method: r.method, uri: r.uri });
  }

  const onlyInSource = [...sourceKeys]
    .filter((k) => !collKeys.has(k) && !k.endsWith("GET auth-test"))
    .sort();
  const onlyInColl = [...collKeys].filter((k) => !sourceKeys.has(k)).sort();

  console.log(`Routes en source:        ${sourceKeys.size}`);
  console.log(`Requests en colección:   ${collKeys.size}`);
  console.log();

  if (onlyInSource.length === 0 && onlyInColl.length === 0) {
    console.log("✔ Colección sincronizada con el código fuente.");
    return 0;
  }

  if (onlyInSource.length > 0) {
    console.log(`✘ Faltan en la colección (${onlyInSource.length}):`);
    for (const k of onlyInSource) {
      const ep = sourceMap.get(k)!;
      console.log(`    ${ep.method.padEnd(6)} /${ep.uri}`);
    }
    console.log();
  }
  if (onlyInColl.length > 0) {
    console.log(`✘ Sobran en la colección (${onlyInColl.length}):`);
    for (const k of onlyInColl) {
      const ep = collMap.get(k)!;
      console.log(`    ${ep.method.padEnd(6)} /${ep.uri}`);
    }
  }
  return 1;
}

process.exit(await main());
