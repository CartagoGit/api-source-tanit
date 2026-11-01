/**
 * The `bin/` launchers.
 *
 * Their contract is short and must be defended: **they resolve the
 * engine and pass the arguments, and nothing else**. The previous
 * version of this (`runtime/`, retired in p00021) reimplemented the
 * generator in Node, Python and PHP; the three copies diverged from
 * the original and none had a single test. When the project became
 * framework-agnostic, all three were still Laravel-only and nobody
 * noticed.
 *
 * That is why what is checked here is not so much that they work —that
 * depends on the platform— but that **they stay thin**: if any of them
 * starts to talk about routes, frameworks or collections, it is wrong.
 */
import { describe, expect, test } from "vitest";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { REPO_ROOT, fromRoot } from "../../scripts/helpers/root.helper";
import { runProcess } from "../helpers/run-process";

const BIN_DIR = fromRoot("bin");
const WRAPPERS_DIR = join(BIN_DIR, "wrappers");

/** Words that betray domain logic inside a launcher. */
const DOMAIN_WORDS = [
  "postman_collection",
  "laravel",
  "scanner",
  "endpoint",
  "framework",
  "_postman_id",
];

/**
 * The launchers, files only.
 *
 * Filtering by type and not by name matters: the Python syntax test
 * left a `__pycache__/` inside `wrappers/` and the next test tried to
 * read it as a file (EISDIR).
 */
async function launcherFiles(): Promise<string[]> {
  const candidates: string[] = [];
  for (const [dir, names] of [
    [BIN_DIR, await readdir(BIN_DIR)],
    [WRAPPERS_DIR, await readdir(WRAPPERS_DIR)],
  ] as Array<[string, string[]]>) {
    for (const name of names) {
      const full = join(dir, name);
      if ((await stat(full)).isFile()) candidates.push(full);
    }
  }
  return candidates;
}

describe("the launchers are thin", () => {
  test("there is a POSIX launcher and a Windows one", async () => {
    const names = await readdir(BIN_DIR);
    // The canonical name lives in `BIN_NAME` (contracts) and is
    // pinned by the test below against the `bin` of package.json;
    // here only the existence of both launchers under that name is
    // checked.
    expect(names).toContain("apisrc");
    expect(names).toContain("apisrc.ps1");
  });

  test("none exceeds 130 lines", async () => {
    for (const file of await launcherFiles()) {
      const lines = (await readFile(file, "utf8")).split("\n").length;
      // 130 (no 100): `bin/apisrc` necesita ~21 líneas extra para
      // resolver el caso de invocación vía symlink (`node_modules/.bin/apisrc`).
      // Sigue siendo "thin" frente a cualquier reimplementación del
      // motor en el propio lanzador.
      expect(lines, file).toBeLessThan(130);
    }
  });

  // The test that really matters: that a reimplementation disguised
  // as a wrapper does not reappear.
  test("none contains domain logic", async () => {
    for (const file of await launcherFiles()) {
      const source = (await readFile(file, "utf8")).toLowerCase();
      // Mentions in comments explain exactly this, so only code
      // lines are inspected.
      const code = source
        .split("\n")
        .filter((line) => !/^\s*(#|\/\/|\*|<!--)/.test(line))
        .join("\n");
      for (const word of DOMAIN_WORDS) {
        expect(code.includes(word), `${file} menciona "${word}"`).toBe(false);
      }
    }
  });

  test("the POSIX launcher is executable", async () => {
    const mode = (await stat(join(BIN_DIR, "apisrc"))).mode;
    // eslint-disable-next-line no-bitwise
    expect(mode & 0o111).toBeGreaterThan(0);
  });

  test("the POSIX launcher is syntactically valid", async () => {
    const result = await runProcess("sh", ["-n", join(BIN_DIR, "apisrc")]);
    expect(result.code, result.output).toBe(0);
  });

  // `py_compile` would write a `__pycache__/` inside `wrappers/`.
  // `compile()` does the same check without leaving a trace.
  test("the Python wrapper is syntactically valid", async () => {
    const path = join(WRAPPERS_DIR, "apisrc.py");
    const result = await runProcess("python3", [
      "-c",
      `compile(open(${JSON.stringify(path)}).read(), ${JSON.stringify(path)}, "exec")`,
    ]);
    expect(result.code, result.output).toBe(0);
  });

  test("all point to the same canonical name", async () => {
    for (const file of await launcherFiles()) {
      const source = await readFile(file, "utf8");
      expect(source, file).toMatch(/apisrc/);
      // The old name must not survive in a new launcher.
      expect(source, file).not.toMatch(/postman-from-routes/);
    }
  });
});

/**
 * The executable name, in one place.
 *
 * It was hand-written in the build script and stayed as
 * `postman-from-routes` —the old name— when the product was renamed.
 * Release binaries came out with a name that did not exist anywhere
 * else in the project, and the workflow that publishes them looked
 * for that pattern: the two matched **in being wrong**, so nothing
 * failed.
 */
describe("the binary name", () => {
  test("is the same as the `bin` of package.json", async () => {
    const { BIN_NAME } = await import("../../packages/contracts/constants/core/postman.constant");
    const pkg = JSON.parse(
      await readFile(join(REPO_ROOT, "package.json"), "utf8"),
    ) as { bin?: Record<string, string> };
    expect(Object.keys(pkg.bin ?? {})).toContain(BIN_NAME);
  });

  test("the releases workflow publishes that pattern, not another", async () => {
    const { BIN_NAME } = await import("../../packages/contracts/constants/core/postman.constant");
    const workflow = await readFile(
      join(REPO_ROOT, ".github", "workflows", "release-binaries.yml"),
      "utf8",
    );
    expect(workflow).toContain(`dist/${BIN_NAME}-`);
    // Publishing a pattern that is no longer generated would leave the release empty.
    expect(workflow).not.toMatch(/postman-from-routes/);
  });

  test("the build script does not write it by hand", async () => {
    const source = await readFile(
      join(REPO_ROOT, "scripts", "build", "build-binary.script.ts"),
      "utf8",
    );
    expect(source).toContain("BIN_NAME");
    expect(source).not.toMatch(/["'`]postman-from-routes/);
  });
});
