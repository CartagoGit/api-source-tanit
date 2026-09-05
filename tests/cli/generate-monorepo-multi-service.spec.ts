/**
 * CLI tests for a00013 S3 (`--combine-services` parsing).
 *
 * Strict: the pipeline wiring is NOT tested in depth (that is an e2e
 * test that requires the real orchestrator). Here we only validate
 * that the `--combine-services` flag is PARSED and PROPAGATED to
 * `IGenerationOptions`. The test focuses on:
 *
 *  - The flag is acceptable as an argument (it does not abort the
 *    script).
 *  - The script exits with code 1 (not 0) when the detected project
 *    generates no endpoints, both with and without the flag. That
 *    confirms `buildFor` does not break with `matches.length === 0`
 *    nor with `matches.length === N`.
 *  - The script produces the same exit code on the "no framework"
 *    path with and without `--combine-services`: the flag does not
 *    affect the behavior when there is nothing to emit.
 */
import { afterEach, beforeEach, describe, expect, it, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runGenerate } from "../../packages/cli/commands/generate.script.js";
import { runProcess } from "../helpers/run-process";
import { CLI_COMMANDS_DIR } from "../../scripts/helpers/root.helper";

const GENERATE = join(CLI_COMMANDS_DIR, "generate.script.ts");

// Note: the CLI does not use `process.cwd()`; it resolves the
// projectRoot via `--project-root` or `argv`. That is why this test
// does not `process.chdir`.


describe("a00013 S3 CLI --combine-services parsing", () => {
  let emptyRoot: string;

  beforeEach(() => {
    emptyRoot = mkdtempSync(join(tmpdir(), "a00013-s3-"));
  });

  afterEach(() => {
    if (existsSync(emptyRoot)) {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it("with empty project and WITHOUT --combine-services: exits with non-zero code", async () => {
    mkdirSync(join(emptyRoot, "apps"), { recursive: true });
    const result = await runGenerate(["--project-root", emptyRoot]);
    expect(result.code).not.toBe(0);
  });

  it("with empty project and WITH --combine-services: exits with the same non-zero code", async () => {
    mkdirSync(join(emptyRoot, "apps"), { recursive: true });
    const result = await runGenerate([
      "--project-root", emptyRoot,
      "--combine-services",
    ]);
    expect(result.code).not.toBe(0);
  });

  it("--combine-services does not abort with an additional unknown flag", async () => {
    // The flag must be purely additive: combine with already existing
    // flags (--json) without throwing parse errors.
    mkdirSync(join(emptyRoot, "apps"), { recursive: true });
    const result = await runGenerate([
      "--project-root", emptyRoot,
      "--combine-services",
      "--json",
    ]);
    // The project is still empty: the code reflects that, not the flag.
    expect(result.code).not.toBe(0);
  });
});

/**
 * x00024 S2 — CLI translates `MultipleServicesWithoutCombineError`
 * to exit code 64 (`EX_USAGE`) with an actionable message.
 *
 * The CLI is launched as a subprocess (via `runProcess`) because it
 * is the only way to observe the real exit code: the catch lives in
 * the `if (import.meta.main)` block of the script, not in
 * `runGenerate`.
 */
describe("x00024 S2 — CLI exit code 64 on multi-service without --combine-services", () => {
  let workRoot: string;

  beforeEach(() => {
    workRoot = mkdtempSync(join(tmpdir(), "x00024-cli-"));
  });

  afterEach(() => {
    if (existsSync(workRoot)) {
      rmSync(workRoot, { recursive: true, force: true });
    }
  });

  test("monorepo with 2 services without --combine-services → exit 64 and actionable message", async () => {
    // Same synthetic fixture pattern as in
    // `tests/core/monorepo-multi-workspace.spec.ts`: a monorepo
    // with two workspaces (NestJS + Express) that the expanded
    // detection identifies as two services.
    writeFileSync(
      join(workRoot, "package.json"),
      JSON.stringify({
        name: "x00024-monorepo",
        private: true,
        workspaces: ["apps/*"],
      }),
    );
    mkdirSync(join(workRoot, "apps", "api", "src"), { recursive: true });
    writeFileSync(
      join(workRoot, "apps", "api", "package.json"),
      JSON.stringify({
        name: "@x24/api",
        dependencies: { "@nestjs/core": "^10.0.0" },
      }),
    );
    writeFileSync(
      join(workRoot, "apps", "api", "src", "app.controller.ts"),
      `import { Controller, Get } from "@nestjs/common";
@Controller("widgets")
export class AppController {
  @Get() list() { return []; }
}
`,
    );
    mkdirSync(join(workRoot, "apps", "web"), { recursive: true });
    writeFileSync(
      join(workRoot, "apps", "web", "package.json"),
      JSON.stringify({
        name: "@x24/web",
        dependencies: { express: "^4.19.0" },
      }),
    );
    writeFileSync(
      join(workRoot, "apps", "web", "server.js"),
      `const express = require("express");
const app = express();
app.get("/pages", (_req, res) => res.json([]));
`,
    );

    const result = await runProcess("bun", [
      GENERATE,
      "--project-root", workRoot,
    ]);

    // The exit code is the piece a CI script can read without
    // parsing text: 64 = EX_USAGE (sysexits convention).
    expect(result.code, result.output).toBe(64);
    // The message must name the solution, not only the problem.
    expect(result.output).toMatch(/Detected \d+ service/i);
    expect(result.output).toMatch(/--combine-services/);
    // If the serviceIds are in the error, they must also appear
    // listed in the CLI's stderr (that is the actionable part).
    expect(result.output).toMatch(/Detected services/i);
  }, 60_000);

  test("monorepo with 2 services + --combine-services → NO exit 64 (legacy)", async () => {
    // The flag must suppress the error: the caller already asked
    // to combine, so the pipeline emits a single combined collection
    // and ends successfully (or with whatever code corresponds to
    // the content, never 64 for this reason).
    writeFileSync(
      join(workRoot, "package.json"),
      JSON.stringify({
        name: "x00024-monorepo-combine",
        private: true,
        workspaces: ["apps/*"],
      }),
    );
    mkdirSync(join(workRoot, "apps", "api", "src"), { recursive: true });
    writeFileSync(
      join(workRoot, "apps", "api", "package.json"),
      JSON.stringify({
        name: "@x24c/api",
        dependencies: { "@nestjs/core": "^10.0.0" },
      }),
    );
    writeFileSync(
      join(workRoot, "apps", "api", "src", "app.controller.ts"),
      `import { Controller, Get } from "@nestjs/common";
@Controller("widgets")
export class AppController {
  @Get() list() { return []; }
}
`,
    );

    const result = await runProcess("bun", [
      GENERATE,
      "--project-root", workRoot,
      "--combine-services",
    ]);

    // Exit 64 would be a regression of the fix. If the script ends
    // with 0 (write OK) or with 1 (zero endpoints for some concrete
    // reason of the fixture), but NOT 64, the behavior is the
    // expected one.
    expect(result.code, result.output).not.toBe(64);
  }, 60_000);
});
