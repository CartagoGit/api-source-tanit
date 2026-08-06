/**
 * Imprime la lista plana de endpoints contenidos en la colección,
 * agrupados por zonas con cabecera de separación `─── Zona ───`.
 *
 * Uso:
 *   bun scripts/list-endpoints.script.ts
 *   bun run list
 */
import { readFile } from "node:fs/promises";
import type { PostmanCollection } from "../contracts/postman.interface.js";
import { zoneForUri } from "../helpers/zone.helper.js";
import { walkCollection } from "../helpers/postman.helper.js";
import { outputCollectionPath } from "../services/paths.service.js";
import { loadProject } from "../services/project-loader.service.js";

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { config } = await loadProject();
  const COLLECTION_PATH = await outputCollectionPath(config.name);

  const raw = await readFile(COLLECTION_PATH, "utf8");
  const collection = JSON.parse(raw) as PostmanCollection;

  const rows = walkCollection(collection).map((r) => ({
    ...r,
    zone: zoneForUri(r.uri, config),
  }));

  const byZone = new Map<string, typeof rows>();
  for (const z of config.zoneOrder) byZone.set(z, []);
  if (!byZone.has(config.defaultZone)) byZone.set(config.defaultZone, []);
  for (const r of rows) {
    const arr = byZone.get(r.zone) ?? byZone.get(config.defaultZone)!;
    arr.push(r);
  }
  for (const arr of byZone.values()) {
    arr.sort((a, b) => (a.uri + a.method).localeCompare(b.uri + b.method));
  }

  console.log(
    `${rows.length} endpoints en la colección, agrupados por zona:\n`,
  );

  for (const zone of config.zoneOrder) {
    const items = byZone.get(zone);
    if (!items || items.length === 0) continue;
    console.log(`─── ${zone} (${items.length}) ───`);
    for (const r of items) {
      console.log(
        `  ${r.method.padEnd(6)} /${r.uri}    [${r.folder}] ${r.name}`,
      );
    }
    console.log();
  }
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
