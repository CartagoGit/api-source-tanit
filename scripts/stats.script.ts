/**
 * Estadísticas de la colección, agrupadas por zonas.
 *
 * Uso:
 *   bun scripts/stats.script.ts
 *   bun run stats
 */
import { readFile } from "node:fs/promises";
import type { PostmanCollection } from "../contract/postman.interface.js";
import { zoneForUri } from "../helper/zone.helper.js";
import { walkCollection } from "../helper/postman.helper.js";
import { outputCollectionPath } from "../service/paths.service.js";
import { loadProject } from "../service/project-loader.service.js";

interface ZoneStats {
  byMethod: Map<string, number>;
  byFolder: Map<string, number>;
}

async function main(): Promise<number> {
  const { config } = await loadProject();
  const COLLECTION_PATH = await outputCollectionPath(config.name);

  const raw = await readFile(COLLECTION_PATH, "utf8");
  const collection = JSON.parse(raw) as PostmanCollection;

  const zones = new Map<string, ZoneStats>();
  for (const z of config.zoneOrder) {
    zones.set(z, { byMethod: new Map(), byFolder: new Map() });
  }
  if (!zones.has(config.defaultZone)) {
    zones.set(config.defaultZone, { byMethod: new Map(), byFolder: new Map() });
  }

  for (const r of walkCollection(collection)) {
    const topFolder = r.folder.split(" > ")[0] ?? r.folder;
    const z = zoneForUri(r.uri, config);
    const stats = zones.get(z) ?? zones.get(config.defaultZone)!;
    stats.byMethod.set(r.method, (stats.byMethod.get(r.method) ?? 0) + 1);
    stats.byFolder.set(topFolder, (stats.byFolder.get(topFolder) ?? 0) + 1);
  }

  const totalRequests = [...zones.values()]
    .flatMap((s) => [...s.byMethod.values()])
    .reduce((a, b) => a + b, 0);

  const totalByMethod = new Map<string, number>();
  for (const s of zones.values()) {
    for (const [m, n] of s.byMethod)
      totalByMethod.set(m, (totalByMethod.get(m) ?? 0) + n);
  }

  console.log("→ Estadísticas de la colección Postman");
  console.log(`Total requests: ${totalRequests}\n`);

  console.log("Por método HTTP (global):");
  const methodsSorted = [...totalByMethod.entries()].sort(
    (a, b) => b[1] - a[1],
  );
  for (const [m, n] of methodsSorted) {
    console.log(`  ${m.padEnd(8)} ${String(n).padStart(4)}`);
  }
  console.log();

  console.log("Por zona:");
  for (const zone of config.zoneOrder) {
    const s = zones.get(zone)!;
    const zoneTotal = [...s.byMethod.values()].reduce((a, b) => a + b, 0);
    if (zoneTotal === 0) continue;
    console.log(`\n─── ${zone} (${zoneTotal}) ───`);
    const sorted = [...s.byFolder.entries()].sort((a, b) => b[1] - a[1]);
    const maxFolder = Math.max(...sorted.map(([f]) => f.length), 10);
    for (const [f, n] of sorted) {
      console.log(`  ${f.padEnd(maxFolder + 2)}${String(n).padStart(4)}`);
    }
  }
  console.log();
  return 0;
}

process.exit(await main());
