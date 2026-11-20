export const COVERAGE_METRICS = ["lines", "statements", "functions", "branches"] as const;

export const COVERAGE_THRESHOLDS = {
  global: { lines: 80, statements: 80, functions: 80, branches: 80 },
  core: { lines: 90, statements: 90, functions: 90, branches: 90 },
  frameworks: { lines: 75, statements: 75, functions: 75, branches: 75 },
  cli: { lines: 70, statements: 70, functions: 70, branches: 70 },
} as const;

export type CoverageScope = keyof typeof COVERAGE_THRESHOLDS;

export const ANGULAR_COVERAGE_SOURCE = "packages/app/src/app/**/*.ts";

// Floors from the separate Angular suite (72.81 / 70.00 / 69.55 / 53.55).
export const ANGULAR_COVERAGE_THRESHOLDS = { lines: 72, statements: 70, functions: 69, branches: 53 } as const;

/** Scope eligible state and presentation code. Entry, bridge and asset changes use full proof. */
export function isScopedAngularSource(file: string): boolean {
  return /^packages\/app\/src\/app\/(?:core\/state|features|shell)\/.+\.ts$/.test(file) && !file.endsWith(".d.ts");
}
