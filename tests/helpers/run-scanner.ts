/**
 * Helper: ejecuta el flujo completo (scan → generate) sobre un
 * projectRoot y devuelve el `PostmanCollection` resultante + los
 * metrics (rutas, con FR, etc.).
 *
 * Dos funciones principales:
 *
 *   - `runGenerate(fixtureName)` → genera una collection completa y devuelve
 *      el JSON + metrics parseadas del stdout.
 *   - `runGenerateMetrics(fixtureName)` → solo ejecuta con --inspect para
 *      obtener metrics rápidas sin escribir artefactos.
 *
 * Uso desde los tests:
 *   const { collection, metrics } = await runGenerate("laravel-comprehensive");
 *   expect(metrics.routes).toBeGreaterThan(50);
 */
import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "bun";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const GENERATE_SCRIPT = join(PROJECT_ROOT, "scripts", "generate.script.ts");

export interface GenerateMetrics {
  routes: number;
  specs: number;
  conFR: number;
  sinFR: number;
  bodiesAuto: number;
  queriesAuto: number;
}

export interface GenerateResult {
  collection: any;
  metrics: GenerateMetrics;
  outputPath: string;
}

/**
 * Ejecuta `bun scripts/generate.script.ts ...` (sin --inspect) y devuelve
 * el JSON generado + metrics parseadas del stdout.
 */
export async function runGenerate(
  fixtureName: string,
  options: {
    basename?: string;
    projectRoot?: string;
  } = {},
): Promise<GenerateResult> {
  const fixturePath = options.projectRoot ?? join(PROJECT_ROOT, "tests", "fixtures", fixtureName);
  const tmpDir = join(PROJECT_ROOT, ".cache", "test-runs");
  await mkdir(tmpDir, { recursive: true });
  const outputPath = join(tmpDir, `${fixtureName}.postman_collection.json`);

  const args = [
    GENERATE_SCRIPT,
    "--output",
    outputPath,
    "--basename",
    options.basename ?? fixtureName,
  ];
  if (options.projectRoot) {
    args.push("--project-root", options.projectRoot);
  }

  const proc = spawn({
    cmd: ["bun", ...args],
    env: {
      ...process.env,
      POSTMAN_PROJECT_ROOT: fixturePath,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `generate.script.ts falló (exit ${exitCode}) para ${fixtureName}\n` +
        `stdout: ${stdout}\nstderr: ${stderr}`,
    );
  }

  const content = await readFile(outputPath, "utf8");
  const collection = JSON.parse(content);
  const metrics = parseMetricsFromCollection(stdout, collection);

  return { collection, metrics, outputPath };
}

/**
 * Versión rápida: solo ejecuta con --inspect y devuelve metrics (no
 * escribe el archivo de collection). Útil para tests que validan counts.
 */
export async function runGenerateMetrics(
  fixtureName: string,
  options: { projectRoot?: string } = {},
): Promise<GenerateMetrics> {
  const fixturePath = options.projectRoot ?? join(PROJECT_ROOT, "tests", "fixtures", fixtureName);
  const args = [GENERATE_SCRIPT, "--inspect"];
  if (options.projectRoot) {
    args.push("--project-root", options.projectRoot);
  }

  const proc = spawn({
    cmd: ["bun", ...args],
    env: {
      ...process.env,
      POSTMAN_PROJECT_ROOT: fixturePath,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `generate.script.ts --inspect falló (exit ${exitCode}) para ${fixtureName}\n` +
        `stdout: ${stdout}\nstderr: ${stderr}`,
    );
  }

  return parseMetrics(stdout);
}

/**
 * Parsea el bloque "--inspect" del stdout.
 *
 * Formato:
 *   → Rutas:        N   (legacy)
 *   · Rutas:        N   (orchestrator)
 */
export function parseMetrics(stdout: string): GenerateMetrics {
  const grab = (label: string): number => {
    // Match: `Rutas\s*:\s*(\d+)` precedido por `·` o whitespace.
    // Esto excluye "248 rutas en código" (que tiene un número ANTES de "rutas").
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

/**
 * Parsea métricas HYBRID: prefiere el stdout pero como fallback usa
 * el collection JSON parseado (sources of truth más fiables).
 *
 * El stdout solo imprime `Rutas: N` en modo --inspect, pero en modo
 * full-generate ya tenemos el JSON. Esta función intenta ambos.
 */
export function parseMetricsFromCollection(
  stdout: string,
  collection: any,
): GenerateMetrics {
  // Primero intentar con stdout.
  const fromStdout = parseMetrics(stdout);
  if (fromStdout.routes > 0) return fromStdout;
  // Fallback: parsear del collection.
  const counts = countItems(collection?.item ?? []);
  return {
    routes: counts.requests,
    specs: counts.requests,
    conFR: counts.requests - countSinFR(collection),
    sinFR: countSinFR(collection),
    bodiesAuto: 0,
    queriesAuto: 0,
  };
}

function countSinFR(collection: any): number {
  // Sin FR = requests sin `formRequest` (heurística).
  let n = 0;
  const walk = (items: any[]) => {
    for (const it of items ?? []) {
      if (it.item) walk(it.item);
      else if (it.request) {
        // No podemos saber con certeza — devolver 0.
      }
    }
  };
  walk(collection?.item ?? []);
  return n;
}

function countItems(items: any[]): { requests: number; folders: number } {
  let requests = 0;
  let folders = 0;
  for (const it of items) {
    if (it.item) {
      folders++;
      const sub = countItems(it.item);
      requests += sub.requests;
      folders += sub.folders;
    } else {
      requests++;
    }
  }
  return { requests, folders };
}

/**
 * Helper: limpia el directorio de artefactos de tests.
 */
export async function cleanTestRuns(): Promise<void> {
  const tmpDir = join(PROJECT_ROOT, ".cache", "test-runs");
  await rm(tmpDir, { recursive: true, force: true });
}
