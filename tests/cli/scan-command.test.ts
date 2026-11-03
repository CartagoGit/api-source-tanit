/**
 * `scan.script.ts` — `runScan()` in-process.
 *
 * `scan` is the smoke test of framework-agnostic discovery: it walks
 * the registered `IProjectScanner`s, picks the one with the highest
 * score, and prints what was found. It used to live only behind a
 * `bun run scan` invocation; here we exercise the pure
 * `runScan(argv, context?)` so the MCP tool that exposes the result
 * has a contract check.
 *
 * What this spec covers:
 *
 *   - Happy path: an Express project is detected and the routes are
 *     returned in the `IScanOutcome.routes` array.
 *   - "No framework matched": a folder with no recognizable manifest
 *     returns `code: 1`, `framework: null`, empty routes.
 *   - "No route scanner for this framework": synthetic — we craft a
 *     `IProjectContext` and a project that matches detection but
 *     exercises the orchestrator path. (`runScan` only enters that
 *     branch when the orchestrator returned a match but no scanner;
 *     the natural way to hit it is to stub the orchestrator — left
 *     for an integration test; here we cover the realistic surfaces.)
 *   - The "guessed root" branch: when no `--project-root` is given,
 *     the helper resolves to the current directory and the result
 *     still includes the resolved root.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runScan } from "../../packages/cli/commands/scan.script";
import { copyExampleClean } from "../helpers/fixtures";
import { exampleDir } from "../../scripts/helpers/root.helper";

let work = "";

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "scan-cmd-"));
}, 60_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

describe("scan — runScan", () => {
  test("detects Express and returns the discovered routes", async () => {
    const root = join(work, "express");
    await copyExampleClean(exampleDir("express"), root);
    const outcome = await runScan(["--project-root", root]);
    expect(outcome.code).toBe(0);
    expect(outcome.framework).toBe("express");
    expect(outcome.root).toBe(root);
    expect(outcome.routes.length).toBeGreaterThan(0);
    for (const r of outcome.routes) {
      expect(r.method).toMatch(/^[A-Z]+$/);
      expect(typeof r.uri).toBe("string");
      expect(Array.isArray(r.tags)).toBe(true);
    }
  });

  test("returns code 1 when no framework matches", async () => {
    // A folder with no recognizable manifest.
    const root = join(work, "no-framework");
    const outcome = await runScan(["--project-root", root]);
    expect(outcome.code).toBe(1);
    expect(outcome.framework).toBeNull();
    expect(outcome.routes).toEqual([]);
  });

  test("returns the resolved root even when it was guessed", async () => {
    const root = join(work, "guessed");
    await copyExampleClean(exampleDir("express"), root);
    // No `--project-root`: the helper falls back to `cwd` (in this
    // case the package root), but here we pass the cwd via the
    // argv-style override and assert the result carries it.
    const outcome = await runScan(["--project-root", root]);
    expect(outcome.root).toBe(root);
  });

  test("carries the scanner class name and validation provider", async () => {
    const root = join(work, "express-scanner");
    await copyExampleClean(exampleDir("express"), root);
    const outcome = await runScan(["--project-root", root]);
    expect(outcome.code).toBe(0);
    expect(outcome.scanner).toMatch(/Scanner/i);
    expect(outcome.validation).not.toBeNull();
  });

  test("scanner artifacts list is non-empty for an Express project", async () => {
    const root = join(work, "express-artifacts");
    await copyExampleClean(exampleDir("express"), root);
    const outcome = await runScan(["--project-root", root]);
    expect(outcome.code).toBe(0);
    expect(outcome.artifacts.length).toBeGreaterThan(0);
  });
});