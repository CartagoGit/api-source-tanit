#!/usr/bin/env bun

export const CI_JOBS = [
  "typecheck",
  "lint",
  "test-coverage",
  "validate-examples",
  "bench-check",
  "security-audit",
  "validate-package",
  "integration-verifier",
] as const;

export type CiJobStatus = "success" | "failure" | "cancelled" | "skipped";

export interface ICiSummaryOptions {
  readonly results: Readonly<Record<string, string | undefined>>;
  readonly summaryPath?: string;
}

export interface ICiSummaryResult {
  readonly ok: boolean;
  readonly failedJobs: ReadonlyArray<string>;
  readonly markdown: string;
}

export function summarizeCi(options: ICiSummaryOptions): ICiSummaryResult {
  const statuses = CI_JOBS.map((job) => ({
    job,
    status: normalizeStatus(options.results[job]),
  }));
  const failedJobs = statuses.filter(({ status }) => status !== "success").map(({ job }) => job);
  const markdown = [
    "## CI summary",
    "",
    "| Job | Result |",
    "|-----|--------|",
    ...statuses.map(({ job, status }) => `| \`${job}\` | ${status} |`),
    "",
    failedJobs.length === 0
      ? "> All required validation jobs passed."
      : `> Required validation jobs not green: ${failedJobs.join(", ")}`,
    "",
  ].join("\n");
  return { ok: failedJobs.length === 0, failedJobs, markdown };
}

function normalizeStatus(value: string | undefined): CiJobStatus {
  return value === "success" || value === "failure" || value === "cancelled" || value === "skipped"
    ? value
    : "skipped";
}

export async function main(): Promise<number> {
  const summary = summarizeCi({
    results: Object.fromEntries(CI_JOBS.map((job) => [job, process.env[`${job.replaceAll("-", "_").toUpperCase()}_RESULT`]])),
  });
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    await Bun.write(summaryPath, summary.markdown);
  } else {
    console.log(summary.markdown);
  }
  if (!summary.ok) {
    console.error(`ci-summary failed: ${summary.failedJobs.join(", ")}`);
    return 1;
  }
  return 0;
}

if (import.meta.main) process.exit(await main());