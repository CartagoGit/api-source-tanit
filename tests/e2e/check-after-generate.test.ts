/**
 * Generate and check, across all twenty-one frameworks.
 *
 * The invariant is the simplest one there is: a **freshly generated**
 * collection of a project is, by definition, in sync with that project.
 * If `check` says otherwise, `check` is wrong.
 *
 * Measured before writing this: **13 of 22 examples** reported total
 * drift on a collection that had just come out of `generate`. `check` is
 * one of the ten MCP tools, and its only question is "has my collection
 * gone out of sync?"; answering yes always makes an agent regenerate in
 * a loop.
 *
 * ## Why there was no test
 *
 * There was: `check-rpc.test.ts` and `check.tool.spec.ts`. Both test
 * GraphQL, and GraphQL was one of the nine that worked. Per-framework
 * coverage for this command was 9 %, and the bug lived in the remaining
 * 91 %.
 *
 * ## What is asserted, and what is not
 *
 * A specific number of endpoints is not asserted: that would force
 * keeping twenty-one figures updated every time an example changes, and
 * is exactly what makes such a test eventually get deleted. What is
 * asserted is that **both drift lists are empty** — the real property,
 * which holds equally across all twenty-one.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CLI_COMMANDS_DIR, EXAMPLES_DIR, exampleDir } from "../../scripts/helpers/root.helper";
import { copyExampleClean } from "../helpers/fixtures";
import { runProcess } from "../helpers/run-process";

/**
 * The examples, read from disk.
 *
 * `FRAMEWORK_IDS` is not used: some examples are not a framework
 * — `example-app`, `example-openapi-headers` — and they count too,
 * because they are real projects that someone might scan.
 */
const EJEMPLOS = (await readdir(EXAMPLES_DIR, { withFileTypes: true }))
  .filter((e) => e.isDirectory() && e.name.startsWith("example-"))
  .map((e) => e.name.replace(/^example-/, ""))
  .sort();

let work = "";
const raiz = new Map<string, string>();

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "check-tras-generar-"));
  for (const framework of EJEMPLOS) {
    const root = join(work, framework);
    await copyExampleClean(exampleDir(framework), root);
    await runProcess("bun", [
      join(CLI_COMMANDS_DIR, "generate.script.ts"),
      "--project-root",
      root,
    ]);
    raiz.set(framework, root);
  }
}, 900_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

describe("una colección recién generada está al día", () => {
  test("there are examples to check", () => {
    expect(EJEMPLOS.length).toBeGreaterThan(20);
  });

  test.for(EJEMPLOS)(
    "%s: `check` finds no drift",
    { timeout: 240_000 },
    async (framework) => {
      const { code, output } = await runProcess("bun", [
        join(CLI_COMMANDS_DIR, "diff.script.ts"),
        "--project-root",
        raiz.get(framework) ?? "",
      ]);

      expect(
        output,
        `${framework}: the collection just came out of \`generate\` and \`check\` sees drift`,
      ).toContain("in sync");
      expect(code, output).toBe(0);
    },
  );
});
