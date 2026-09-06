/**
 * `bin/apisrc` invoked through a symlink (the `node_modules/.bin/apisrc`
 * case) must resolve to the real script and run the local CLI source.
 *
 * Before the symlink-resolution patch, `$(cd "$(dirname "$0")" && pwd)`
 * returned the symlink's directory — `<tmpdir>` in this test — so
 * `HERE/../packages/cli/cli.script.ts` did not exist and the launcher
 * fell through to `bunx` / `npx` / the network download. This test
 * pins the corrected behaviour: the symlink resolves, the local CLI
 * runs, and stderr stays free of the network-fallback markers.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fromRoot } from "../../scripts/helpers/root.helper";
import { runProcess } from "../helpers/run-process";

const REAL_BIN = fromRoot("bin", "apisrc");

let tmp = "";
let symlinkPath = "";

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "apisrc-symlink-"));
  symlinkPath = join(tmp, "apisrc");
  // Absolute target — `symlink` rejects relative paths with ENOENT
  // when the target is not yet resolved by the kernel.
  await symlink(REAL_BIN, symlinkPath);
});

afterAll(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("bin/apisrc through a symlink", () => {
  test("resolves to the real script and uses the local CLI source", async () => {
    const { code, stdout, stderr } = await runProcess(symlinkPath, ["--help"]);

    expect(code).toBe(0);
    // The local CLI's help banner is the proof that `bun
    // packages/cli/cli.script.ts` actually ran — i.e. that `HERE`
    // pointed to the real `bin/`, not to the symlink's directory.
    // `--help` is the only no-op flag with known output: there is no
    // `--version`, no `version`, no `help` subcommand.
    expect(stdout).toMatch(/^apisrc — Tanit/);

    // CRITICAL: the launcher must NOT have fallen through to the
    // network. Any of these strings in stderr means the symlink
    // resolution is broken and we just hit `bunx` / `npx` / the
    // release download. The whole point of the wrapper is to avoid
    // that.
    expect(stderr).not.toContain("bunx");
    expect(stderr).not.toContain("npx");
    expect(stderr).not.toContain("download");
  });
});
