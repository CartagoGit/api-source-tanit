import { describe, expect, test } from "vitest";
import { createProofPlan, executeProof } from "../../scripts/helpers/proof-plan.helper.js";
import type { IProofInput } from "../../packages/contracts/interfaces/quality/proof-plan.interface.js";
import { PROOF_JOBS } from "../../packages/contracts/constants/quality/proof-rules.constant.js";

const baseInput: IProofInput = {
  base: "base-sha",
  head: "head-sha",
  changes: [{ path: "packages/core/example.service.ts", status: "M" }],
  files: {
    "packages/core/example.service.ts": "export const value = 1;",
    "tests/core/example.spec.ts": 'import { value } from "../../packages/core/example.js"; expect(value).toBe(1);',
    "tests/core/other.spec.ts": "expect(true).toBe(true);",
    "tests/frameworks/example.scanner.spec.ts": "expect(true).toBe(true);",
    "tests/app/example.spec.ts": "expect(true).toBe(true);",
  },
};

describe("scope-aware proof plan", () => {
  test("follows transitive imports and declared dependent sections while keeping aggregate coverage", () => {
    const plan = createProofPlan({
      ...baseInput,
      files: {
        ...baseInput.files,
        "packages/core/barrel.ts": 'export { value } from "./example.js";',
        "tests/frameworks/uses-core.spec.ts": 'import { value } from "../../packages/core/barrel.js"; expect(value).toBe(1);',
      },
    });
    expect(plan.mode).toBe("affected");
    expect(plan.specs).toContain("tests/core/example.spec.ts");
    expect(plan.specs).toContain("tests/frameworks/uses-core.spec.ts");
    expect(plan.specs).toContain("tests/app/example.spec.ts");
    expect(plan.sections).toContain("frameworks");
    expect(plan.jobs["test-coverage"]).toBe(true);
    expect(plan.jobs["affected-tests"]).toBe(true);
    expect(plan.steps.some((step) => step.job === "affected-tests")).toBe(true);
    expect(plan.steps.some((step) => step.id === "coverage")).toBe(true);
  });

  test("unknown dynamic readers widen to all specs in their selected section", () => {
    const plan = createProofPlan({
      ...baseInput,
      files: {
        ...baseInput.files,
        "packages/core/example.service.ts": "const loaded = await import(moduleName);",
      },
    });
    expect(plan.mode).toBe("affected");
    expect(plan.specs).toContain("tests/core/example.spec.ts");
    expect(plan.specs).toContain("tests/core/other.spec.ts");
  });

  test("unresolved relative and framework resource imports widen their consuming section", () => {
    const plan = createProofPlan({
      ...baseInput,
      changes: [{ path: "packages/frameworks/example.scanner.ts", status: "M" }],
      files: {
        ...baseInput.files,
        "packages/frameworks/example.scanner.ts": 'export const view = { templateUrl: "./missing.html" }; import("./missing.js");',
      },
    });
    expect(plan.mode).toBe("affected");
    expect(plan.sections).toContain("frameworks");
    expect(plan.specs).toContain("tests/frameworks/example.scanner.spec.ts");
  });

  test("documentation-only changes skip test and Bun-only jobs", () => {
    const plan = createProofPlan({
      ...baseInput,
      changes: [{ path: "docs/delendai/proposals/ready/perfs/example.md", status: "M" }],
    });
    expect(plan.mode).toBe("affected");
    expect(plan.specs).toEqual([]);
    expect(plan.jobs["affected-tests"]).toBe(false);
    expect(plan.jobs["test-coverage"]).toBe(false);
    expect(plan.steps.some((step) => ["coverage", "sqlite", "transport", "affected-tests"].includes(step.id))).toBe(false);
    expect(plan.jobs.lint).toBe(true);
  });

  test.each([
    { changes: [{ path: "docs/delendai/proposals/ready/perfs/new.md", status: "A" }] },
    { changes: [{ path: "docs/delendai/proposals/ready/perfs/old.md", status: "D" }] },
    {
      changes: [
        { path: "docs/delendai/proposals/ready/perfs/old.md", status: "D" },
        { path: "docs/delendai/proposals/ready/perfs/new.md", status: "A" },
      ],
    },
  ])("proposal additions, removals, and moves keep the docs-only plan narrow", ({ changes }) => {
    const plan = createProofPlan({ ...baseInput, changes: changes as IProofInput["changes"] });
    expect(plan.mode).toBe("affected");
    expect(plan.jobs["test-coverage"]).toBe(false);
    expect(plan.jobs["affected-tests"]).toBe(false);
    expect(plan.steps.map((step) => step.job)).not.toContain("test-coverage");
  });

  test("proposal docs mixed with a source edit keep full aggregate coverage", () => {
    const plan = createProofPlan({
      ...baseInput,
      changes: [
        { path: "docs/delendai/proposals/ready/perfs/new.md", status: "A" },
        { path: "packages/core/example.service.ts", status: "M" },
      ],
    });
    expect(plan.mode).toBe("affected");
    expect(plan.jobs["test-coverage"]).toBe(true);
    expect(plan.jobs["affected-tests"]).toBe(true);
  });

  test("cannot manually execute a proof job omitted by the plan", async () => {
    const plan = createProofPlan({
      ...baseInput,
      changes: [{ path: "docs/README.md", status: "M" }],
    });
    await expect(executeProof(plan, async () => 0, "test-coverage")).rejects.toThrow("not selected by this plan");
  });

  test.each([
    [{ path: "packages/core/example.service.ts", status: "D" }],
    [{ path: "unclassified/image.bin", status: "M" }],
    [{ path: ".github/workflows/validate.yml", status: "M" }],
  ])("structural, unknown, and gate changes widen to full proof", (change) => {
    const plan = createProofPlan({ ...baseInput, changes: [change as IProofInput["changes"][number]] });
    expect(plan.mode).toBe("full");
    expect(plan.jobs).toEqual(Object.fromEntries(PROOF_JOBS.map((job) => [job, job !== "affected-tests"])));
  });

  test("analysis uncertainty and explicit integration proof widen to full validation", () => {
    for (const options of [{ uncertainty: "git diff failed" }, { forceFull: true }]) {
      const plan = createProofPlan({ ...baseInput, ...options });
      expect(plan.mode).toBe("full");
      expect(plan.jobs["desktop-tests"]).toBe(true);
    }
  });

  test("executes the plan in order and stops at the first failed gate", async () => {
    const plan = createProofPlan(baseInput);
    const seen: string[] = [];
    const result = await executeProof(plan, async (step) => {
      seen.push(step.id);
      return step.id === "lint" ? 7 : 0;
    });
    expect(result).toBe(7);
    expect(seen.at(-1)).toBe("lint");
    expect(seen).not.toContain("coverage");
  });
});
