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
import { join } from "node:path";

import { runInit } from "../../packages/cli/commands/init.script";
import { resolveProjectContext } from "../../packages/core/discovery/project-context.service";
import { createTempProject, type ITempProject } from "../helpers/scanner-fixture";
import { BASE_PATH_ENV_VAR } from "../../packages/contracts/constants/core/base-url.constant";

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

describe("init.command — detection branches", () => {
  test("--name overrides the manifest detection", async () => {
    project = await createTempProject({
      "composer.json": '{"name": "acme/original"}',
    });
    const context = resolveProjectContext({ projectRoot: project.root });
    const outcome = await runInit(["--name", "renamed"], context);
    expect(outcome.code).toBe(0);
    expect(outcome.projectName).toBe("renamed");
  });

  test("--output redirects the destination folder", async () => {
    project = await createTempProject({
      "composer.json": '{"name": "acme/test"}',
    });
    const context = resolveProjectContext({ projectRoot: project.root });
    const customDir = join(project.root, "my-custom-output");
    const outcome = await runInit(["--output", customDir], context);
    expect(outcome.code).toBe(0);
    expect(outcome.configPath).toBe(join(customDir, "config.constant.ts"));
    expect(outcome.endpointsPath).toBe(join(customDir, "endpoints.constant.ts"));
  });

  test("falls back to the project folder name without a manifest", async () => {
    // No composer.json: detection falls back to the directory name.
    project = await createTempProject({});
    const context = resolveProjectContext({ projectRoot: project.root });
    const outcome = await runInit([], context);
    expect(outcome.code).toBe(0);
    expect(outcome.projectName.length).toBeGreaterThan(0);
  });

  test("APP_BASE_URL is read when APP_URL is missing", async () => {
    project = await createTempProject({
      ".env": "APP_BASE_URL=https://base.example.test\n",
    });
    const context = resolveProjectContext({ projectRoot: project.root });
    const outcome = await runInit([], context);
    expect(outcome.code).toBe(0);
    expect(outcome.baseUrl).toContain("base.example.test");
  });

  test("the env-base-path env var appends a prefix to baseUrl", async () => {
    project = await createTempProject({
      ".env": "APP_URL=https://api.example.test\n",
    });
    const previous = process.env[BASE_PATH_ENV_VAR];
    process.env[BASE_PATH_ENV_VAR] = "/v3";
    try {
      const context = resolveProjectContext({ projectRoot: project.root });
      const outcome = await runInit([], context);
      expect(outcome.code).toBe(0);
      expect(outcome.baseUrl).toContain("/v3");
    } finally {
      if (previous === undefined) delete process.env[BASE_PATH_ENV_VAR];
      else process.env[BASE_PATH_ENV_VAR] = previous;
    }
  });

  test("auth guard detection writes san/passport/jwt guards into the config", async () => {
    project = await createTempProject({
      "app/Http/Middleware/SanctumCheck.php": "<?php // sanctum guard",
      "composer.json": '{"name": "acme/auth-test"}',
    });
    const context = resolveProjectContext({ projectRoot: project.root });
    const outcome = await runInit([], context);
    expect(outcome.code).toBe(0);
    expect(outcome.authGuards).toContain("sanctum");
  });

  test("the endpoints.constant.ts file is also written", async () => {
    project = await createTempProject({
      "composer.json": '{"name": "acme/with-endpoints"}',
    });
    const context = resolveProjectContext({ projectRoot: project.root });
    const outcome = await runInit([], context);
    expect(outcome.code).toBe(0);
    const endpointsBody = await readFile(outcome.endpointsPath, "utf8");
    expect(endpointsBody).toContain("ALL_ENDPOINTS");
  });
});
