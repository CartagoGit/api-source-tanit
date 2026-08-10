/**
 * Compara las URIs declaradas en la colección Postman con las URIs reales
 * descubiertas en el código fuente. Imprime diff y sale con código distinto
 * de 0 si hay diferencias.
 *
 * Framework-agnostic: usa el `DiscoveryOrchestrator` para obtener el
 * "source" correcto. Si el orchestrator encuentra un match no-Laravel
 * (OpenAPI, Express, etc.), compara contra esas rutas en lugar de
 * `parseAllRoutes()` (Laravel).
 *
 * Uso:
 *   bun scripts/diff.script.ts
 *   bun run check
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parseAllRoutes } from "../../frameworks/laravel/route-parser.service.js";
import { stripApiPrefix } from "../../core/helpers/uri.helper.js";
import { endpointKey } from "../../core/helpers/route-identity.helper.js";
import { walkCollection } from "../../core/helpers/postman.helper.js";
import { outputCollectionPath, projectRoot } from "../../core/discovery/paths.service.js";
import { loadProject } from "../../core/discovery/project-loader.service.js";
import type { PostmanCollection } from "../../contracts/interfaces/core/postman.interface.js";
import { defaultOrchestrator } from "../../frameworks/framework.registry.js";
import type { ICheckOutcome, ICheckReport } from "../../contracts/interfaces/cli/command-outcomes.interface.js";

/** Comprueba la deriva y devuelve el informe. `main` es quien lo pinta. */
export async function runCheck(
  argv: string[] = process.argv.slice(2),
): Promise<ICheckOutcome> {
  const { config } = await loadProject();
  const outputIdx = argv.indexOf("--output");
  const outputFlag = outputIdx !== -1 ? argv[outputIdx + 1] ?? null : null;
  const COLLECTION_PATH = outputFlag
    ? outputFlag
    : await outputCollectionPath(config.name);

  const orch = defaultOrchestrator();
  const root = projectRoot() ?? ".";
  const { match, scanner } = await orch.detectProject(root);

  /**
   * Una sola barra al principio.
   *
   * Las URIs llegan de dos sitios —el scanner y la colección— y solo uno
   * de los dos las trae ya con barra. Prefijar a ciegas daba `//graphql`
   * justo en la lista que alguien lee para arreglar la deriva.
   */
  const withLeadingSlash = (uri: string): string =>
    uri.startsWith("/") ? uri : `/${uri}`;

  const sourceKeys = new Set<string>();
  const sourceMap = new Map<string, { method: string; uri: string; name?: string }>();

  /**
   * La clave con la que se compara una ruta.
   *
   * Método y URI **no bastan**. En REST la URL identifica la operación,
   * pero en RPC sobre POST no: GraphQL tiene un solo endpoint y lo que
   * distingue una consulta de otra es el nombre. Sin él, un proyecto
   * GraphQL de cinco operaciones se contaba como **una** — y entonces
   * `check` no podía detectar deriva ninguna: si cuatro desaparecían del
   * código, seguía diciendo 1 contra 1 y dando el visto bueno.
   *
   * Es la tercera vez que la misma suposición muerde: ya pasó en el
   * `dedupeSpecs` del pipeline y en el chequeo de duplicados de los
   * invariantes.
   */
  // La clave la construye `route-identity.helper`, que es la misma que
  // usa `dedupeSpecs`. Tenerla en dos sitios fue lo que dejó que las dos
  // divergieran: aquí ya llevaba el nombre y allí no.
  const comparisonKey = (method: string, uri: string, name?: string): string =>
    endpointKey({ method, uri, name });

  if (match && scanner && match.framework !== "laravel") {
    // Fuente: scanner del orchestrator (OpenAPI, etc.)
    const routes = await scanner.scan(match);
    for (const r of routes) {
      const key = comparisonKey(r.method, r.uri, r.displayName);
      sourceKeys.add(key);
      sourceMap.set(key, {
        method: r.method,
        uri: r.uri,
        ...(r.displayName ? { name: r.displayName } : {}),
      });
    }
    console.log(`(source: ${match.framework} via orchestrator)`);
  } else {
    // Fuente: Laravel legacy
    const routes = await parseAllRoutes(config.filePrefixes);
    for (const r of routes) {
      const uri = stripApiPrefix(r.uri);
      const key = endpointKey({ method: r.method, uri });
      sourceKeys.add(key);
      sourceMap.set(key, { method: r.method, uri });
    }
  }

  if (!existsSync(COLLECTION_PATH)) {
    console.error(`✘ No se encontró la colección en "${COLLECTION_PATH}". Ejecuta 'bun run build' primero para generarla.`);
    return { code: 1, report: null };
  }

  const raw = await readFile(COLLECTION_PATH, "utf8");
  const collection = JSON.parse(raw) as PostmanCollection;
  const collKeys = new Set<string>();
  const collMap = new Map<string, { method: string; uri: string; name?: string }>();

  for (const r of walkCollection(collection)) {
    // El nombre de la request en la colección es el `displayName` que
    // emitió el scanner, así que las dos claves se construyen igual.
    const key = comparisonKey(r.method, r.uri, r.name);
    collKeys.add(key);
    collMap.set(key, { method: r.method, uri: r.uri, ...(r.name ? { name: r.name } : {}) });
  }

  const onlyInSource = [...sourceKeys]
    .filter((k) => !collKeys.has(k) && !k.endsWith("GET auth-test"))
    .sort();
  const onlyInColl = [...collKeys].filter((k) => !sourceKeys.has(k)).sort();

  console.log(`Routes en source:        ${sourceKeys.size}`);
  console.log(`Requests en colección:   ${collKeys.size}`);
  console.log();

  const informe: ICheckReport = {
    inSync: onlyInSource.length === 0 && onlyInColl.length === 0,
    routesInSource: sourceKeys.size,
    requestsInCollection: collKeys.size,
    missingInCollection: onlyInSource.map((k) => sourceMap.get(k)!),
    missingInSource: onlyInColl.map((k) => collMap.get(k)!),
  };

  if (informe.inSync) {
    console.log("✔ Colección sincronizada con el código fuente.");
    return { code: 0, report: informe };
  }

  if (onlyInSource.length > 0) {
    console.log(`✘ Faltan en la colección (${onlyInSource.length}):`);
    for (const k of onlyInSource) {
      const ep = sourceMap.get(k)!;
      console.log(`    ${ep.method.padEnd(6)} ${withLeadingSlash(ep.uri)}${ep.name ? `  (${ep.name})` : ""}`);
    }
    console.log();
  }
  if (onlyInColl.length > 0) {
    console.log(`✘ Sobran en la colección (${onlyInColl.length}):`);
    for (const k of onlyInColl) {
      const ep = collMap.get(k)!;
      console.log(`    ${ep.method.padEnd(6)} ${withLeadingSlash(ep.uri)}${ep.name ? `  (${ep.name})` : ""}`);
    }
  }
  return { code: 1, report: informe };
}

/** La envoltura que usa el CLI: solo el código de salida. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  return (await runCheck(argv)).code;
}

if (import.meta.main) {
  process.exit(await main());
}
