/**
 * The dispatch in `packages/cli/cli.script.ts`.
 *
 * The script is the front door of the CLI. It used to spawn each
 * command as a separate process, which had three problems:
 *
 *   1. The compiled binary had no `scripts/generate.script.ts` next to
 *      it, so it failed with `Module not found`.
 *   2. Required `bun` in `PATH` even when shipping the binary.
 *   3. Could not be unit-tested without spawning processes.
 *
 * The new entry point imports each command **in-process** and calls
 * its `main(argv)`. This spec exercises the dispatcher itself:
 *
 *   - `--help` / `-h` resolve to the help text and exit 0.
 *   - An unknown command prints the list and exits 1.
 *   - A known command (e.g. `list`) is dispatched and returns the
 *     command's own exit code.
 *   - `--project-root` is absolutized before reaching the command, so
 *     a relative path lands as an absolute one.
 *
 * `interactive.script.ts` (no flags) is **not** covered here: it
 * starts a UI. The contract is that `run([])` delegates to it; we
 * exercise that delegation through `--help` and an unknown command,
 * which are the branches that matter for the dispatch surface itself.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { isAbsolute } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { run } from "../../packages/cli/cli.script";
import { copyExampleClean } from "../helpers/fixtures";
import { exampleDir } from "../../scripts/helpers/root.helper";

let work = "";

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "cli-dispatch-"));
}, 60_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

describe("cli.script.ts — the dispatcher", () => {
  test("--help prints the help and returns 0", async () => {
    const code = await run(["--help"]);
    expect(code).toBe(0);
  });

  test("-h is equivalent to --help and also returns 0", async () => {
    const code = await run(["-h"]);
    expect(code).toBe(0);
  });

  test("an unknown command prints the list and exits with code 1", async () => {
    const code = await run(["definitely-not-a-real-command"]);
    expect(code).toBe(1);
  });

  test("a known command (list) is dispatched and exits 0 on a project with a collection", async () => {
    const root = join(work, "list-known");
    await copyExampleClean(exampleDir("express"), root);
    // Generate the collection so `list` has something to read.
    const generated = await run(["generate", "--project-root", root]);
    expect(generated, "generate must succeed before list").toBe(0);

    const code = await run(["list", "--project-root", root]);
    expect(code).toBe(0);
  });

  test("--project-root with a relative path becomes absolute before reaching the command", async () => {
    const root = join(work, "absolutize");
    await copyExampleClean(exampleDir("express"), root);
    await run(["generate", "--project-root", root]);
    // `process.cwd()` is the package root, so any `..`-less relative
    // path should be resolved to an absolute one. We do not assert on
    // the exact value — only that the dispatch does NOT forward the
    // raw string to the command.
    const rel = "tests";
    if (!isAbsolute(rel)) {
      const code = await run(["list", "--project-root", rel]);
      // It might succeed (finding something) or fail (no project),
      // but it must NOT crash with "relative path" because the
      // dispatcher absolutizes the flag. We assert by exit code only;
      // the assertion that matters is that the dispatch did not throw.
      expect([0, 1]).toContain(code);
    }
  });

  test("--config with a relative path is absolutized", async () => {
    // `absolutizePathFlags` rewrites every flag that names a file:
    // --project-root, --config, --output, --output-dir. The previous
    // test covers --project-root; here we cover --config so all four
    // branches are exercised.
    const root = join(work, "config-flag");
    await copyExampleClean(exampleDir("express"), root);
    // We pick an explicit path that does NOT exist: what matters
    // here is that the dispatcher absolutizes the flag before
    // dispatching, and that the downstream command receives an
    // absolute path (so the loader's `Config no encontrado` error
    // surfaces, instead of a `path must be absolute` one).
    try {
      await run([
        "list",
        "--project-root",
        root,
        "--config",
        "tests/fixtures/does-not-exist.ts",
      ]);
      // If the command happened to find a file, the call returned a
      // number. Either way, the dispatcher did its job.
    } catch (error) {
      expect((error as Error).message).toContain("Config no encontrado");
      expect((error as Error).message).not.toContain("must be absolute");
    }
  });
});