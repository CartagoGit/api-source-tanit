/**
 * Collection statistics, grouped by zone.
 *
 * Usage:
 *   bun scripts/stats.script.ts
 *   bun run stats
 *
 * `runStats` returns the counts and `main` prints them, for the same
 * reason as in `list` and `check`: the plugin tool needs the data,
 * and a `padEnd`-aligned table is the worst thing to hand an agent
 * to parse.
 */
import { explainReadFailure, readCollection } from "../../core/helpers/collection-file.helper.js";
import { zoneForUri, zonesToDisplay } from "../../core/helpers/zone.helper.js";
import { walkCollection } from "../../core/helpers/postman.helper.js";
import { outputCollectionPath } from "../../core/discovery/output-paths.helper.js";
import { resolveProjectContext } from "../../core/discovery/project-context.service.js";
import { loadProject } from "../../core/discovery/project-loader.service.js";
import type { IProjectContext } from "../../contracts/interfaces/core/project-context.interface.js";
import type {
  IStatsOutcome,
  IZoneStats,
} from "../../contracts/interfaces/cli/stats-outcome.interface.js";

interface ZoneStats {
  byMethod: Map<string, number>;
  byFolder: Map<string, number>;
}

/** Calculates the statistics and returns them, printing them along the way. */
export async function runStats(
  argv: string[] = process.argv.slice(2),
  context?: IProjectContext,
): Promise<IStatsOutcome> {
  const resolvedContext = context ?? resolveProjectContext({ argv });
  const { config } = await loadProject(argv, resolvedContext);
  const COLLECTION_PATH = await outputCollectionPath(resolvedContext, config.name);

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

  console.log("→ Postman collection stats");
  console.log(`Total requests: ${totalRequests}\n`);

  console.log("By HTTP method (global):");
  const methodsSorted = [...totalByMethod.entries()].sort(
    (a, b) => b[1] - a[1],
  );
  for (const [m, n] of methodsSorted) {
    console.log(`  ${m.padEnd(8)} ${String(n).padStart(4)}`);
  }
  console.log();

  const porZona: IZoneStats[] = [];

  console.log("By zone:");
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

/** The wrapper used by the CLI: only the exit code. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  return (await runStats(argv)).code;
}

if (import.meta.main) {
  process.exit(await main());
}
