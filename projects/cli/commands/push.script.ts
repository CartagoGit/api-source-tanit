#!/usr/bin/env bun
/**
 * `export-to-postman push` — sube la colección directamente a Postman.
 *
 * Evita el paso manual de Import: genera y publica en el workspace del
 * usuario mediante la API pública de Postman. Como el `_postman_id` es
 * determinista por proyecto, ejecutarlo dos veces **actualiza** la
 * colección en lugar de duplicarla.
 *
 * La API key se saca de `--api-key` o de `POSTMAN_API_KEY`, y nunca se
 * imprime ni se escribe en disco.
 */
import { resolveRoot } from "../../core/helpers/resolve-root.helper.js";
import { generateWithAllFrameworks } from "../../frameworks/index.js";
import { buildEnvironments, defaultEnvironments } from "../../core/domain/environment-builder.service.js";
import { PostmanApiError, pushCollection, pushEnvironment, verifyApiKey } from "../../core/domain/postman-api.service.js";
import { readFlag } from "../../core/helpers/argv.helper.js";

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const apiKey = readFlag(argv, "--api-key") ?? process.env["POSTMAN_API_KEY"] ?? "";
  if (!apiKey) {
    console.error("Missing Postman API key.\n");
    console.error("  export-to-postman push --api-key <key>");
    console.error("  POSTMAN_API_KEY=<key> export-to-postman push\n");
    console.error("Create one at https://postman.co/settings/me/api-keys");
    return 1;
  }

  const workspaceId = readFlag(argv, "--workspace") ?? undefined;
  const withEnvironments = !argv.includes("--no-environments");
  const options = { apiKey, workspaceId };

  // `push` **no leía `--project-root`**: usaba solo el singleton, así
  // que pasarle el flag no hacía nada. Ahora resuelve como los demás.
  const { root } = resolveRoot({ argv });
  if (!root) {
    console.error("Could not determine the project root.");
    console.error("Pass `--project-root <path>` or set POSTMAN_PROJECT_ROOT.");
    return 1;
  }

  try {
    const user = await verifyApiKey(options);
    console.log(`→ Signed in to Postman as ${user.username}`);
  } catch (err) {
    return reportApiError(err);
  }

  console.log("→ Scanning the project…");
  const basename = readFlag(argv, "--basename");
  // `--framework <id>` se salta la detección, igual que en `generate`.
  // Sin esto, quien necesita forzarlo podía generar los ficheros pero no
  // subirlos: el mismo proyecto funcionaba con un comando y no con el
  // otro, sin ninguna razón que se pudiera explicar.
  const forceFramework = readFlag(argv, "--framework");
  const result = await generateWithAllFrameworks(root, {
    ...(basename ? { collectionName: basename } : {}),
    ...(forceFramework ? { forceFramework } : {}),
  });

  const requestCount = countRequests(result.collection.item as IItem[]);
  if (requestCount === 0) {
    console.error("No endpoints were found, nothing to push.");
    console.error("Run `export-to-postman generate --inspect` to see what was detected.");
    return 1;
  }
  console.log(
    `  · ${result.match?.framework ?? "unknown"} · ${requestCount} requests`,
  );

  try {
    const pushed = await pushCollection(result.collection, options);
    console.log(
      `✔ Collection ${pushed.action}: "${pushed.name}"` +
        (pushed.uid ? ` (${pushed.uid})` : ""),
    );

    if (withEnvironments) {
      const environments = buildEnvironments(
        [...result.specs],
        result.config.variables,
        [...(result.config.environments ?? defaultEnvironments(result.config.baseUrl))],
        result.collection.info._postman_id ?? "",
      );
      for (const environment of environments) {
        const pushedEnv = await pushEnvironment(environment, options);
        console.log(`  · Environment ${pushedEnv.action}: "${pushedEnv.name}"`);
      }
    }
  } catch (err) {
    return reportApiError(err);
  }

  console.log("\nOpen Postman — the collection is already there.");
  return 0;
}

interface IItem {
  item?: IItem[];
}

function countRequests(items: ReadonlyArray<IItem>): number {
  return items.reduce((total, i) => total + (i.item ? countRequests(i.item) : 1), 0);
}

function reportApiError(err: unknown): number {
  if (err instanceof PostmanApiError) {
    console.error(`✗ ${err.message}`);
    if (err.detail) console.error(`  ${err.detail}`);
    return 1;
  }
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  return 1;
}

if (import.meta.main) {
  process.exit(await main());
}
