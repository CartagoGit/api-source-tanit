/**
 * `apisrc init` scaffolds a `config.constant.ts` for the host project.
 *
 * The scaffolded config carries the *collection description* that the
 * generated Postman collection will publish in `info.description`.
 * That description is part of the product the user opens in Postman:
 * it must be in English, not Spanish, because the project's own i18n
 * layer (`packages/ui/i18n/locales/*.json`) cannot translate strings
 * that the project itself emitted in Spanish at generation time.
 *
 * a00017/S1 narrows the i18n inversion to the three templates that
 * auto-generate Spanish inside the Postman artifact. This test pins
 * one of them — `init.script.ts`.
 */
import { afterEach, describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";

import { runInit } from "../../packages/cli/commands/init.script";
import { resolveProjectContext } from "../../packages/core/discovery/project-context.service";
import { createTempProject, type ITempProject } from "../helpers/scanner-fixture";

let project: ITempProject | null = null;

afterEach(async () => {
  await project?.cleanup();
  project = null;
});

describe("init.command — scaffolded config (a00017/S1)", () => {
  test("the scaffolded config.constant.ts carries an English collection description", async () => {
    project = await createTempProject({
      "composer.json": '{"name": "acme/test-project"}',
      ".env": "APP_NAME=Test\nAPP_URL=https://api.example.test\n",
    });

    const context = resolveProjectContext({ projectRoot: project.root });
    const outcome = await runInit([], context);

    expect(outcome.code).toBe(0);
    expect(outcome.configPath).not.toBeNull();

    const configBody = await readFile(outcome.configPath as string, "utf8");
    // English template, exactly the wording `a00017/S1` mandates.
    expect(configBody).toMatch(
      /collectionDescription:\s*"Postman collection for test-project\."/,
    );
    // No Spanish leftovers from the old boilerplate.
    expect(configBody).not.toContain("Colección Postman de");
    expect(configBody).not.toContain("Colección Postman");
  });
});
