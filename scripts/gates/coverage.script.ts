#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

interface IMetric {
  total: number;
  covered: number;
  pct: number;
}

interface ICoverageSummary {
  readonly total?: Record<string, IMetric>;
  readonly [file: string]: Record<string, IMetric> | undefined;
}

interface IBaseline {
  readonly global: Record<string, number>;
  readonly core: Record<string, number>;
  readonly frameworks: Record<string, number>;
  readonly cli: Record<string, number>;
}

const METRICS = ["lines", "statements", "functions", "branches"] as const;
const SCOPES = ["global", "core", "frameworks", "cli"] as const;
const PREFIXES: Record<Exclude<(typeof SCOPES)[number], "global">, readonly string[]> = {
  core: ["/packages/core/", "packages/core/"],
  frameworks: ["/packages/frameworks/", "packages/frameworks/"],
  cli: ["/packages/cli/", "packages/cli/", "/packages/ui/", "packages/ui/", "/scripts/", "scripts/"],
};
const ROOT = resolve(import.meta.dir, "../..");
const SUMMARY_PATH = resolve(ROOT, "build/coverage/coverage-summary.json");
const BASELINE_PATH = resolve(ROOT, "tests/coverage-baseline.json");

function readJson<T>(path: string): T {
  if (!existsSync(path)) throw new Error(`coverage — falta ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function validateMetricRecord(scope: string, metrics: Record<string, number>): void {
  for (const metric of METRICS) {
    const value = metrics[metric];
    if (value === undefined || !Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`coverage — ${scope}.${metric} no es un porcentaje válido: ${value}`);
    }
  }
}

function emptyMetrics(): Record<string, IMetric> {
  return Object.fromEntries(METRICS.map((metric) => [metric, { total: 0, covered: 0, pct: 0 }])) as Record<
    string,
    IMetric
  >;
}

function aggregateScope(summary: ICoverageSummary, scope: Exclude<(typeof SCOPES)[number], "global">): Record<string, IMetric> {
  const aggregate = emptyMetrics();
  for (const [file, metrics] of Object.entries(summary)) {
    if (file === "total" || !metrics || !PREFIXES[scope].some((prefix) => file.includes(prefix))) continue;
    for (const metric of METRICS) {
      const target = aggregate[metric];
      if (!target) continue;
      target.total += metrics[metric]?.total ?? 0;
      target.covered += metrics[metric]?.covered ?? 0;
    }
  }
  for (const metric of METRICS) {
    const item = aggregate[metric];
    if (!item) continue;
    item.pct = item.total === 0 ? 0 : (item.covered / item.total) * 100;
  }
  return aggregate;
}

function main(): number {
  try {
    const summary = readJson<ICoverageSummary>(SUMMARY_PATH);
    const baseline = readJson<IBaseline>(BASELINE_PATH);
    const total = summary.total;
    if (!total) throw new Error(`coverage — falta total en ${SUMMARY_PATH}`);

    for (const metric of METRICS) {
      const actual = total[metric]?.pct;
      const expected = baseline.global[metric];
      if (actual === undefined || expected === undefined || !Number.isFinite(actual) || actual < expected) {
        throw new Error(`coverage — global.${metric} ${actual ?? "missing"}% < baseline ${expected}%`);
      }
    }

    for (const scope of SCOPES) {
      validateMetricRecord(scope, baseline[scope]);
      if (scope === "global") continue;
      const actual = aggregateScope(summary, scope);
      for (const metric of METRICS) {
        const aggregate = actual[metric];
        const expected = baseline[scope][metric];
        const value = aggregate?.pct;
        if (expected === undefined || aggregate === undefined || aggregate.total === 0 || value === undefined || !Number.isFinite(value) || value < expected) {
          throw new Error(`coverage — ${scope}.${metric} ${value ?? "missing"}% < baseline ${expected}%`);
        }
      }
    }

    console.log("coverage — global, core, frameworks y cli cumplen el baseline congelado");
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) process.exit(main());