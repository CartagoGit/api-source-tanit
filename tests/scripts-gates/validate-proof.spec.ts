import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  main,
  validationArguments,
  type IValidationContext,
} from "../../scripts/gates/validate.script.js";

const featureBranch: IValidationContext = {
  branch: "wip/openai-gpt-6-luna/implement/x00097-S1-g1/validate-journal",
  integrationBranch: "develop",
  releaseBranch: "main",
  configKnown: true,
};

describe("plan-aware validate entrypoint", () => {
  test("runs the shared plan without forcing the full gate in a known feature unit", async () => {
    const calls: string[][] = [];
    const status = await main(["--plan"], featureBranch, async (args) => {
      calls.push(args);
      return 0;
    });
    expect(status).toBe(0);
    expect(calls).toEqual([["--plan"]]);
  });

  test.each([
    { branch: "develop", eventName: undefined, baseRef: undefined },
    { branch: "main", eventName: undefined, baseRef: undefined },
    { branch: undefined, eventName: undefined, baseRef: undefined },
    { branch: featureBranch.branch, eventName: "push", baseRef: undefined },
    { branch: featureBranch.branch, eventName: "pull_request", baseRef: "main" },
  ])("forces full proof when context is integration/release/detached/promotion: $branch $eventName $baseRef", ({ branch, eventName, baseRef }) => {
    expect(
      validationArguments(["--plan"], {
        ...featureBranch,
        branch,
        ...(eventName === undefined ? {} : { eventName }),
        ...(baseRef === undefined ? {} : { baseRef }),
      }),
    ).toEqual(["--full", "--plan"]);
  });

  test("unknown branch policy fails closed to full validation", () => {
    expect(
      validationArguments(["--plan"], { branch: featureBranch.branch, configKnown: false }),
    ).toEqual(["--full", "--plan"]);
  });

  test("respects an explicit full request and preserves other proof arguments", () => {
    expect(
      validationArguments(["--plan", "--full", "--job=lint"], featureBranch),
    ).toEqual(["--plan", "--full", "--job=lint"]);
  });

  test("package validate uses the wrapper and the release entrypoint remains full", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts.validate).toBe("bun run scripts/gates/validate.script.ts");
    expect(manifest.scripts["validate:examples"]).toBe(
      "bun run scripts/gates/validate-examples.script.ts",
    );
    expect(manifest.scripts["validate:full"]).toBe(
      "bun run scripts/gates/validate.script.ts --full",
    );
    expect(manifest.scripts["validate:run"]).toBe("bun run validate:full");
    expect(readFileSync("scripts/gates/validate-examples.script.ts", "utf8")).toContain(
      "generateWithAllFrameworks",
    );
    expect(readFileSync(".github/workflows/release-binaries.yml", "utf8")).toContain(
      "run: bun run validate:full",
    );
    // This runs the DelendAI plugin's independent validation, not Tanit's root gate.
    expect(readFileSync(".github/workflows/integration-delendai.yml", "utf8")).toContain(
      "working-directory: integrations/delendai\n        run: bun run validate",
    );
  });
});
