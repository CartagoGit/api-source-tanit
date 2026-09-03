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
import {
  endpointKey,
  needsNameToDisambiguate,
} from "../../core/helpers/route-identity.helper.js";
import { walkCollection } from "../../core/helpers/postman.helper.js";
import { outputCollectionPath } from "../../core/discovery/output-paths.helper.js";
import { resolveProjectContext } from "../../core/discovery/project-context.service.js";
import { loadProject } from "../../core/discovery/project-loader.service.js";
import type { IProjectContext } from "../../contracts/interfaces/core/project-context.interface.js";
import type { PostmanCollection } from "../../contracts/interfaces/core/postman.interface.js";
import { defaultOrchestrator } from "../../frameworks/framework.registry.js";
import type { ICheckOutcome, ICheckReport } from "../../contracts/interfaces/cli/command-outcomes.interface.js";

/** Comprueba la deriva y devuelve el informe. `main` es quien lo pinta. */
export async function runCheck(
  argv: string[] = process.argv.slice(2),
  context?: IProjectContext,
): Promise<ICheckOutcome> {
  const resolvedContext = context ?? resolveProjectContext({ argv });
  const { config } = await loadProject(argv, resolvedContext);
  const outputIdx = argv.indexOf("--output");
  const outputFlag = outputIdx !== -1 ? argv[outputIdx + 1] ?? null : null;
  const COLLECTION_PATH = outputFlag
    ? outputFlag
    : await outputCollectionPath(resolvedContext, config.name);

  const orch = defaultOrchestrator();
  const root = resolvedContext.projectRoot;
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
   * Método y URI **no bastan siempre**. En REST la URL identifica la
   * operación, pero en RPC sobre POST no: GraphQL tiene un solo endpoint
   * y lo que distingue una consulta de otra es el nombre. Sin él, un
   * proyecto GraphQL de cinco operaciones se contaba como **una**, y
   * entonces `check` no podía detectar deriva ninguna.
   *
   * Pero meter el nombre **siempre** rompe el caso contrario, y eso es
   * lo que pasaba: en REST el scanner no emite `displayName`, mientras
   * que la colección sí tiene nombre de request —«Get Orders», derivado
   * de la URI por el constructor—. Las dos claves salían distintas para
   * el mismo endpoint, así que `GET /api/orders`, sin un solo parámetro,
   * aparecía a la vez en «falta» y en «sobra».
   *
   * Se midió: **13 de 22 ejemplos** reportaban deriva total sobre una
   * colección recién generada.
   *
   * La decisión no es por framework: es una propiedad de las rutas que
   * llegan. `needsNameToDisambiguate` mira si dos comparten método y
   * URI; si ninguna lo hace, el nombre es ruido y se queda fuera de los
   * dos lados. Es la misma pregunta que ya se hacía el pipeline, hecha
   * una vez aquí en lugar de suponerse.
   */
  const sourceRoutes: Array<{ method: string; uri: string; name?: string }> = [];

  if (match && scanner) {
    // El scanner del orchestrator, el mismo que usa `generate`.
    //
    // Antes había una rama `match.framework !== "laravel"` que mandaba a
    // Laravel al camino legacy, y ese encuentra 7 rutas donde el
    // pipeline encuentra 17: `check` no comparaba la colección contra lo
    // que `generate` ve, sino contra otra heurística. Es la divergencia
    // que ya tuvo `summary`, y `check` no puede tener una excepción para
    // uno de los veintiún frameworks.
    for (const r of (await scanner.scan(match)).routes) {
      sourceRoutes.push({
        method: r.method,
        uri: r.uri,
        ...(r.displayName ? { name: r.displayName } : {}),
      });
    }
    console.log(`(source: ${match.framework} via orchestrator)`);
  } else {
    // Sin scanner que reconozca el proyecto queda la heurística de
    // Laravel, que es lo único que había antes de que existieran los
    // scanners.
    for (const r of await parseAllRoutes(config.filePrefixes, resolvedContext)) {
      sourceRoutes.push({ method: r.method, uri: stripApiPrefix(r.uri) });
    }
    console.log("(source: legacy heuristic — no scanner matched)");
  }

  if (!existsSync(COLLECTION_PATH)) {
    console.error(
      `✘ Collection not found at "${COLLECTION_PATH}". Run \`generate\` first.`,
    );
    return { code: 1, report: null };
  }

  const raw = await readFile(COLLECTION_PATH, "utf8");
  const collection = JSON.parse(raw) as PostmanCollection;
  const collRequests = [...walkCollection(collection)].map((r) => ({
    method: r.method,
    uri: r.uri,
    name: r.name,
  }));

  /**
   * ¿Hace falta el nombre para distinguir?
   *
   * Se pregunta **solo sobre la fuente**, y esa asimetría es
   * deliberada. La fuente es el código: si dos rutas comparten método y
   * URI ahí, el protocolo es RPC sobre POST y el nombre es lo único que
   * las separa —GraphQL, tRPC—.
   *
   * La colección no sirve para decidirlo porque tiene **variantes**: el
   * enricher emite el mismo endpoint dos veces con cuerpos distintos
   * («base» y «Mínimo (solo required)»), y eso no son dos operaciones,
   * es una con dos ejemplos. Preguntárselo a ella daba `true` en
   * Laravel y metía el nombre en la clave de los dos lados; como la
   * fuente REST no emite nombre, los 17 endpoints salían como «faltan»
   * y los 18 como «sobran».
   */
  const conNombre = needsNameToDisambiguate(sourceRoutes);

  const clave = (r: { method: string; uri: string; name?: string }): string =>
    endpointKey(conNombre ? r : { method: r.method, uri: r.uri });

  for (const r of sourceRoutes) {
    const key = clave(r);
    sourceKeys.add(key);
    sourceMap.set(key, r);
  }

  const collKeys = new Set<string>();
  const collMap = new Map<string, { method: string; uri: string; name?: string }>();
  for (const r of collRequests) {
    const key = clave(r);
    collKeys.add(key);
    collMap.set(key, r);
  }

  const onlyInSource = [...sourceKeys]
    .filter((k) => !collKeys.has(k) && !k.endsWith("GET auth-test"))
    .sort();
  const onlyInColl = [...collKeys].filter((k) => !sourceKeys.has(k)).sort();

  console.log(`Routes en source:        ${sourceKeys.size}`);
  console.log(`Requests in collection:  ${collKeys.size}`);
  console.log();

  const informe: ICheckReport = {
    inSync: onlyInSource.length === 0 && onlyInColl.length === 0,
    routesInSource: sourceKeys.size,
    requestsInCollection: collKeys.size,
    missingInCollection: onlyInSource.map((k) => sourceMap.get(k)!),
    missingInSource: onlyInColl.map((k) => collMap.get(k)!),
  };

  if (informe.inSync) {
    console.log("✔ Collection is in sync with the source code.");
    return { code: 0, report: informe };
  }

  if (onlyInSource.length > 0) {
    console.log(`✘ Missing from the collection (${onlyInSource.length}):`);
    for (const k of onlyInSource) {
      const ep = sourceMap.get(k)!;
      console.log(`    ${ep.method.padEnd(6)} ${withLeadingSlash(ep.uri)}${ep.name ? `  (${ep.name})` : ""}`);
    }
    console.log();
  }
  if (onlyInColl.length > 0) {
    console.log(`✘ Not in the source code (${onlyInColl.length}):`);
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
