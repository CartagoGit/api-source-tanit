export const COVERAGE_METRICS = ["lines", "statements", "functions", "branches"] as const;

export const COVERAGE_THRESHOLDS = {
  global: { lines: 80, statements: 80, functions: 80, branches: 80 },
  core: { lines: 90, statements: 90, functions: 90, branches: 90 },
  frameworks: { lines: 75, statements: 75, functions: 75, branches: 75 },
  cli: { lines: 70, statements: 70, functions: 70, branches: 70 },
} as const;

export type CoverageScope = keyof typeof COVERAGE_THRESHOLDS;