#!/usr/bin/env bun
/**
 * Render the required CI check and make its result follow the shared proof plan.
 * Locally, the script still accepts `ci-results/*.json` for a dry-run report.
 */

import { existsSync, readdirSync, readFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PROOF_JOBS } from "../../packages/contracts/constants/quality/proof-rules.constant.js";
import type { IProofPlan } from "../../packages/contracts/interfaces/quality/proof-plan.interface.js";

export type TCiStatus = "success" | "failure" | "skipped" | "cancelled";

export interface ICiJobResult {
  readonly name: string;
  readonly status: TCiStatus;
  readonly durationMs?: number;
  readonly summary?: string;
}

export interface ICiVerdict {
  readonly results: readonly ICiJobResult[];
  readonly failures: readonly string[];
}

const STATUS_GLYPH: Record<TCiStatus, string> = {
  success: "OK",
  failure: "FAIL",
  skipped: "SKIP",
  cancelled: "CANCEL",
};

const STATUS_COLOR: Record<TCiStatus, string> = {
  success: "\x1b[32m",
  failure: "\x1b[31m",
  skipped: "\x1b[33m",
  cancelled: "\x1b[33m",
};

const ANSI_RESET = "\x1b[0m";
const isStatus = (value: unknown): value is TCiStatus =>
  value === "success" || value === "failure" || value === "skipped" || value === "cancelled";

function readResults(dir: string): ICiJobResult[] {
  if (!existsSync(dir)) return [];
  const results: ICiJobResult[] = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, unknown>;
      if (typeof parsed.name !== "string" || !isStatus(parsed.status)) throw new Error("invalid result shape");
      results.push({
        name: parsed.name,
        status: parsed.status,
        ...(typeof parsed.durationMs === "number" ? { durationMs: parsed.durationMs } : {}),
        ...(typeof parsed.summary === "string" ? { summary: parsed.summary } : {}),
      });
    } catch {
      results.push({ name: file.replace(/\.json$/, ""), status: "failure", summary: "missing or invalid result" });
    }
  }
  return results;
}

function parsePlan(raw: string): IProofPlan | undefined {
  try {
    const plan = JSON.parse(raw) as Partial<IProofPlan>;
    if (
      plan.version !== 1 || typeof plan.head !== "string" || typeof plan.base !== "string" ||
      (plan.mode !== "full" && plan.mode !== "affected") || plan.jobs === null || typeof plan.jobs !== "object"
    ) return undefined;
    for (const job of PROOF_JOBS) if (typeof plan.jobs[job] !== "boolean") return undefined;
    return plan as IProofPlan;
  } catch {
    return undefined;
  }
}

/** CI fails on an invalid plan, a planned job skipped by Actions, or any failed job. */
export function evaluateCiVerdict(input: {
  readonly planResult: string;
  readonly planJson: string;
  readonly expectedHead?: string;
  readonly statuses: Readonly<Record<string, string | undefined>>;
}): ICiVerdict {
  const failures: string[] = [];
  const plan = parsePlan(input.planJson);
  if (input.planResult !== "success") failures.push(`proof-plan finished with ${input.planResult || "no result"}`);
  if (!plan) failures.push("proof-plan output is missing or invalid");
  if (plan && input.expectedHead && plan.head !== input.expectedHead) failures.push("proof-plan HEAD does not match this workflow run");

  const results = PROOF_JOBS.map((name): ICiJobResult => {
    const raw = input.statuses[name];
    const status = isStatus(raw) ? raw : "failure";
    if (!raw || !isStatus(raw)) failures.push(`${name} has no valid Actions result`);
    else if (plan?.jobs[name] && status !== "success") failures.push(`${name} was planned but finished ${status}`);
    else if (status === "failure" || status === "cancelled") failures.push(`${name} finished ${status}`);
    return { name, status, ...(raw && !isStatus(raw) ? { summary: `invalid Actions result: ${raw}` } : {}) };
  });
  return { results, failures: [...new Set(failures)] };
}

export function renderMarkdown(results: readonly ICiJobResult[], failures: readonly string[] = []): string {
  if (!results.length) return ["## CI summary", "", "_No job results were available._", ""].join("\n");
  const ordered = [...results].sort((a, b) => a.name.localeCompare(b.name));
  const rows = ordered.map((result) => {
    const note = (result.summary ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
    return `| \`${result.name}\` | ${STATUS_GLYPH[result.status]} | ${result.durationMs === undefined ? "—" : `${result.durationMs} ms`} | ${note} |`;
  });
  const verdict = failures.length === 0 ? "PASS" : `FAIL: ${failures.join("; ")}`;
  return ["## CI summary", "", "| Job | Status | Duration | Notes |", "|-----|--------|----------|-------|", ...rows, "", `**Verdict:** ${verdict}`, ""].join("\n");
}

function renderStdout(verdict: ICiVerdict): void {
  if (!verdict.results.length) {
    console.log("→ ci-summary: no result files found (local dry-run).");
    return;
  }
  console.log("→ CI summary:");
  for (const result of verdict.results) {
    console.log(`  ${STATUS_COLOR[result.status]}${STATUS_GLYPH[result.status].padEnd(5)}${ANSI_RESET}  ${result.name}`);
  }
  if (verdict.failures.length) {
    for (const failure of verdict.failures) console.error(`  ✗ ${failure}`);
  } else console.log("  ✓ all planned jobs passed");
}

export function main(env: NodeJS.ProcessEnv = process.env): number {
  const hasWorkflowInputs = env.GITHUB_ACTIONS === "true" || env.PROOF_PLAN_RESULT !== undefined;
  let results: readonly ICiJobResult[];
  let failures: readonly string[];
  if (hasWorkflowInputs) {
    const verdict = evaluateCiVerdict({
      planResult: env.PROOF_PLAN_RESULT ?? "",
      planJson: env.TANIT_PROOF_PLAN ?? "",
      expectedHead: env.TANIT_PROOF_HEAD,
      statuses: Object.fromEntries(PROOF_JOBS.map((job) => [job, env[`${job.toUpperCase().replaceAll("-", "_")}_RESULT`]])),
    });
    ({ results, failures } = verdict);
  } else {
    results = readResults(resolve(env.CI_RESULTS_DIR ?? "./ci-results"));
    failures = results.filter((result) => result.status === "failure" || result.status === "cancelled").map((result) => `${result.name} finished ${result.status}`);
  }
  const verdict = { results, failures };
  renderStdout(verdict);
  const markdown = renderMarkdown(results, failures);
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, markdown);
  } else {
    console.log("\n--- Markdown summary ---");
    console.log(markdown);
  }
  return failures.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(main());
