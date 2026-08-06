#!/usr/bin/env bun
/**
 * Script: corre el flujo completo (scan → generate) sobre TODOS los
 * fixtures comprehensive y reporta un resumen agregado.
 *
 * IMPORTANTE: usa el pipeline in-process (sin spawn de subprocesos).
 * La versión anterior spawneaba un `bun` por fixture y reventaba la
 * RAM del host cuando había varios fixtures en paralelo.
 *
 * Uso:
 *   bun scripts/test-all.script.ts
 *
 * Output:
 *   - Tabla con framework / rutas / specs / con-FR / bodies / status.
 *   - Exit code 0 si todos pasan, 1 si alguno falla.
 */
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { resetPathCache } from "../services/paths.service.js";
import { defaultOrchestrator } from "../frameworks/framework.registry.js";
import { buildSpecsFromScanner } from "../services/adapters/parsed-route-to-spec.adapter.js";
import { loadProject } from "../services/project-loader.service.js";
import { applyAgnosticInference } from "../services/param-inferrer.service.js";
import { moduleDir } from "../helpers/module-path.helper.js";

const PROJECT_ROOT = resolve(moduleDir(import.meta.url), "..");
const FIXTURES_DIR = join(PROJECT_ROOT, "tests", "fixtures");

interface FixtureResult {
  readonly fixture: string;
  readonly routes: number;
  readonly specs: number;
  readonly conFR: number;
  readonly sinFR: number;
  readonly bodiesAuto: number;
  readonly queriesAuto: number;
  readonly durationMs: number;
  readonly ok: boolean;
  readonly error?: string;
}

async function listComprehensiveFixtures(): Promise<string[]> {
  const entries = await readdir(FIXTURES_DIR);
  return entries.filter((e) => e.endsWith("-comprehensive")).sort();
}

async function runFixture(fixture: string): Promise<FixtureResult> {
  const fixturePath = join(FIXTURES_DIR, fixture);
  const start = Date.now();

  const prevRoot = process.env["POSTMAN_PROJECT_ROOT"];
  process.env["POSTMAN_PROJECT_ROOT"] = fixturePath;
  resetPathCache();

  try {
    const orch = defaultOrchestrator();
    const { match, scanner, validation } = await orch.detectProject(fixturePath);

    let routeCount = 0;
    let withFR = 0;
    let withoutFR = 0;
    let specCount = 0;
    let bodiesAuto = 0;

    if (match && scanner && match.framework !== "laravel") {
      const result = await buildSpecsFromScanner(scanner, match, validation);
      routeCount = result.routes.length;
      withFR = result.withFormRequest;
      withoutFR = result.withoutFormRequest;
      specCount = result.specs.length;
      const inferStats = applyAgnosticInference([...result.specs]);
      bodiesAuto = inferStats.bodiesAdded;
    } else {
      const { config, manualEndpoints } = await loadProject();
      const { discoverEndpoints } = await import("../frameworks/laravel/endpoint-discovery.service.js");
      const discovered = await discoverEndpoints(config, manualEndpoints);
      routeCount = discovered.routes.length;
      withFR = discovered.withFormRequest;
      withoutFR = discovered.withoutFormRequest;
      specCount = discovered.specs.length;
      const inferStats = applyAgnosticInference([...discovered.specs]);
      bodiesAuto = inferStats.bodiesAdded;
    }

    return {
      fixture,
      routes: routeCount,
      specs: specCount,
      conFR: withFR,
      sinFR: withoutFR,
      bodiesAuto,
      queriesAuto: 0,
      durationMs: Date.now() - start,
      ok: true,
    };
  } catch (err) {
    return {
      fixture,
      routes: 0,
      specs: 0,
      conFR: 0,
      sinFR: 0,
      bodiesAuto: 0,
      queriesAuto: 0,
      durationMs: Date.now() - start,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (prevRoot === undefined) {
      delete process.env["POSTMAN_PROJECT_ROOT"];
    } else {
      process.env["POSTMAN_PROJECT_ROOT"] = prevRoot;
    }
    resetPathCache();
  }
}

function printTable(results: ReadonlyArray<FixtureResult>): void {
  const cols = [
    { header: "Fixture", width: 32 },
    { header: "Routes", width: 8, align: "right" as const },
    { header: "Specs", width: 8, align: "right" as const },
    { header: "ConFR", width: 8, align: "right" as const },
    { header: "SinFR", width: 8, align: "right" as const },
    { header: "Bodies", width: 8, align: "right" as const },
    { header: "Time", width: 10, align: "right" as const },
    { header: "Status", width: 8 },
  ];
  const pad = (s: string, w: number, align: "left" | "right" = "left") =>
    align === "right" ? s.padStart(w) : s.padEnd(w);
  const sep = cols.map((c) => "-".repeat(c.width)).join("-+-");
  const header = cols.map((c) => pad(c.header, c.width, c.align ?? "left")).join(" | ");
  console.log(header);
  console.log(sep);
  for (const r of results) {
    const row = [
      pad(r.fixture, 32),
      pad(String(r.routes), 8, "right"),
      pad(String(r.specs), 8, "right"),
      pad(String(r.conFR), 8, "right"),
      pad(String(r.sinFR), 8, "right"),
      pad(String(r.bodiesAuto), 8, "right"),
      pad(`${r.durationMs}ms`, 10, "right"),
      pad(r.ok ? "✓" : "✗ " + (r.error?.slice(0, 30) ?? ""), 8),
    ];
    console.log(row.join(" | "));
  }
  console.log(sep);
}

async function main(): Promise<number> {
  const fixtures = await listComprehensiveFixtures();
  if (fixtures.length === 0) {
    console.log("No hay fixtures comprehensive. Crea al menos uno en tests/fixtures/*-comprehensive.");
    return 0;
  }
  console.log(`→ Ejecutando ${fixtures.length} fixtures comprehensive (in-process)...\n`);
  const results: FixtureResult[] = [];
  for (const f of fixtures) {
    process.stderr.write(`[run] ${f}...`);
    const r = await runFixture(f);
    process.stderr.write(` ${r.ok ? "ok" : "FAIL"} (${r.durationMs}ms)\n`);
    results.push(r);
  }
  console.log();
  printTable(results);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} fixtures OK`);
  if (failed.length > 0) {
    console.log(`\nFAILED: ${failed.map((r) => r.fixture).join(", ")}`);
    return 1;
  }
  return 0;
}

process.exit(await main());
