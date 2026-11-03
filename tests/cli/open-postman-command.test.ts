/**
 * `open-postman.script.ts` — `main()` in-process.
 *
 * `open` opens the generated collection in the Postman desktop app or
 * the web importer. The desktop branch spawns a process (`xdg-open`,
 * `open -a`, `cmd /c start`); we deliberately do **not** exercise
 * that here, because CI has no display and no Postman installed.
 *
 * What we cover is the deterministic surface:
 *
 *   - `--web` opens the web importer and returns 0.
 *   - "No collection": prints an actionable error and returns 1.
 *   - `--file <path>` uses the explicit path even when discovery
 *     fails; this is the contract used by the `writing-commands`
 *     spec for `--open`.
 *
 * The dispatcher branches (`darwin`, `win32`, `linux`) are not
 * exercised individually; their non-determinism (process spawn) does
 * not belong in a unit spec.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { main } from "../../packages/cli/commands/open-postman.script";
import { runGenerate } from "../../packages/cli/commands/generate.script";
import { OUTPUT_DIR_NAME } from "../../packages/contracts/constants/core/postman.constant";
import { copyExampleClean } from "../helpers/fixtures";
import { exampleDir } from "../../scripts/helpers/root.helper";

let work = "";

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "open-cmd-"));
}, 60_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

async function generatedProject(name: string): Promise<string> {
  const root = join(work, name);
  await copyExampleClean(exampleDir("express"), root);
  const out = await runGenerate(["--project-root", root]);
  expect(out.code, "runGenerate must succeed").toBe(0);
  return root;
}

async function withArgv<T>(
  args: ReadonlyArray<string>,
  fn: () => Promise<T>,
): Promise<T> {
  const saved = [...process.argv];
  try {
    process.argv = ["node", "open-postman.script.ts", ...args];
    return await fn();
  } finally {
    process.argv = saved;
  }
}

describe("open-postman — main()", () => {
  test("--web returns 0 and prints the web importer URL", async () => {
    const root = await generatedProject("web");
    const logs: string[] = [];
    const saved = console.log;
    console.log = (...values: ReadonlyArray<unknown>): void => {
      for (const v of values) logs.push(String(v));
    };
    try {
      const code = await withArgv(
        ["--project-root", root, "--web"],
        () => main(),
      );
      expect(code).toBe(0);
    } finally {
      console.log = saved;
    }
    expect(logs.join("\n")).toContain("https://app.postman.com/import");
  });

  test("returns 1 when the collection does not exist", async () => {
    const root = join(work, "no-collection");
    await copyExampleClean(exampleDir("express"), root);
    await rm(join(root, OUTPUT_DIR_NAME), { recursive: true, force: true });
    const code = await withArgv(["--project-root", root], () => main());
    expect(code).toBe(1);
  });

  test("--file <path> uses the explicit path even without discovery", async () => {
    const root = join(work, "explicit-file");
    await copyExampleClean(exampleDir("express"), root);
    const explicitFile = join(root, "my-collection.json");
    await writeFile(explicitFile, JSON.stringify({ info: { name: "x" } }));
    const code = await withArgv(
      ["--project-root", root, "--web", "--file", explicitFile],
      () => main(),
    );
    expect(code).toBe(0);
  });

  test("non-web branch prints the path being opened", async () => {
    // The non-`--web` branch in `main()` prints the path it is
    // about to open and then attempts `xdg-open` / `gio open` /
    // `open` / the web importer fallback depending on the
    // platform. We pin the output rather than the exit code
    // because the CI environment may or may not have a desktop
    // helper installed.
    const root = await generatedProject("linux-fallback");
    const logs: string[] = [];
    const saved = console.log;
    console.log = (...values: ReadonlyArray<unknown>): void => {
      for (const v of values) logs.push(String(v));
    };
    try {
      const code = await withArgv(
        ["--project-root", root],
        () => main(),
      );
      expect([0, 1]).toContain(code);
    } finally {
      console.log = saved;
    }
    expect(logs.join("\n")).toContain("Opening Postman with:");
    expect(logs.join("\n")).toContain("Platform:");
  });
});