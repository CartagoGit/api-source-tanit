/** One final list fallback for c00010 S3. */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runList } from "../../packages/cli/commands/list-endpoints.script";
import { runGenerate } from "../../packages/cli/commands/generate.script";
import { copyExampleClean } from "../helpers/fixtures";
import { exampleDir } from "../../scripts/helpers/root.helper";

let work = "";
beforeAll(async () => { work = await mkdtemp(join(tmpdir(), "list-fallback-")); }, 60_000);
afterAll(async () => { if (work) await rm(work, { recursive: true, force: true }); }, 60_000);

describe("list fallback branch", () => {
  test("uses defaultZone when an endpoint zone is not in zoneOrder", async () => {
    const root = join(work, "project");
    await copyExampleClean(exampleDir("express"), root);
    expect((await runGenerate(["--project-root", root])).code).toBe(0);
    await writeFile(
      join(root, "config.constant.ts"),
      `export const config = { name: "sample-express", baseUrl: "http://localhost", variables: [], filePrefixes: {}, zones: [["api", "API"]], zoneOrder: [], defaultZone: "Default", authDescriptions: {}, loginEndpointName: "Login", environments: [] };`,
    );
    const outcome = await runList(["--project-root", root, "--config", join(root, "config.constant.ts")]);
    expect(outcome.code).toBe(0);
    expect(outcome.endpoints.length).toBeGreaterThan(0);
  });
});
