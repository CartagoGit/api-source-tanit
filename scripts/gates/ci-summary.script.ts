#!/usr/bin/env bun

import { PROOF_JOBS } from "../../packages/contracts/constants/quality/proof-rules.constant.js";
import type { IProofPlan } from "../../packages/contracts/interfaces/quality/proof-plan.interface.js";

export const CI_JOBS = PROOF_JOBS;

export type CiJobStatus = "success" | "failure" | "cancelled" | "skipped";

export interface ICiSummaryOptions {
  readonly results: Readonly<Record<string, string | undefined>>;
  readonly planResult?: string;
  readonly planJson?: string;
  readonly expectedHead?: string;
  readonly summaryPath?: string;
}

export interface ICiSummaryResult {
  readonly ok: boolean;
  readonly failedJobs: ReadonlyArray<string>;
  readonly markdown: string;
}

function parsePlan(raw: string | undefined): IProofPlan | undefined {
  if (!raw) return undefined;
  try {
    const plan = JSON.parse(raw) as Partial<IProofPlan>;
    if (
      plan.version !== 1 || typeof plan.head !== "string" || typeof plan.base !== "string" ||
      (plan.mode !== "full" && plan.mode !== "affected") || !Array.isArray(plan.changedFiles) ||
      plan.jobs === null || typeof plan.jobs !== "object"
    ) return undefined;
    if (CI_JOBS.some((job) => typeof plan.jobs?.[job] !== "boolean")) return undefined;
    return plan as IProofPlan;
  } catch {
    return undefined;
  }
}

function normalizeStatus(value: string | undefined): CiJobStatus | undefined {
  return value === "success" || value === "failure" || value === "cancelled" || value === "skipped"
    ? value
    : undefined;
}

/** The required status check succeeds only when every planned job succeeded. */
export function summarizeCi(options: ICiSummaryOptions): ICiSummaryResult {
  const plan = parsePlan(options.planJson);
  const failures: string[] = [];
  if (options.planResult !== "success") failures.push(`proof-plan finished ${options.planResult ?? "without a result"}`);
  if (!plan) failures.push("proof-plan output is missing or invalid");
  if (plan && options.planResult !== undefined && plan.head !== options.expectedHead) failures.push("proof-plan HEAD does not match this workflow run");

  const statuses = CI_JOBS.map((job) => {
    const status = normalizeStatus(options.results[job]);
    if (!status) failures.push(`${job} has no valid Actions result`);
    else if (plan?.jobs[job] && status !== "success") failures.push(`${job} was planned but finished ${status}`);
    else if (status === "failure" || status === "cancelled") failures.push(`${job} finished ${status}`);
    return { job, status: status ?? "missing" };
  });
  const uniqueFailures = [...new Set(failures)];
  const markdown = [
    "## CI summary",
    "",
    ...(plan ? [`Proof scope: **${plan.mode}** (${plan.changedFiles.length} changed files).`, ""] : []),
    "| Job | Result |",
    "|-----|--------|",
    ...statuses.map(({ job, status }) => `| \`${job}\` | ${status} |`),
    "",
    uniqueFailures.length === 0
      ? "> All planned validation jobs passed."
      : `> Required validation failed: ${uniqueFailures.join("; ")}`,
    "",
  ].join("\n");
  return {
    ok: uniqueFailures.length === 0,
    failedJobs: [...new Set(uniqueFailures.map((failure) => failure.split(" ")[0] ?? failure))],
    markdown,
  };
}

export async function main(): Promise<number> {
  const summary = summarizeCi({
    results: Object.fromEntries(CI_JOBS.map((job) => [job, process.env[`${job.replaceAll("-", "_").toUpperCase()}_RESULT`]])),
    planResult: process.env.PROOF_PLAN_RESULT,
    planJson: process.env.TANIT_PROOF_PLAN,
    expectedHead: process.env.TANIT_PROOF_HEAD,
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
