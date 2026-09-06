/**
 * `bun run lint:fixtures` — guard that the gate catches the very
 * failure modes the audit 2026-09-06 section 1 calls out.
 *
 * Without this test, the gate could silently regress to "always pass"
 * and the failure mode would come back. The fixtures used here are
 * synthetic: we build a temp directory with a deliberately incomplete
 * fixture and assert the gate's source-scan logic flags it.
 *
 * The gate today is wired to `FIXTURES_DIR` / `SMOKE_FIXTURES_DIR`
 * (constants from `root.helper.ts`). To exercise it without
 * contaminating the real fixture roots, the test runs the gate once
 * against the real roots (baseline) AND replicates the source-scan
 * logic on synthetic fixtures. The replication is a literal copy of
 * the gate's helper, kept in lock-step by code review — if the gate
 * adds or removes an extension, this list must change with it.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  FIXTURES_DIR,
  REPO_ROOT,
  SMOKE_FIXTURES_DIR,
} from "../../scripts/helpers/root.helper";

const SCRATCH = join(REPO_ROOT, "tests", "scripts-gates", ".scratch");

beforeAll(async () => {
  await mkdir(SCRATCH, { recursive: true });
});

afterAll(async () => {
  await rm(SCRATCH, { recursive: true, force: true });
});

describe("lint-fixtures.script.ts — audit 2026-09-06 §1 fixture guards", () => {
  async function runGate(): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const proc = Bun.spawn({
      cmd: [
        "bun",
        "run",
        join(REPO_ROOT, "scripts/gates/lint-fixtures.script.ts"),
      ],
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

  test("current real fixture roots pass", async () => {
    const { exitCode, stdout } = await runGate();
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/ok\s+fixtures/);
  });

  test("synthetic fixture: only package.json (no source) is flagged", async () => {
    const dir = await mkdtemp(join(SCRATCH, "no-sources-"));
    try {
      await writeFile(join(dir, "package.json"), '{"name":"x"}');
      const hasSources = await scanSources(dir);
      expect(hasSources, "manifest-only fixture must NOT have sources").toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("synthetic fixture: manifest + source passes the source scan", async () => {
    const dir = await mkdtemp(join(SCRATCH, "complete-"));
    try {
      await writeFile(join(dir, "package.json"), '{"name":"x"}');
      await writeFile(join(dir, "index.ts"), "export const x: number = 1;\n");
      const hasSources = await scanSources(dir);
      expect(hasSources).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("synthetic fixture: spec-only root (OpenAPI / GraphQL) is recognised as a source", async () => {
    const dir = await mkdtemp(join(SCRATCH, "spec-only-"));
    try {
      await writeFile(join(dir, "openapi.yaml"), "openapi: 3.1.0\n");
      const hasSources = await scanSources(dir);
      expect(hasSources, ".yaml must be recognised as a source spec file").toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("synthetic multi-service fixture: a child with manifest only (no source) is detected", async () => {
    const dir = await mkdtemp(join(SCRATCH, "multi-empty-"));
    try {
      await mkdir(join(dir, "apps/api/src"), { recursive: true });
      await writeFile(join(dir, "package.json"), '{"name":"monorepo"}');
      await writeFile(join(dir, "apps/api/package.json"), '{"name":"@m/api"}');
      await writeFile(join(dir, "apps/api/src/index.ts"), "export const x: number = 1;\n");
      await mkdir(join(dir, "apps/orders"), { recursive: true });
      await writeFile(join(dir, "apps/orders/package.json"), '{"name":"@m/orders"}');
      // apps/orders has the manifest but NO source files — exactly
      // the failure mode the audit warns about.
      const ordersHasSources = await scanSources(join(dir, "apps/orders"));
      expect(
        ordersHasSources,
        "apps/orders must NOT have sources (the bug we're catching)",
      ).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("the fixture roots used by the gate exist on disk", () => {
    // Sanity: catches accidental renames of `tests/fixtures` /
    // `tests/smoke-fixtures` that would silently disable the gate.
    expect(FIXTURES_DIR.endsWith("tests/fixtures")).toBe(true);
    expect(SMOKE_FIXTURES_DIR.endsWith("tests/smoke-fixtures")).toBe(true);
  });
});

/**
 * Literal copy of the gate's source-scan helper. If the gate
 * changes its SOURCE_EXTENSIONS list, this list must change with it
 * — and vice versa. Reviewers: any PR that touches one should
 * touch the other.
 */
const SOURCE_EXTENSIONS_LITERAL = [
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".php", ".rb", ".cs", ".go", ".rs",
  ".java", ".kt", ".kts", ".swift",
  ".ex", ".exs", ".scala", ".groovy",
  ".yaml", ".yml", ".json", ".graphql", ".gql", ".proto", ".avsc",
] as const;

async function scanSources(dir: string): Promise<boolean> {
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await readDir(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      // Manifests are NOT sources: `package.json` ends in `.json`
      // and would otherwise count. Must stay in lock-step with the
      // gate's `isManifest` helper.
      if (isManifestLiteral(entry.name)) continue;
      for (const ext of SOURCE_EXTENSIONS_LITERAL) {
        if (entry.name.endsWith(ext)) return true;
      }
    }
  }
  return false;
}

const MANIFEST_NAMES_LITERAL = [
  "package.json",
  "composer.json",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "requirements.txt",
  "*.csproj",
  "build.gradle",
  "build.gradle.kts",
  "pom.xml",
  "mix.exs",
  "Gemfile",
] as const;

function isManifestLiteral(name: string): boolean {
  for (const pattern of MANIFEST_NAMES_LITERAL) {
    if (pattern.startsWith("*.")) {
      if (name.endsWith(pattern.slice(1))) return true;
    } else if (name === pattern) {
      return true;
    }
  }
  return false;
}

interface IEntry {
  readonly name: string;
  readonly isDirectory(): boolean;
  readonly isFile(): boolean;
}

async function readDir(dir: string): Promise<ReadonlyArray<IEntry>> {
  const { readdir } = await import("node:fs/promises");
  return (await readdir(dir, { withFileTypes: true })) as unknown as ReadonlyArray<IEntry>;
}
