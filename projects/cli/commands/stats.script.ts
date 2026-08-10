/**
 * Estadísticas de la colección, agrupadas por zonas.
 *
 * Uso:
 *   bun scripts/stats.script.ts
 *   bun run stats
 *
 * `runStats` devuelve los recuentos y `main` los pinta, por el mismo
 * motivo que en `list` y `check`: el tool del plugin necesita los datos,
 * y una tabla alineada con `padEnd` es lo peor que se le puede dar a un
 * agente para que la parsee.
 */
import { explainReadFailure, readCollection } from "../../core/helpers/collection-file.helper.js";
import { zoneForUri, zonesToDisplay } from "../../core/helpers/zone.helper.js";
import { walkCollection } from "../../core/helpers/postman.helper.js";
import { outputCollectionPath } from "../../core/discovery/paths.service.js";
import { loadProject } from "../../core/discovery/project-loader.service.js";
import type {
  IStatsOutcome,
  IZoneStats,
} from "../../contracts/interfaces/cli/stats-outcome.interface.js";

interface ZoneStats {
  byMethod: Map<string, number>;
  byFolder: Map<string, number>;
}

/** Calcula las estadísticas y las devuelve, imprimiéndolas por el camino. */
export async function runStats(
  _argv: string[] = process.argv.slice(2),
): Promise<IStatsOutcome> {
  const { config } = await loadProject();
  const COLLECTION_PATH = await outputCollectionPath(config.name);

  const read = await readCollection(COLLECTION_PATH);
  if (!read.ok) {
    return { code: explainReadFailure(read), total: 0, byMethod: [], zones: [] };
  }
  const collection = read.collection;

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

  const porZona: IZoneStats[] = [];

  console.log("Por zona:");
  for (const zone of zonesToDisplay(zones.keys(), config)) {
    const s = zones.get(zone);
    if (!s) continue;
    const zoneTotal = [...s.byMethod.values()].reduce((a, b) => a + b, 0);
    if (zoneTotal === 0) continue;
    console.log(`\n─── ${zone} (${zoneTotal}) ───`);
    const sorted = [...s.byFolder.entries()].sort((a, b) => b[1] - a[1]);
    const maxFolder = Math.max(...sorted.map(([f]) => f.length), 10);
    for (const [f, n] of sorted) {
      console.log(`  ${f.padEnd(maxFolder + 2)}${String(n).padStart(4)}`);
    }
    porZona.push({
      zone,
      total: zoneTotal,
      byFolder: sorted.map(([folder, count]) => ({ folder, count })),
    });
  }
  console.log();

  return {
    code: 0,
    total: totalRequests,
    byMethod: methodsSorted.map(([method, count]) => ({ method, count })),
    zones: porZona,
  };
}

/** La envoltura que usa el CLI: solo el código de salida. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  return (await runStats(argv)).code;
}

if (import.meta.main) {
  process.exit(await main());
}
