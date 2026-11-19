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
import { computeCollectionStats } from "../../core/domain/collection-stats.service.js";
import { outputCollectionPath } from "../../core/discovery/output-paths.helper.js";
import { resolveProjectContext } from "../../core/discovery/project-context.service.js";
import { loadProject } from "../../core/discovery/project-loader.service.js";
import type { IProjectContext } from "../../contracts/interfaces/core/project-context.interface.js";
import type {
  IStatsOutcome,
  IZoneStats,
} from "../../contracts/interfaces/cli/stats-outcome.interface.js";

/**
 * The counting lives in the core (`collection-stats.service.ts`), so
 * the CLI and the Application API measure the same collection the
 * same way. What is left here is what only the CLI does: find the
 * file and print the answer.
 */

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

  const stats = computeCollectionStats(collection, config, COLLECTION_PATH);

  console.log("→ Postman collection stats");
  console.log(`Total requests: ${stats.total}\n`);

  console.log("By HTTP method (global):");
  for (const entry of stats.byMethod) {
    console.log(`  ${entry.method.padEnd(8)} ${String(entry.count).padStart(4)}`);
  }
  console.log();

  const porZona: IZoneStats[] = [];

  console.log("By zone:");
  for (const zone of stats.zones) {
    console.log(`\n─── ${zone.zone} (${zone.total}) ───`);
    const maxFolder = Math.max(...zone.byFolder.map((entry) => entry.folder.length), 10);
    for (const entry of zone.byFolder) {
      console.log(`  ${entry.folder.padEnd(maxFolder + 2)}${String(entry.count).padStart(4)}`);
    }
    porZona.push({
      zone: zone.zone,
      total: zone.total,
      byFolder: zone.byFolder.map((entry) => ({ folder: entry.folder, count: entry.count })),
    });
  }
  console.log();

  return {
    code: 0,
    total: stats.total,
    byMethod: stats.byMethod.map((entry) => ({ method: entry.method, count: entry.count })),
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
