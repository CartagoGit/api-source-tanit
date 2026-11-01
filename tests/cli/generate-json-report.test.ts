/**
 * `generate --json` — the machine contract of the CLI.
 *
 * It is what the delendai plugin consumes. It did not exist before:
 * the plugin extracted routes with regular expressions over the text
 * for humans, and broke silently as soon as that text moved from
 * Spanish to English. These tests pin the shape so that next time
 * someone touches the human output, the gate says so.
 *
 * The strong invariant of `--json` mode: **stdout is exactly one JSON
 * document**. If a trace leaks there, the consumer eats a parse error.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { runProcess } from "../helpers/run-process";
import {
  GENERATE_REPORT_VERSION,
  type IGenerateReport,
} from "../../packages/contracts/interfaces/core/generate-report.interface";
import { CLI_COMMANDS_DIR, REPO_ROOT, exampleDir } from "../../scripts/helpers/root.helper";
import { SUPPORTED_REPORT_VERSION } from "../../packages/contracts/constants/integrations/delendai-report-version.constant";

const GENERATE = join(CLI_COMMANDS_DIR, "generate.script.ts");
const SOURCE_PROJECT = exampleDir("express");

let project = "";
let stdout = "";
let stderr = "";
let report: IGenerateReport;

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "postman-json-report-"));
  project = join(dir, "mi-api");
  await cp(SOURCE_PROJECT, project, { recursive: true });

  const result = await runProcess("bun", [GENERATE, "--project-root", project, "--json"], {
    cwd: REPO_ROOT,
  });
  stdout = result.stdout;
  stderr = result.stderr;
  report = JSON.parse(stdout) as IGenerateReport;
}, 60_000);

afterAll(async () => {
  if (project) await rm(resolve(project, ".."), { recursive: true, force: true });
});

describe("generate --json", () => {
  test("stdout is exactly one JSON document", () => {
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  test("the human trace goes to stderr, does not pollute stdout", () => {
    expect(stderr).toContain("Collection written to");
    expect(stdout).not.toContain("Collection written to");
  });

  test("declares the contract version", () => {
    expect(report.version).toBe(GENERATE_REPORT_VERSION);
    expect(report.ok).toBe(true);
  });

  /**
   * The delendai plugin rejects a report whose version it does not
   * know. If someone bumps `GENERATE_REPORT_VERSION` and forgets
   * the plugin, the `generate` tool stops working entirely, and
   * without this test nobody finds out until an agent actually
   * invokes it.
   *
   * The constant is **imported** instead of being searched with a
   * regex inside a file. The previous version read
   * `src/lib/helpers/runner.helper.ts` and pulled the number with
   * `/SUPPORTED_REPORT_VERSION = (\d+)/`; when the constant moved to
   * the plugin's contracts folder, `exec` returned `undefined`,
   * `Number()` turned it into `NaN`, and what failed was this test
   * — not the contract. A test that reads code as text checks where
   * something is written, not what its value is.
   */
  test("the plugin reads exactly this contract version", () => {
    expect(SUPPORTED_REPORT_VERSION).toBe(GENERATE_REPORT_VERSION);
  });

  test("carries the detected framework and the project name", () => {
    expect(report.framework).toBe("express");
    expect(report.projectRoot).toBe(project);
  });

  // The fixture is copied to a temporary folder with ANOTHER name
  // (`mi-api`), and yet the project is identified by what its
  // `package.json` declares. That is what we want: moving or cloning
  // the repo does not change the collection's identity, so reimport
  // keeps updating the one already in Postman instead of duplicating
  // it.
  test("the name comes from the manifest, not from the folder", () => {
    expect(project.endsWith("mi-api")).toBe(true);
    expect(report.projectName).toBe("sample-express");
  });

  test("the collection it advertises really exists on disk", () => {
    expect(report.collectionPath).not.toBeNull();
    expect(existsSync(report.collectionPath!)).toBe(true);
  });

  test("the environments it advertises really exist on disk", () => {
    expect(report.environmentPaths.length).toBeGreaterThan(0);
    for (const path of report.environmentPaths) {
      expect(existsSync(path), path).toBe(true);
    }
  });

  test("the request count matches the fixture", () => {
    // The express example exposes 9 endpoints in 3 folders.
    expect(report.requests).toBe(9);
    expect(report.folders).toBe(3);
  });

  test("the collectionId is the _postman_id, stable across runs", async () => {
    const again = await runProcess(
      "bun",
      [GENERATE, "--project-root", project, "--json"],
      { cwd: REPO_ROOT },
    );
    const second = JSON.parse(again.stdout) as IGenerateReport;
    expect(second.collectionId).toBe(report.collectionId);
    expect(report.collectionId).toMatch(/^[0-9a-f-]{36}$/);
  }, 60_000);

  test("reports the detected login flow", () => {
    expect(report.auth).not.toBeNull();
    expect(report.auth?.loginEndpoint).toMatch(/POST/);
    expect(report.auth?.tokenVariable).toBe("token");
  });

  test("without --json, stdout remains the human text", async () => {
    const human = await runProcess("bun", [GENERATE, "--project-root", project], {
      cwd: REPO_ROOT,
    });
    expect(human.stdout).toContain("Collection written to");
    expect(() => JSON.parse(human.stdout)).toThrow();
  }, 60_000);
});
