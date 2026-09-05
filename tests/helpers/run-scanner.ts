/**
 * Helper: runs the full flow (scan → generate) on a projectRoot and
 * returns the resulting `PostmanCollection` + metrics.
 *
 * IMPORTANT: all operations are **in-process** (no `spawn`). The
 * previous version spawned `bun scripts/generate.script.ts` per
 * test, which fired dozens of bun processes in parallel and blew
 * up the system memory. This helper calls the package's services
 * directly.
 *
 * Two main functions:
 *
 *   - `runGenerate(fixtureName)` → generates a full collection and
 *      returns the JSON + metrics without writing files.
 *   - `runGenerateMetrics(fixtureName)` → convenience alias (same result).
 */
import { join } from "node:path";
import { generateWithAllFrameworks } from "../../packages/frameworks/index";
import type { PostmanCollection } from "../../packages/contracts/interfaces/core/postman.interface";
import { REPO_ROOT } from "../../scripts/helpers/root.helper";

const PROJECT_ROOT = REPO_ROOT;

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
 * Runs the full pipeline in-process and returns the collection + metrics.
 * Does not write any file to disk.
 */
export async function runGenerate(
  fixtureName: string,
  options: {
    basename?: string;
    projectRoot?: string;
  } = {},
): Promise<GenerateResult> {
  const fixturePath =
    options.projectRoot ?? join(PROJECT_ROOT, "tests", "fixtures", fixtureName);
  return _runPipeline(fixtureName, fixturePath, options.basename);
}

async function _runPipeline(
  _fixtureName: string,
  fixturePath: string,
  basename?: string,
): Promise<GenerateResult> {
  // Same pipeline the CLI uses: the tests validate the real path,
  // not a parallel reimplementation that may diverge.
  const result = await generateWithAllFrameworks(fixturePath, {
    ...(basename ? { collectionName: basename } : {}),
  });

  return {
    collection: result.collection,
    outputPath: "",
    metrics: {
      routes: result.metrics.routes,
      specs: result.metrics.specs,
      conFR: result.metrics.withValidation,
      sinFR: result.metrics.withoutValidation,
      bodiesAuto: result.metrics.bodiesInferred,
      queriesAuto: result.metrics.queriesInferred,
    },
  };
}

/**
 * Alias: same semantics as `runGenerate`, exists for compat.
 */
export async function runGenerateMetrics(
  fixtureName: string,
  options: { projectRoot?: string } = {},
): Promise<GenerateMetrics> {
  const { metrics } = await runGenerate(fixtureName, options);
  return metrics;
}

/**
 * Parses the "--inspect" block from stdout (legacy, kept for
 * compat with any test that imports it).
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
  // No-op: we no longer write files to disk.
}

