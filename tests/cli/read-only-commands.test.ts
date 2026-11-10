/**
 * The four commands that only read: `scan`, `list`, `stats`, `summary`.
 *
 * None had tests. The audit said the next bug would live there, and it
 * did: **`list` listed nothing**. It printed "9 endpoints in the
 * collection, grouped by zone:" and left the screen blank, across all
 * twenty-one frameworks, because it iterated `config.zoneOrder` to
 * print and in zero-config that list comes empty — all endpoints fall
 * in `defaultZone`, which is not in it. `stats` had the same flaw in
 * its "By zone" section. A whole command without useful output, and
 * the other with a dead section.
 *
 * Each command is exercised against a REST project and one of **RPC
 * over POST**, because that is where the assumption that the URL
 * identifies the operation has bitten four times: in GraphQL the five
 * operations share `POST /graphql`.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CLI_COMMANDS_DIR, exampleDir } from "../../scripts/helpers/root.helper";
import { copyExampleClean } from "../helpers/fixtures";
import { runProcess } from "../helpers/run-process";

/** Test projects: one REST and one of RPC over POST. */
const PROYECTOS = [
  { framework: "express", endpoints: 9, rpc: false },
  { framework: "graphql", endpoints: 5, rpc: true },
] as const;

let work = "";
const raiz = new Map<string, string>();

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "read-only-"));
  for (const { framework } of PROYECTOS) {
    const root = join(work, framework);
    await copyExampleClean(exampleDir(framework), root);
    await runProcess("bun", [
      join(CLI_COMMANDS_DIR, "generate.script.ts"),
      "--project-root",
      root,
    ]);
    raiz.set(framework, root);
  }
}, 240_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

function run(comando: string, framework: string): Promise<{ code: number; output: string }> {
  return runProcess("bun", [
    join(CLI_COMMANDS_DIR, `${comando}.script.ts`),
    "--project-root",
    raiz.get(framework) ?? "",
  ]);
}

describe.each(PROYECTOS)("on $framework", ({ framework, endpoints, rpc }) => {
  test("scan finds the project and its routes", { timeout: 120_000 }, async () => {
    const { code, output } = await run("scan", framework);
    expect(code, output).toBe(0);
    expect(output).toContain(framework);
    expect(output).toMatch(new RegExp(`${endpoints} routes`));
  });

  /**
   * THE test. Without it, `list` said how many there were and showed
   * none.
   */
  test("list shows the endpoints, not just how many", { timeout: 120_000 }, async () => {
    const { code, output } = await run("list-endpoints", framework);
    expect(code, output).toBe(0);
    expect(output).toContain(`${endpoints} endpoints`);
    // One line per endpoint, with its method.
    const lineas = output.split("\n").filter((l) => /^\s{2}(GET|POST|PUT|PATCH|DELETE)\s/.test(l));
    expect(lineas.length).toBe(endpoints);
  });

  test("list groups under a zone header", { timeout: 120_000 }, async () => {
    const { output } = await run("list-endpoints", framework);
    expect(output).toMatch(/─── .+ \(\d+\) ───/);
  });

  test("stats counts the same as list", { timeout: 120_000 }, async () => {
    const { code, output } = await run("stats", framework);
    expect(code, output).toBe(0);
    expect(output).toContain(`Total requests: ${endpoints}`);
  });

  test("stats does not leave the zones section empty", { timeout: 120_000 }, async () => {
    const { output } = await run("stats", framework);
    const zonas = output.slice(output.indexOf("By zone:"));
    expect(zonas).toMatch(/─── .+ \(\d+\) ───/);
  });

  test("summary counts the same endpoints as list", { timeout: 120_000 }, async () => {
    const { code, output } = await run("summary", framework);
    expect(code, output).toBe(0);
    // It reads the **source**, not the collection, so the number
    // must match that of `list` without having looked at the file.
    expect(output).toMatch(new RegExp(`Endpoints:\\s+${endpoints}`));
    expect(output).toContain(framework);
  });

  /**
   * In RPC over POST the operations share method and URL, so a
   * listing without names is five identical lines: it says nothing.
   */
  test.skipIf(!rpc)(
    "list distinguishes operations that share an endpoint",
    { timeout: 120_000 },
    async () => {
      const { output } = await run("list-endpoints", framework);
      const nombres = output
        .split("\n")
        .filter((l) => l.includes("POST"))
        .map((l) => l.trim());
      expect(new Set(nombres).size).toBe(endpoints);
    },
  );
});

describe("without a collection on disk", () => {
  let vacio = "";

  beforeAll(async () => {
    vacio = join(work, "sin-coleccion");
    await copyExampleClean(exampleDir("express"), vacio);
  }, 60_000);

  /**
   * `list` and `stats` read the collection. Without it they used to
   * dump Bun —five lines of ENOENT with the command source on top—
   * and not a word about what to do, when the answer is always the
   * same: generate first.
   *
   * An error that does not state the exit leaves whoever reads it
   * equally stuck, and on top of it looks like the tool has broken.
   */
  test.for(["list-endpoints", "stats"] as const)(
    "%s explains that the collection is missing and how to generate it",
    { timeout: 120_000 },
    async (comando) => {
      const { code, output } = await runProcess("bun", [
        join(CLI_COMMANDS_DIR, `${comando}.script.ts`),
        "--project-root",
        vacio,
      ]);
      expect(code).toBe(1);
      expect(output).toContain("No collection");
      // The output, not only the diagnostic.
      expect(output).toContain("generate");
      // And none of the dump that was there before.
      expect(output).not.toContain("ENOENT");
      expect(output).not.toContain("syscall");
    },
  );

  /** `summary` and `scan` read the source, so they do not need a collection. */
  test.for(["summary", "scan"] as const)(
    "%s works the same without a collection",
    { timeout: 120_000 },
    async (comando) => {
      const { code } = await runProcess("bun", [
        join(CLI_COMMANDS_DIR, `${comando}.script.ts`),
        "--project-root",
        vacio,
      ]);
      expect(code).toBe(0);
    },
  );
});
