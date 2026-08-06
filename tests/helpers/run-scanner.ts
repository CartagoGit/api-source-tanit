/**
 * Helper: ejecuta el flujo completo (scan → generate) sobre un
 * projectRoot y devuelve el `PostmanCollection` resultante + metrics.
 *
 * IMPORTANTE: todas las operaciones son **in-process** (sin `spawn`).
 * La versión anterior spawneaba `bun scripts/generate.script.ts` para
 * cada test, lo que disparaba decenas de procesos bun en paralelo y
 * reventaba la memoria del sistema.  Este helper llama directamente a
 * los servicios del paquete.
 *
 * Dos funciones principales:
 *
 *   - `runGenerate(fixtureName)` → genera una collection completa y devuelve
 *      el JSON + metrics sin escribir archivos.
 *   - `runGenerateMetrics(fixtureName)` → alias de conveniencia (mismo resultado).
 */
import { resolve, join } from "node:path";
import { resetPathCache } from "../../service/paths.service";
import { defaultOrchestrator } from "../../service/scanner-registry";
import { buildSpecsFromScanner } from "../../service/adapters/parsed-route-to-spec.adapter";
import { loadProject } from "../../service/project-loader.service";
import {
  applyAgnosticInference,
  inferCollectionVariables,
} from "../../service/param-inferrer.service";
import { buildCollection } from "../../service/collection-builder.service";
import type { EndpointSpec, PostmanCollection } from "../../contract/postman.interface";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");

export interface GenerateMetrics {
  routes: number;
  specs: number;
  conFR: number;
  sinFR: number;
  bodiesAuto: number;
  queriesAuto: number;
}

export interface GenerateResult {
  collection: PostmanCollection;
  metrics: GenerateMetrics;
  /** Siempre vacío — mantenemos la firma para compat con tests existentes. */
  outputPath: string;
}

/**
 * Ejecuta el pipeline completo en-proceso y devuelve la collection + metrics.
 * No escribe ningún archivo en disco.
 */
export async function runGenerate(
  fixtureName: string,
  options: {
    basename?: string;
    projectRoot?: string;
  } = {},
): Promise<GenerateResult> {
  const fixturePath = options.projectRoot
    ?? join(PROJECT_ROOT, "tests", "fixtures", fixtureName);

  // `paths.service` cachea `projectRoot()` en el proceso. Reseteamos
  // antes de cada llamada para que rutas distintas no mezclen su estado.
  const prevRoot = process.env["POSTMAN_PROJECT_ROOT"];
  process.env["POSTMAN_PROJECT_ROOT"] = fixturePath;
  resetPathCache();

  try {
    return await _runPipeline(fixtureName, fixturePath, options.basename);
  } finally {
    if (prevRoot === undefined) {
      delete process.env["POSTMAN_PROJECT_ROOT"];
    } else {
      process.env["POSTMAN_PROJECT_ROOT"] = prevRoot;
    }
    resetPathCache();
  }
}

async function _runPipeline(
  fixtureName: string,
  fixturePath: string,
  basename?: string,
): Promise<GenerateResult> {
  const orch = defaultOrchestrator();
  const { match, scanner, validation } = await orch.detectProject(fixturePath);

  let specs: EndpointSpec[];
  let routeCount: number;
  let withFR: number;
  let withoutFR: number;

  if (match && scanner) {
    // Camino A: el scanner del framework detectado (incluido Laravel).
    const result = await buildSpecsFromScanner(scanner, match, validation);
    const { manualEndpoints } = await loadProject();
    const { mergeWithManual } = await import("../../service/endpoint-discovery.service");
    specs = mergeWithManual([...result.specs], [...manualEndpoints]);
    routeCount = result.routes.length;
    withFR = result.withFormRequest;
    withoutFR = result.withoutFormRequest;
  } else {
    // Camino B: sin match → heurística zero-config legacy sobre routes/.
    const { config, manualEndpoints } = await loadProject();
    const { discoverEndpoints } = await import("../../service/endpoint-discovery.service");
    const discovered = await discoverEndpoints(config, manualEndpoints);
    specs = discovered.specs;
    routeCount = discovered.routes.length;
    withFR = discovered.withFormRequest;
    withoutFR = discovered.withoutFormRequest;
  }

  // Inferencia agnóstica (igual que generate.script.ts).
  const inferStats = applyAgnosticInference([...specs]);

  // Config para buildCollection.
  const { config: cfg } = await loadProject();
  if (!cfg.variables || cfg.variables.length === 0) {
    cfg.variables = inferCollectionVariables([...specs], []);
  }
  if (basename) cfg.collectionName = basename;

  const collection = buildCollection([...specs], cfg);

  return {
    collection,
    outputPath: "",
    metrics: {
      routes: routeCount,
      specs: specs.length,
      conFR: withFR,
      sinFR: withoutFR,
      bodiesAuto: inferStats.bodiesAdded,
      queriesAuto: inferStats.queriesAdded,
    },
  };
}

/**
 * Alias: misma semántica que `runGenerate`, existe para compat.
 */
export async function runGenerateMetrics(
  fixtureName: string,
  options: { projectRoot?: string } = {},
): Promise<GenerateMetrics> {
  const { metrics } = await runGenerate(fixtureName, options);
  return metrics;
}

/**
 * Parsea el bloque "--inspect" del stdout (legacy, mantenemos para
 * compat con cualquier test que lo importe).
 */
export function parseMetrics(stdout: string): GenerateMetrics {
  const grab = (label: string): number => {
    const re = new RegExp(`[·\\s]${label}\\s*:\\s*(\\d+)`);
    const m = re.exec(stdout);
    return m ? Number(m[1]) : 0;
  };
  return {
    routes: grab("Rutas"),
    specs: grab("Specs"),
    conFR: grab("Con FR"),
    sinFR: grab("Sin FR"),
    bodiesAuto: grab("Bodies auto"),
    queriesAuto: grab("Queries auto"),
  };
}

export function parseMetricsFromCollection(
  stdout: string,
  collection: PostmanCollection,
): GenerateMetrics {
  const fromStdout = parseMetrics(stdout);
  if (fromStdout.routes > 0) return fromStdout;
  const counts = _countItems(collection?.item ?? []);
  return {
    routes: counts.requests,
    specs: counts.requests,
    conFR: 0,
    sinFR: counts.requests,
    bodiesAuto: 0,
    queriesAuto: 0,
  };
}

function _countItems(items: PostmanCollection["item"]): { requests: number; folders: number } {
  let requests = 0;
  let folders = 0;
  for (const it of items) {
    if (it.item) {
      folders++;
      const sub = _countItems(it.item);
      requests += sub.requests;
      folders += sub.folders;
    } else {
      requests++;
    }
  }
  return { requests, folders };
}

export async function cleanTestRuns(): Promise<void> {
  // No-op: ya no escribimos archivos en disco.
}


