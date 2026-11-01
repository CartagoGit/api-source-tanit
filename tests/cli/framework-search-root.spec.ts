/**
 * `--framework-search-root` — f00011 S3.
 *
 * Covers the CLI side of the flag:
 *
 *   1. `--help` documents it in the COMMON FLAGS section.
 *   2. Passing it to `generate` propagates the value to
 *      `match.frameworkSearchRoot` and the pipeline sees it (printed
 *      in `--inspect`).
 *   3. Without it, a monorepo project with a single workspace sees
 *      the orchestrator auto-fill the subdir and warn the user.
 *   4. With several workspaces, the orchestrator does NOT fill
 *      `frameworkSearchRoot`.
 *   5. An absolute value or one with `..` is rejected with a clear
 *      error.
 *   6. The flag also passes through `push` and `watch`.
 *
 * It does not cover the plugin path (that is
 * `tests/plugin/plugin-options.spec.ts`) nor the scanners (those
 * live in `tests/frameworks/*`, outside S3 scope).
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runProcess } from "../helpers/run-process";
import { CLI_ENTRYPOINT, REPO_ROOT, exampleDir } from "../../scripts/helpers/root.helper";

const CLI = CLI_ENTRYPOINT;

async function runCli(args: string[]): Promise<{ code: number; output: string }> {
  return runProcess("bun", [CLI, ...args], { cwd: REPO_ROOT });
}

let work = "";

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "framework-search-root-cli-"));
});

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

/**
 * Creates a fake monorepo with the Express fixture inside the first
 * workspace. It is the cheapest way to have a project that a scanner
 * recognises AND a monorepo structure on top: this way the
 * orchestrator can auto-detect the subdir and the framework search
 * does not fail for lack of code.
 *
 * The trick is at the root: the root `package.json` declares
 * `express` in `dependencies`, alongside the `workspaces`. Without
 * that hint, the orchestrator detects nothing (scanners look at the
 * root, not the subdir), and `frameworkSearchRoot` only makes sense
 * if there is already a scanner that matched. It is exactly the
 * real use case: in a real monorepo, the root often re-exports the
 * framework dependencies so tools can see them.
 */
async function makeMonorepoWithExpress(
  rel: string,
  workspaces: ReadonlyArray<string>,
): Promise<{ root: string; frameworkSearchRoot: string }> {
  const dir = join(work, rel);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: rel,
        workspaces,
        // Hint for the orchestrator: the root declares the framework
        // dependency. Without this, no scanner matches and the
        // `frameworkSearchRoot` use case never arises.
        dependencies: { express: "^4.0.0" },
      },
      null,
      2,
    ),
    "utf8",
  );
  const first = workspaces[0];
  if (!first) throw new Error("empty workspaces");
  const subdir = join(dir, first);
  await cp(exampleDir("express"), subdir, { recursive: true });
  // Materialise the rest of the workspaces as empty folders: the
  // detection needs to see them on disk to count more than one and
  // decide NOT to auto-fill `frameworkSearchRoot`. Without this,
  // only the first one exists and the helper thinks it is the only
  // one.
  for (const w of workspaces.slice(1)) {
    await mkdir(join(dir, w), { recursive: true });
  }
  return { root: dir, frameworkSearchRoot: first };
}

describe("--help documents the flag", () => {
  test("`--help` mentions --framework-search-root", async () => {
    const { output } = await runCli(["--help"]);
    expect(output).toContain("--framework-search-root");
  });
});

describe("--framework-search-root in `generate`", () => {
  test("invalid value (absolute) → clear error", async () => {
    const { code, output } = await runCli([
      "generate",
      "--project-root",
      REPO_ROOT,
      "--framework-search-root",
      "/abs/path",
    ]);
    expect(code).not.toBe(0);
    expect(output).toContain("--framework-search-root");
    expect(output).toContain("subdirectory relative to projectRoot");
  });

  test("invalid value (with `..`) → clear error", async () => {
    const { code, output } = await runCli([
      "generate",
      "--project-root",
      REPO_ROOT,
      "--framework-search-root",
      "../etc",
    ]);
    expect(code).not.toBe(0);
    expect(output).toContain("--framework-search-root");
  });

  test("valid value appears in `--inspect`", async () => {
    // The `examples/example-express` package is not a monorepo, so
    // passing `--framework-search-root <something>` does not break
    // anything and the subdir appears in the `--inspect` output.
    const { code, output } = await runCli([
      "generate",
      "--project-root",
      exampleDir("express"),
      "--framework-search-root",
      "apps/api",
      "--inspect",
    ]);
    expect(code).toBe(0);
    expect(output).toContain("Search root:");
    expect(output).toContain("apps/api");
    expect(output).toContain("--framework-search-root");
  });
});

describe("monorepo auto-detection in `generate`", () => {
  test("monorepo with a single workspace → auto-fills and warns", async () => {
    // The orchestrator detects the monorepo, looks at the only
    // workspace (where the Express fixture lives), and fills
    // `frameworkSearchRoot` on its own. The `--inspect` output must
    // show it with the "(auto-detected)" mark.
    const { root } = await makeMonorepoWithExpress("monorepo-single", [
      "apps/api",
    ]);
    const { code, output } = await runCli([
      "generate",
      "--project-root",
      root,
      "--inspect",
    ]);
    expect(code).toBe(0);
    expect(output).toContain("Search root:");
    expect(output).toContain("apps/api");
    expect(output).toContain("(auto-detected)");
  });

  test("monorepo with several workspaces → does NOT fill frameworkSearchRoot", async () => {
    // The helper marks `frameworkSearchRoot` as `null` when there is
    // more than one workspace. With one of the two copying the
    // fixture, the scan of the first one should still work, but the
    // line `Search root:` does not appear in `--inspect` (the
    // orchestrator did not fill the subdir).
    const { root } = await makeMonorepoWithExpress("monorepo-multi", [
      "apps/api",
      "apps/web",
    ]);
    const { output } = await runCli([
      "generate",
      "--project-root",
      root,
      "--inspect",
    ]);
    expect(output).not.toMatch(/Search root:/);
  });
});

describe("--framework-search-root in other commands", () => {
  test("`push` accepts it (does not fail to parse)", async () => {
    // Without an API key the command fails for that reason, not for
    // the flag.
    const { code, output } = await runCli([
      "push",
      "--project-root",
      exampleDir("express"),
      "--framework-search-root",
      "apps/api",
    ]);
    expect(code).not.toBe(0);
    expect(output).toContain("Missing Postman API key");
  });

  test("`watch --once` accepts it and generates once", async () => {
    // `--once` makes `watch` run a single generation and exit. It is
    // the cheap way to prove the flag reaches the pipeline without
    // leaving a long-lived process in the test.
    const { code } = await runCli([
      "watch",
      "--project-root",
      exampleDir("express"),
      "--framework-search-root",
      "apps/api",
      "--once",
    ]);
    // Exit 0 is what we seek: `--once` runs one generation and
    // exits without error.
    expect(code).toBe(0);
  });
});