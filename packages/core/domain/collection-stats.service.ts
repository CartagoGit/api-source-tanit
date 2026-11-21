/**
 * How many requests a collection carries, and where they live.
 *
 * ## Why this lives here and not in the CLI
 *
 * The counts were computed inside
 * `packages/cli/commands/stats.script.ts`, which meant the app could
 * not show them. The app's screen for statistics had nothing to call,
 * so it was one of the four operations the parity gate reported as a
 * **gap**: the CLI could, the app could not.
 *
 * Now the counting is a service and both faces call it. The numbers
 * the app shows are the numbers the CLI prints, because there is only
 * one function that counts.
 */
import { walkCollection } from "../helpers/postman.helper.js";
import { zoneForUri, zonesToDisplay } from "../helpers/zone.helper.js";
import type { ProjectConfig } from "../../contracts/interfaces/core/project-config.interface.js";
import type { PostmanCollection } from "../../contracts/interfaces/core/postman.interface.js";
import type {
  IFolderCount,
  IMethodCount,
  IStatsResult,
  IZoneStats,
} from "../../contracts/interfaces/core/application-api.interface.js";

/** The counters of one zone. */
interface IZoneCounters {
  readonly byMethod: Map<string, number>;
  readonly byFolder: Map<string, number>;
}

/**
 * Counts the requests of a collection, per method and per zone.
 *
 * @param collection The collection to measure.
 * @param config The project's configuration: its zones and their order.
 * @param collectionPath Where the collection came from, for the report.
 * @returns The totals, the per-method counts and the per-zone breakdown.
 */
export function computeCollectionStats(
  collection: PostmanCollection,
  config: ProjectConfig,
  collectionPath: string,
): IStatsResult {
  const zones = new Map<string, IZoneCounters>();
  for (const zone of config.zoneOrder) {
    zones.set(zone, { byMethod: new Map(), byFolder: new Map() });
  }
  if (!zones.has(config.defaultZone)) {
    zones.set(config.defaultZone, { byMethod: new Map(), byFolder: new Map() });
  }

  for (const request of walkCollection(collection)) {
    const topFolder = request.folder.split(" > ")[0] ?? request.folder;
    const zone = zoneForUri(request.uri, config);
    const counters = zones.get(zone) ?? zones.get(config.defaultZone);
    if (!counters) continue;
    counters.byMethod.set(request.method, (counters.byMethod.get(request.method) ?? 0) + 1);
    counters.byFolder.set(topFolder, (counters.byFolder.get(topFolder) ?? 0) + 1);
  }

  const totalByMethod = new Map<string, number>();
  let total = 0;
  for (const counters of zones.values()) {
    for (const [method, count] of counters.byMethod) {
      totalByMethod.set(method, (totalByMethod.get(method) ?? 0) + count);
      total += count;
    }
  }

  const byMethod: ReadonlyArray<IMethodCount> = [...totalByMethod.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([method, count]) => ({ method, count }));

  const zoneStats: IZoneStats[] = [];
  for (const zone of zonesToDisplay(zones.keys(), config)) {
    const counters = zones.get(zone);
    if (!counters) continue;
    const zoneTotal = [...counters.byMethod.values()].reduce((a, b) => a + b, 0);
    if (zoneTotal === 0) continue;
    const byFolder: ReadonlyArray<IFolderCount> = [...counters.byFolder.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([folder, count]) => ({ folder, count }));
    zoneStats.push({ zone, total: zoneTotal, byFolder });
  }

  return { total, byMethod, zones: zoneStats, collectionPath };
}
