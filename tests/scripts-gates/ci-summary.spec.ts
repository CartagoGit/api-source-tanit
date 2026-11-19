import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { IProofPlan } from "../../packages/contracts/interfaces/quality/proof-plan.interface.js";
import { CI_JOBS, summarizeCi } from "../../scripts/gates/ci-summary.script.js";
import { createProofPlan } from "../../scripts/helpers/proof-plan.helper.js";

const head = "run-head";

function plan(jobs: Readonly<Record<string, boolean>> = Object.fromEntries(CI_JOBS.map((job) => [job, true]))): IProofPlan {
  return {
    version: 1,
    base: "base-head",
    head,
    mode: "full",
    reasons: [],
    changedFiles: ["packages/core/example.service.ts"],
    sections: ["core"],
    specs: ["tests/core/example.spec.ts"],
    jobs,
    steps: [],
  };
}

function results(status: string = "success"): Record<string, string> {
  return Object.fromEntries(CI_JOBS.map((job) => [job, status]));
}

function summarize(options: {
  readonly proofPlan?: IProofPlan;
  readonly planResult?: string;
  readonly expectedHead?: string;
  readonly results?: Record<string, string | undefined>;
} = {}) {
  return summarizeCi({
    planResult: options.planResult ?? "success",
    planJson: options.proofPlan === undefined ? JSON.stringify(plan()) : JSON.stringify(options.proofPlan),
    expectedHead: options.expectedHead ?? head,
    results: options.results ?? results(),
  });
}

describe("the required ci-summary gate", () => {
  test("the validate workflow executes this gate and passes it the shared plan", () => {
    const workflow = readFileSync(".github/workflows/validate.yml", "utf8");
    expect(workflow).toContain("run: bun run scripts/gates/ci-summary.script.ts");
    expect(workflow).toContain("PROOF_PLAN_RESULT: ${{ needs.proof-plan.result }}");
    expect(workflow).toContain("TANIT_PROOF_PLAN: ${{ needs.proof-plan.outputs.plan }}");
    for (const job of CI_JOBS) {
      const resultExpression = "${{ needs." + job + ".result }}";
      expect(workflow).toContain(`${job.toUpperCase().replaceAll("-", "_")}_RESULT: ${resultExpression}`);
    }
  });

  test("accepts a skipped job only when the plan excludes it", () => {
    const jobs = Object.fromEntries(CI_JOBS.map((job) => [job, job !== "test-coverage"]));
    const statuses = results();
    statuses["test-coverage"] = "skipped";
    expect(summarize({ proofPlan: plan(jobs), results: statuses }).ok).toBe(true);
  });

  test("accepts the actual docs-only plan with all unrelated suites skipped", () => {
    const proofPlan = createProofPlan({
      base: "base-head",
      head,
      changes: [{ path: "docs/delendai/proposals/ready/perfs/new.md", status: "A" }],
      files: {},
    });
    const statuses = results("skipped");
    statuses.lint = "success";
    statuses["integration-verifier"] = "success";
    const summary = summarizeCi({
      planResult: "success",
      planJson: JSON.stringify(proofPlan),
      expectedHead: head,
      results: statuses,
    });
    expect(proofPlan.jobs["test-coverage"]).toBe(false);
    expect(summary.ok).toBe(true);
  });

  test("fails when any planned job is skipped", () => {
    const statuses = results();
    statuses["test-coverage"] = "skipped";
    const summary = summarize({ results: statuses });
    expect(summary.ok).toBe(false);
    expect(summary.failedJobs).toContain("test-coverage");
  });

  test.each(["failure", "cancelled", undefined, "unknown"])("fails on a job result of %s", (status) => {
    const statuses = results();
    if (status === undefined) delete statuses.lint;
    else statuses.lint = status;
    const summary = summarize({ results: statuses });
    expect(summary.ok).toBe(false);
    expect(summary.failedJobs).toContain("lint");
  });

  test("fails closed when planning fails, is invalid, or belongs to another HEAD", () => {
    expect(summarize({ planResult: "failure" }).ok).toBe(false);
    expect(summarizeCi({ planResult: "success", planJson: "{}", results: results() }).ok).toBe(false);
    expect(summarize({ expectedHead: "stale-head" }).ok).toBe(false);
    expect(summarizeCi({ results: results(), planJson: JSON.stringify(plan()) }).ok).toBe(false);
  });
});
