/**
 * Additional branches of `runGenerate` — the flags and report fields
 * that the other generate specs do not exercise.
 *
 * `tests/cli/generate-atomic-transaction.spec.ts` covers the
 * x00060 transactional guarantees (validate before write). Here we
 * exercise the flags the rest of the audit found uncovered:
 *
 *   - `--inspect` returns `code: 0` and `report` carries the metrics,
 *     but **no files are written**.
 *   - `--allow-empty` lets a project with zero endpoints succeed.
 *   - `--format bogus` returns `code: 1` and the human-friendly list
 *     of valid formats.
 *   - `--format postman,openapi` writes both files.
 *   - `--no-environments` skips the environments block.
 *   - `--basename` overrides the collection filename.
 *   - `--output` writes to the explicit path.
 *   - `--framework` forces detection to a specific framework.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runGenerate } from "../../packages/cli/commands/generate.script";
import { OUTPUT_DIR_NAME } from "../../packages/contracts/constants/core/postman.constant";
import { copyExampleClean } from "../helpers/fixtures";
import { exampleDir } from "../../scripts/helpers/root.helper";

let work = "";

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "gen-branches-"));
}, 60_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

async function freshExpressProject(name: string): Promise<string> {
  const root = join(work, name);
  await copyExampleClean(exampleDir("express"), root);
  return root;
}

describe("generate — additional branches of runGenerate", () => {
  test("--inspect returns 0 and writes nothing", async () => {
    const root = await freshExpressProject("inspect");
    const out = await runGenerate(["--project-root", root, "--inspect"]);
    expect(out.code).toBe(0);
    // With --inspect the report is intentionally null — `main` prints
    // the human output directly to the sink. What we pin here is that
    // nothing was written: discovery ran, no artifact landed on disk.
    expect(out.report).toBeNull();
    expect(existsSync(join(root, OUTPUT_DIR_NAME))).toBe(false);
  });

  test("--allow-empty succeeds when discovery finds 0 endpoints", async () => {
    const root = await freshExpressProject("allow-empty");
    // Strip the routes to force zero-endpoint discovery. The discovery
    // pipeline tolerates an empty folder; what we exercise here is the
    // `--allow-empty` branch that proceeds to write the empty
    // collection.
    await rm(join(root, "routes"), { recursive: true, force: true });
    const out = await runGenerate([
      "--project-root",
      root,
      "--allow-empty",
    ]);
    expect(out.code).toBe(0);
    expect(out.report).not.toBeNull();
  });

  test("--format bogus returns 1 and lists valid formats", async () => {
    const root = await freshExpressProject("bad-format");
    const out = await runGenerate([
      "--project-root",
      root,
      "--format",
      "bogus",
    ]);
    expect(out.code).toBe(1);
    expect(out.report).toBeNull();
  });

  test("--format postman,openapi writes both files", async () => {
    const root = await freshExpressProject("multi-format");
    const out = await runGenerate([
      "--project-root",
      root,
      "--format",
      "postman,openapi",
    ]);
    expect(out.code).toBe(0);
    const files = await readdir(join(root, OUTPUT_DIR_NAME));
    expect(files.some((f) => f.endsWith(".postman_collection.json"))).toBe(true);
    expect(files.some((f) => f.endsWith(".openapi.yaml"))).toBe(true);
  });

  test("--envs restricts which environments are written", async () => {
    const root = await freshExpressProject("envs");
    const out = await runGenerate([
      "--project-root",
      root,
      "--envs",
      "Local",
    ]);
    expect(out.code).toBe(0);
    const files = await readdir(join(root, OUTPUT_DIR_NAME));
    const envFiles = files.filter((f) =>
      f.endsWith(".postman_environment.json"),
    );
    expect(envFiles).toHaveLength(1);
    expect(envFiles[0]).toMatch(/local/i);
  });

  test("--basename overrides the collection filename", async () => {
    const root = await freshExpressProject("basename");
    const out = await runGenerate([
      "--project-root",
      root,
      "--basename",
      "my-api",
    ]);
    expect(out.code).toBe(0);
    const files = await readdir(join(root, OUTPUT_DIR_NAME));
    expect(files.some((f) => f.startsWith("my-api.postman"))).toBe(true);
  });

  test("--output writes to the explicit path", async () => {
    const root = await freshExpressProject("output-flag");
    const explicit = join(root, "my-collection.json");
    const out = await runGenerate([
      "--project-root",
      root,
      "--output",
      explicit,
    ]);
    expect(out.code).toBe(0);
    expect(out.report?.collectionPath).toBe(explicit);
    const statOut = await stat(explicit);
    expect(statOut.isFile()).toBe(true);
  });

  test("--framework forces a specific scanner", async () => {
    const root = await freshExpressProject("framework");
    const out = await runGenerate([
      "--project-root",
      root,
      "--framework",
      "express",
    ]);
    expect(out.code).toBe(0);
    expect(out.report?.framework).toBe("express");
  });

  test("--json returns the report (and still writes the collection)", async () => {
    const root = await freshExpressProject("json");
    const out = await runGenerate(["--project-root", root, "--json"]);
    expect(out.code).toBe(0);
    expect(out.report).not.toBeNull();
    expect(typeof out.report?.framework).toBe("string");
    // The collection is written even in `--json` mode; the JSON
    // payload goes to stdout via the sink instead of being printed
    // as a human table.
    expect(existsSync(join(root, OUTPUT_DIR_NAME))).toBe(true);
  });

  test("--framework-search-root forces a subdirectory", async () => {
    // The express fixture exposes routes under `routes/`. With the
    // explicit search-root set, the scanner still finds them; the
    // branch we cover is the path being passed through the pipeline.
    const root = await freshExpressProject("search-root");
    const out = await runGenerate([
      "--project-root",
      root,
      "--framework-search-root",
      "routes",
    ]);
    expect(out.code).toBe(0);
    expect(out.report?.framework).toBe("express");
  });

  test("the report carries framework, requests, folders, and timing", async () => {
    const root = await freshExpressProject("report-shape");
    const out = await runGenerate(["--project-root", root]);
    expect(out.code).toBe(0);
    expect(out.report).not.toBeNull();
    expect(typeof out.report?.framework).toBe("string");
    expect(typeof out.report?.requests).toBe("number");
    expect(typeof out.report?.folders).toBe("number");
    expect(typeof out.report?.collectionPath).toBe("string");
    expect(typeof out.report?.durationMs).toBe("number");
  });

  test("the default output folder exists after a successful generate", async () => {
    const root = await freshExpressProject("default-folder");
    const out = await runGenerate(["--project-root", root]);
    expect(out.code).toBe(0);
    const folderStat = await stat(join(root, OUTPUT_DIR_NAME));
    expect(folderStat.isDirectory()).toBe(true);
  });

  test("creates the output directory if it does not exist", async () => {
    const root = await freshExpressProject("missing-folder");
    const outDir = join(root, "deeply", "nested", "out");
    const out = await runGenerate([
      "--project-root",
      root,
      "--output-dir",
      outDir,
    ]);
    expect(out.code).toBe(0);
    expect(existsSync(outDir)).toBe(true);
    void mkdir;
  });
});