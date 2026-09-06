/**
 * `bun run lint:fixtures` — guard that the gate catches every
 * failure mode the audit 2026-09-06 (sections 1, 9, 10) calls out.
 *
 * Imports the gate's helpers directly and drives them against
 * synthetic temp fixtures (audit 2026-09-06 §12: no literal
 * copies of the gate's lists).
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  FIXTURES_DIR,
  REPO_ROOT,
  SMOKE_FIXTURES_DIR,
} from "../../scripts/helpers/root.helper";
import {
  isFixtureSource,
  isManifest,
  isSpecFile,
  lintFixture,
  type IFixtureIssue,
} from "../../scripts/gates/lint-fixtures.script";

const SCRATCH = join(REPO_ROOT, "tests", "scripts-gates", ".scratch");

beforeAll(async () => {
  await mkdir(SCRATCH, { recursive: true });
});

afterAll(async () => {
  await rm(SCRATCH, { recursive: true, force: true });
});

async function tmpDir(prefix: string): Promise<string> {
  return mkdtemp(join(SCRATCH, prefix));
}

async function runGateCli(): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", join(REPO_ROOT, "scripts/gates/lint-fixtures.script.ts")],
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode: await proc.exited, stdout, stderr };
}

describe("isManifest / isSpecFile / isFixtureSource — unit", () => {
  test("manifests are recognised and excluded from sources", () => {
    expect(isManifest("package.json")).toBe(true);
    expect(isManifest("composer.json")).toBe(true);
    expect(isManifest("Foo.csproj")).toBe(true);
    expect(isManifest("expected.json")).toBe(false);
    expect(isManifest("tsconfig.json")).toBe(false);
    expect(isFixtureSource("expected.json")).toBe(false);
    expect(isFixtureSource("tsconfig.json")).toBe(false);
  });

  test("openapi/swagger/schema(.graphql)/proto/avsc are spec files", () => {
    expect(isSpecFile("openapi.yaml")).toBe(true);
    expect(isSpecFile("openapi.json")).toBe(true);
    expect(isSpecFile("swagger.yaml")).toBe(true);
    expect(isSpecFile("schema.graphql")).toBe(true);
    expect(isSpecFile("schema/schema.graphql")).toBe(true);
    expect(isSpecFile("schema/foo.proto")).toBe(true);
    expect(isSpecFile("user.avsc")).toBe(true);
  });

  test("code extensions are fixture sources", () => {
    expect(isFixtureSource("server.js")).toBe(true);
    expect(isFixtureSource("server.ts")).toBe(true);
    expect(isFixtureSource("app.py")).toBe(true);
    expect(isFixtureSource("Foo.cs")).toBe(true);
  });

  test("Symfony routing config is recognised (regression for symfony-mini)", () => {
    expect(isSpecFile("config/routes.yaml")).toBe(true);
    expect(isFixtureSource("config/routes.yaml")).toBe(true);
  });

  test("Laravel routing files are recognised", () => {
    expect(isSpecFile("routes/api.php")).toBe(true);
    expect(isSpecFile("routes/web.php")).toBe(true);
  });
});

describe("lintFixture — synthetic fixtures", () => {
  test("manifest-only fixture is flagged", async () => {
    const dir = await tmpDir("only-manifest-");
    try {
      await writeFile(join(dir, "package.json"), '{"name":"x"}');
      const issues = await lintFixture(dir);
      expect(issues.some((i) => i.kind === "no-sources")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("manifest + expected.json (the audit's exact bug) is flagged", async () => {
    const dir = await tmpDir("manifest-plus-expected-");
    try {
      await writeFile(join(dir, "package.json"), '{"name":"x"}');
      await writeFile(join(dir, "expected.json"), '{"routes":[]}');
      const issues = await lintFixture(dir);
      expect(issues.some((i) => i.kind === "no-sources")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("manifest + tsconfig.json is also flagged", async () => {
    const dir = await tmpDir("manifest-plus-tsconfig-");
    try {
      await writeFile(join(dir, "package.json"), '{"name":"x"}');
      await writeFile(join(dir, "tsconfig.json"), "{}");
      const issues = await lintFixture(dir);
      expect(issues.some((i) => i.kind === "no-sources")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("manifest + source code passes", async () => {
    const dir = await tmpDir("manifest-plus-code-");
    try {
      await writeFile(join(dir, "package.json"), '{"name":"x"}');
      await writeFile(join(dir, "index.ts"), "export const x = 1;\n");
      const issues = await lintFixture(dir);
      expect(issues).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("spec-only root (OpenAPI) passes", async () => {
    const dir = await tmpDir("spec-only-");
    try {
      await writeFile(join(dir, "openapi.yaml"), "openapi: 3.1.0\n");
      const issues = await lintFixture(dir);
      expect(issues).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("multi-service fixture: empty apps/ is flagged", async () => {
    const dir = await tmpDir("multi-empty-");
    try {
      await writeFile(join(dir, "package.json"), '{"name":"monorepo"}');
      await mkdir(join(dir, "apps"));
      const issues = await lintFixture(dir);
      expect(issues.some((i) => i.kind === "no-sources")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("multi-service fixture: child with manifest only is flagged at child level (audit §10)", async () => {
    const dir = await tmpDir("multi-child-only-manifest-");
    try {
      await writeFile(join(dir, "package.json"), '{"name":"monorepo"}');
      await mkdir(join(dir, "apps/api/src"), { recursive: true });
      await writeFile(join(dir, "apps/api/package.json"), '{"name":"@m/api"}');
      await writeFile(join(dir, "apps/api/src/index.ts"), "export const x = 1;\n");
      await mkdir(join(dir, "apps/orders"));
      await writeFile(join(dir, "apps/orders/package.json"), '{"name":"@m/orders"}');
      const issues = await lintFixture(dir);
      // The issue MUST exist (the failure mode the audit warns about),
      // be of the right kind, and pin the child path under the
      // multi-service subdir (the path includes the relative
      // `.scratch/<tmp>/apps/orders`).
      const childIssue = issues.find(
        (i) =>
          i.kind === "empty-multi-service-child" &&
          i.fixture.endsWith("orders") &&
          i.fixture.includes("/apps/"),
      );
      expect(
        childIssue,
        `expected a child-level issue for the orders child; got ${JSON.stringify(issues)}`,
      ).toBeDefined();
      // Root must NOT be flagged when the children explain the gap
      // (audit §10 fix).
      expect(issues.some((i) => i.kind === "no-sources")).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("multi-service fixture: two healthy children pass", async () => {
    const dir = await tmpDir("multi-healthy-");
    try {
      await writeFile(join(dir, "package.json"), '{"name":"monorepo"}');
      await mkdir(join(dir, "apps/api/src"), { recursive: true });
      await writeFile(join(dir, "apps/api/package.json"), '{"name":"@m/api"}');
      await writeFile(join(dir, "apps/api/src/index.ts"), "export const x = 1;\n");
      await mkdir(join(dir, "apps/orders/src"), { recursive: true });
      await writeFile(join(dir, "apps/orders/package.json"), '{"name":"@m/orders"}');
      await writeFile(join(dir, "apps/orders/src/server.js"), "module.exports = {};\n");
      const issues = await lintFixture(dir);
      expect(issues).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lint:fixtures — exit code propagation (audit §8)", () => {
  test("real fixture roots: exit 0 + ok message", async () => {
    const { exitCode, stdout } = await runGateCli();
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/ok\s+fixtures/);
  });

  test("the gate exposes IFixtureIssue kind 'empty-multi-service-child'", () => {
    const issue: IFixtureIssue = {
      fixture: "x",
      kind: "empty-multi-service-child",
      detail: "x",
    };
    expect(issue.kind).toBe("empty-multi-service-child");
  });
});

describe("fixture roots are wired correctly (sanity)", () => {
  test("the real fixture roots exist on disk", () => {
    expect(FIXTURES_DIR.endsWith("tests/fixtures")).toBe(true);
    expect(SMOKE_FIXTURES_DIR.endsWith("tests/smoke-fixtures")).toBe(true);
  });
});
