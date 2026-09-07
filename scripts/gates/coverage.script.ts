#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface IMetric {
  total: number;
  covered: number;
  pct: number;
}

export interface ICoverageSummary {
  readonly total?: Record<string, IMetric>;
  readonly [file: string]: Record<string, IMetric> | undefined;
}

export interface IBaseline {
  readonly thresholds: Record<string, Record<string, number>>;
  readonly baseline: Record<string, Record<string, number>>;
}

const METRICS = ["lines", "statements", "functions", "branches"] as const;
const SCOPES = ["global", "core", "frameworks", "cli"] as const;
const PREFIXES: Record<Exclude<(typeof SCOPES)[number], "global">, readonly string[]> = {
  core: ["/packages/core/", "packages/core/"],
  frameworks: ["/packages/frameworks/", "packages/frameworks/"],
  cli: ["/packages/cli/", "packages/cli/", "/packages/ui/", "packages/ui/", "/scripts/", "scripts/"],
};
function getPaths(): { readonly summaryPath: string; readonly baselinePath: string } {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  return {
    summaryPath: resolve(root, "build/coverage/coverage-summary.json"),
    baselinePath: resolve(root, "tests/coverage-baseline.json"),
  };
}

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

export function aggregateScope(summary: ICoverageSummary, scope: Exclude<(typeof SCOPES)[number], "global">): Record<string, IMetric> {
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

export function evaluateCoverage(summary: ICoverageSummary, baseline: IBaseline): ReadonlyArray<string> {
  const failures: string[] = [];
  const total = summary.total;
  if (!total) return ["coverage — falta total en el resumen"];

  for (const metric of METRICS) {
    const actual = total[metric]?.pct;
    const threshold = baseline.thresholds.global?.[metric];
    const frozen = baseline.baseline.global?.[metric];
    if (actual === undefined || threshold === undefined || frozen === undefined || !Number.isFinite(actual)) {
      failures.push(`coverage — global.${metric} no tiene métricas completas`);
    } else if (actual < frozen || actual < threshold) {
      failures.push(`coverage — global.${metric} ${actual}% < baseline ${frozen}% o threshold ${threshold}%`);
    }
  }

  for (const scope of SCOPES) {
    if (scope === "global") continue;
    const thresholds = baseline.thresholds[scope];
    const frozenMetrics = baseline.baseline[scope];
    if (!thresholds || !frozenMetrics) {
      failures.push(`coverage — falta baseline para ${scope}`);
      continue;
    }
    const actual = aggregateScope(summary, scope);
    for (const metric of METRICS) {
      const aggregate = actual[metric];
      const threshold = thresholds[metric];
      const frozen = frozenMetrics[metric];
      const value = aggregate?.pct;
      if (threshold === undefined || frozen === undefined || aggregate === undefined || aggregate.total === 0 || value === undefined || !Number.isFinite(value)) {
        failures.push(`coverage — ${scope}.${metric} no tiene métricas completas`);
      } else if (value < frozen || value < threshold) {
        failures.push(`coverage — ${scope}.${metric} ${value}% < baseline ${frozen}% o threshold ${threshold}%`);
      }
    }
  }
  return failures;
}

function main(): number {
  try {
    const { summaryPath, baselinePath } = getPaths();
    const summary = readJson<ICoverageSummary>(summaryPath);
    const baseline = readJson<IBaseline>(baselinePath);
    for (const scope of SCOPES) {
      const thresholds = baseline.thresholds[scope];
      const frozenMetrics = baseline.baseline[scope];
      if (!thresholds || !frozenMetrics) throw new Error(`coverage — falta baseline para ${scope}`);
      validateMetricRecord(`${scope}.thresholds`, thresholds);
      validateMetricRecord(`${scope}.baseline`, frozenMetrics);
    }
    const failures = evaluateCoverage(summary, baseline);
    if (failures.length > 0) throw new Error(failures.join("\n"));

    console.log("coverage — global, core, frameworks y cli cumplen el baseline congelado");
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) process.exit(main());