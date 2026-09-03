/**
 * Imprime la lista plana de endpoints contenidos en la colección,
 * agrupados por zonas con cabecera de separación `─── Zona ───`.
 *
 * Uso:
 *   bun scripts/list-endpoints.script.ts
 *   bun run list
 */
import { explainReadFailure, readCollection } from "../../core/helpers/collection-file.helper.js";
import { zoneForUri, zonesToDisplay } from "../../core/helpers/zone.helper.js";
import { walkCollection } from "../../core/helpers/postman.helper.js";
import { outputCollectionPath } from "../../core/discovery/output-paths.helper.js";
import { resolveProjectContext } from "../../core/discovery/project-context.service.js";
import { loadProject } from "../../core/discovery/project-loader.service.js";
import type { IProjectContext } from "../../contracts/interfaces/core/project-context.interface.js";
import type { IListOutcome } from "../../contracts/interfaces/cli/command-outcomes.interface.js";

/**
 * Lista los endpoints y los devuelve.
 *
 * `main` es la envoltura que los pinta. Se separa por el mismo motivo
 * que en `generate` y `check`: el tool del plugin necesita **los
 * datos**, y parsear la tabla con regex se rompe el día que cambie una
 * columna.
 */
export async function runList(
  argv: string[] = process.argv.slice(2),
  context?: IProjectContext,
): Promise<IListOutcome> {
  const resolvedContext = context ?? resolveProjectContext({ argv });
  const { config } = await loadProject(argv, resolvedContext);
  const COLLECTION_PATH = await outputCollectionPath(resolvedContext, config.name);

  const read = await readCollection(COLLECTION_PATH);
  if (!read.ok) return { code: explainReadFailure(read), endpoints: [] };
  const collection = read.collection;

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
    `${rows.length} endpoints in the collection, grouped by zone:\n`,
  );

  const conContenido = [...byZone.entries()]
    .filter(([, items]) => items.length > 0)
    .map(([zone]) => zone);
  for (const zone of zonesToDisplay(conContenido, config)) {
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
  return { code: 0, endpoints: rows };
}

/** La envoltura que usa el CLI: solo el código de salida. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  return (await runList(argv)).code;
}

if (import.meta.main) {
  process.exit(await main());
}
