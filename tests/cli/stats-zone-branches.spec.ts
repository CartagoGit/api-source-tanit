import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runStats } from "../../packages/cli/commands/stats.script";
import { runGenerate } from "../../packages/cli/commands/generate.script";
import { copyExampleClean } from "../helpers/fixtures";
import { exampleDir } from "../../scripts/helpers/root.helper";

let work = "";
beforeAll(async () => { work = await mkdtemp(join(tmpdir(), "stats-zone-")); }, 60_000);
afterAll(async () => { if (work) await rm(work, { recursive: true, force: true }); }, 60_000);

describe("stats zone branches", () => {
  test("skips zones that have zero requests", async () => {
    const root = join(work, "project");
    await copyExampleClean(exampleDir("express"), root);
    expect((await runGenerate(["--project-root", root])).code).toBe(0);
    const configPath = join(root, "config.constant.ts");
    await writeFile(
      configPath,
      `export const config = { name: "sample-express", baseUrl: "http://localhost", variables: [], filePrefixes: {}, zones: [["api", "API"]], zoneOrder: ["Empty"], defaultZone: "Default", authDescriptions: {}, loginEndpointName: "Login", environments: [] };`,
    );
    const outcome = await runStats(["--project-root", root, "--config", configPath]);
    expect(outcome.code).toBe(0);
    expect(outcome.total).toBeGreaterThan(0);
    const printed = outcome.zones.map((z) => z.zone);
    expect(printed).not.toContain("Empty");
  });
});
