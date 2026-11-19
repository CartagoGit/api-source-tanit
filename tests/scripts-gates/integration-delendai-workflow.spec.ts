import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fromRoot } from "../../scripts/helpers/root.helper.js";
import { branchProtectionPayload } from "../../scripts/gates/branch-protection-payload.script.js";
import { BRANCH_PROTECTION_POLICY, INTEGRATION_BRANCH, RELEASE_BRANCH, REQUIRED_CHECKS } from "../../scripts/gates/branch-protection.script.js";

const parseWorkflow = (file: string) => {
  const result = spawnSync("bun", ["-e", "console.log(JSON.stringify(Bun.YAML.parse(await Bun.file(process.argv[1]).text())))", fromRoot(file)], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
};

describe("optional DelendAI integration uses the project pin", () => {
  test("the actual workflow checks out the pin and verifies runtime resolution", async () => {
    const file = ".github/workflows/integration-delendai.yml";
    const workflow = parseWorkflow(file);
    const steps = workflow.jobs.integration.steps;
    const rootInstall = steps.findIndex((step: { name?: string }) => step.name === "Install Tanit dependencies");
    const pluginInstall = steps.findIndex((step: { name?: string }) => step.name === "Install plugin dependencies");
    const validation = steps.findIndex((step: { name?: string }) => step.name === "Validate plugin");
    expect(rootInstall).toBeGreaterThan(-1);
    expect(steps[rootInstall].run).toBe("bun install --frozen-lockfile --ignore-scripts");
    expect(steps[rootInstall]["working-directory"]).toBeUndefined();
    expect(pluginInstall).toBeGreaterThan(rootInstall);
    expect(validation).toBeGreaterThan(pluginInstall);
    const pin = steps.find((step: { id?: string }) => step.id === "pin");
    expect(pin.run).toContain("scripts/integrations/delendai-runtime.json");
    const checkout = steps.find((step: { name?: string }) => step.name === "Checkout immutable DelendAI runtime");
    expect(checkout.with.ref).toBe("${{ steps.pin.outputs.commit }}");
    expect(steps.find((step: { name?: string }) => step.name === "Verify runtime and plugin resolution").run).toContain("--link --verify");
    const source = await readFile(fromRoot(file), "utf8");
    expect(source).not.toContain("DELENDAI_SHA");
    expect(source).not.toContain("../delendai");
    expect(source).not.toContain("REPO_ADMIN_TOKEN");
    expect(source).not.toContain("rulesets");
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(steps.find((step: { name?: string }) => step.name === "Install plugin dependencies").run).toContain("--frozen-lockfile");
  });
});

describe("protection application and verification share policy", () => {
  test("integration false and release true are preserved by the actual payload command", () => {
    for (const branch of [INTEGRATION_BRANCH, RELEASE_BRANCH]) {
      const result = spawnSync("bun", [fromRoot("scripts/gates/branch-protection-payload.script.ts"), branch], { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(branchProtectionPayload(branch));
    }
    const integration = branchProtectionPayload(INTEGRATION_BRANCH);
    expect(integration.required_status_checks).toEqual({ strict: false, contexts: [...REQUIRED_CHECKS] });
    expect(integration.required_linear_history).toBe(false);
    expect(integration.allow_force_pushes).toBe(BRANCH_PROTECTION_POLICY.allowForcePushes);
    expect(branchProtectionPayload(RELEASE_BRANCH).required_status_checks.strict).toBe(true);
    expect(() => branchProtectionPayload("unconfigured")).toThrow("No protection policy");
  });

  test("the workflow applies the payload it derives, retaining its PUT call", () => {
    const workflow = parseWorkflow(".github/workflows/protect-develop.yml");
    const step = workflow.jobs.protect.steps.find((item: { name?: string }) => item.name === "Apply branch protection");
    expect(step.run).toContain('bun scripts/gates/branch-protection-payload.script.ts "$BRANCH"');
    expect(step.run).toContain('-X PUT');
    expect(step.run).toContain('-d "${PAYLOAD}"');
    expect(step.run).not.toContain("requireLatestIntegration // true");
    expect(step.run).not.toContain("linearHistory // true");
  });
});
