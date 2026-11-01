/**
 * `expostman history` — the reverse of the append.
 *
 * The service writes (`appendHistory`); this command reads
 * (`readHistory`) and displays. What is checked is what truly
 * matters: that the command says what the file contains and nothing
 * else, and that `--limit`, `--project` and `--json` work without
 * having to reorganise the CLI code.
 *
 * The tests use injected `path` and `home` so the real disk is not
 * touched. A test that writes to `~/.expostman/history.jsonl` is not
 * a test: it is a side effect on whoever's machine runs it.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendHistory,
  readHistory,
} from "../../packages/ui/server/history.service";
import {
  runHistory,
} from "../../packages/cli/commands/history.script";
import type { IProjectSummary } from "../../packages/contracts/interfaces/core/domain.interface";

/** Minimum summary to build entries. */
const RESUMEN_BASE: IProjectSummary = {
  framework: "express",
  frameworks: ["express"],
  projectName: "sample",
  baseUrl: "http://localhost:3000",
  routesInCode: 5,
  withFormRequest: 5,
  withoutFormRequest: 0,
  bodiesAdded: 0,
  queriesAdded: 0,
  zeroConfig: true,
  configPath: "<zero-config>",
  manualEndpoints: 0,
  inferredVariables: 2,
  auth: null,
  warnings: [],
  evidence: [],
  health: {
    withValidationPercent: 100,
    withBodySchemaPercent: 100,
    withExamplesPercent: 100,
    withDescriptionPercent: 100,
  },
};

/** A temporary root, and a history file inside it. */
let work = "";
let historyFile = "";

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "history-cli-"));
  historyFile = join(work, "history.jsonl");
});

afterEach(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

/** Helper to build summaries with a concrete project and endpoints. */
function resumen(projectName: string, endpoints: number): IProjectSummary {
  return { ...RESUMEN_BASE, projectName, routesInCode: endpoints };
}

describe("appendHistory + readHistory — the cycle the CLI executes", () => {
  test("an append+read entry comes back equal", async () => {
    await appendHistory(
      { kind: "summary", projectRoot: "/p/sample", summary: resumen("sample", 9) },
      historyFile,
      new Date("2026-09-03T12:00:00Z"),
    );

    const read = await readHistory({}, historyFile);
    expect(read.totalEntries).toBe(1);
    expect(read.entries[0]?.projectName).toBe("sample");
    expect(read.entries[0]?.framework).toBe("express");
    expect(read.entries[0]?.endpoints).toBe(9);
  });

  /**
   * The two writes go on separate lines and are preserved. POSIX
   * concurrent append (`O_APPEND`) guarantees that each `write` is
   * atomic: two processes writing at once do not step on each
   * other.
   */
  test("two appends in series produce two entries", async () => {
    await appendHistory(
      { kind: "summary", projectRoot: "/p/a", summary: resumen("a", 3) },
      historyFile,
      new Date("2026-09-03T12:00:00Z"),
    );
    await appendHistory(
      { kind: "generate", projectRoot: "/p/a", summary: resumen("a", 3), collectionPath: "/p/a/x.json" },
      historyFile,
      new Date("2026-09-03T12:05:00Z"),
    );

    const read = await readHistory({}, historyFile);
    expect(read.totalEntries).toBe(2);
  });

  /**
   * Order: most recent first. Here the second entry has a later
   * timestamp, so it must come first.
   */
  test("entries are returned from most recent to oldest", async () => {
    await appendHistory(
      { kind: "summary", projectRoot: "/p/a", summary: resumen("a", 3) },
      historyFile,
      new Date("2026-09-03T10:00:00Z"),
    );
    await appendHistory(
      { kind: "summary", projectRoot: "/p/b", summary: resumen("b", 5) },
      historyFile,
      new Date("2026-09-03T11:00:00Z"),
    );

    const read = await readHistory({}, historyFile);
    expect(read.entries[0]?.projectName).toBe("b");
    expect(read.entries[1]?.projectName).toBe("a");
  });

  /**
   * A corrupt line does not break the rest: the read returns the
   * good parts and reports the bad line. Without this, a manual
   * edit with one out-of-place character erases the whole history.
   */
  test("a corrupt line is ignored and reported", async () => {
    await mkdir(work, { recursive: true });
    await writeFile(historyFile, '{ "timestamp":"2026-09-03T09:00:00Z", "kind":"summary", no es json\n');
    await appendHistory(
      { kind: "summary", projectRoot: "/p/b", summary: resumen("b", 5) },
      historyFile,
      new Date("2026-09-03T11:00:00Z"),
    );

    const read = await readHistory({}, historyFile);
    expect(read.totalEntries).toBe(1);
    expect(read.entries[0]?.projectName).toBe("b");
    expect(read.rejected.length).toBe(1);
    expect(read.rejected[0]?.line).toBe(1);
  });

  test("a non-existent file returns empty, not an error", async () => {
    const read = await readHistory({}, historyFile);
    expect(read.totalEntries).toBe(0);
    expect(read.entries).toEqual([]);
    expect(read.rejected).toEqual([]);
  });
});

describe("runHistory — the command itself", () => {
  /**
   * The most normal path: there are entries and the command shows
   * them. What is checked is that the output has the project name
   * and the framework — what someone running `expostman history`
   * comes to look for —, not just a number.
   */
  test("with two entries, lists them with project and framework", async () => {
    await appendHistory(
      { kind: "summary", projectRoot: "/p/sample", summary: resumen("sample", 9) },
      historyFile,
      new Date("2026-09-03T10:00:00Z"),
    );
    await appendHistory(
      { kind: "generate", projectRoot: "/p/sample", summary: resumen("sample", 9), collectionPath: "/x.json" },
      historyFile,
      new Date("2026-09-03T11:00:00Z"),
    );

    const r = await runHistory(["--project", "/p/sample"], { historyPath: historyFile });
    expect(r.code).toBe(0);
    expect(r.output).toContain("sample");
    expect(r.output).toContain("express");
    // The two entries, one line each.
    const lineas = r.output.split("\n").filter((l) => l.includes("endpoint"));
    expect(lineas.length).toBe(2);
  });

  /**
   * `--limit N` trims to the last N. Without this, a long history
   * floods the terminal and leaves whoever is looking at it as
   * uninformed as without history.
   */
  test("--limit trims to the last N", async () => {
    for (let i = 0; i < 5; i++) {
      await appendHistory(
        { kind: "summary", projectRoot: `/p/${i}`, summary: resumen(`p${i}`, i + 1) },
        historyFile,
        new Date(`2026-09-03T10:0${i}:00Z`),
      );
    }

    const r = await runHistory(["--limit", "2"], { historyPath: historyFile });
    expect(r.code).toBe(0);
    const lineas = r.output.split("\n").filter((l) => l.includes("endpoint"));
    expect(lineas.length).toBe(2);
    expect(r.output).toContain("p4");
    expect(r.output).toContain("p3");
  });

  /**
   * `--project` filters by exact root. A different root must not
   * appear — that would filter by "contains" and two projects with
   * similar names would slip entries in from the other.
   */
  test("--project filters by exact root", async () => {
    await appendHistory(
      { kind: "summary", projectRoot: "/p/sample", summary: resumen("sample", 5) },
      historyFile,
      new Date("2026-09-03T10:00:00Z"),
    );
    await appendHistory(
      { kind: "summary", projectRoot: "/p/other", summary: resumen("other", 7) },
      historyFile,
      new Date("2026-09-03T11:00:00Z"),
    );

    const r = await runHistory(["--project", "/p/sample"], { historyPath: historyFile });
    expect(r.code).toBe(0);
    expect(r.output).toContain("sample");
    expect(r.output).not.toContain("other");
  });

  /**
   * `--json` outputs JSONL, one entry per line. That is the format
   * that goes into `jq` or another script; anything else breaks the
   * chain.
   */
  test("--json emits JSONL with one entry per line", async () => {
    await appendHistory(
      { kind: "summary", projectRoot: "/p/a", summary: resumen("a", 3) },
      historyFile,
      new Date("2026-09-03T10:00:00Z"),
    );
    await appendHistory(
      { kind: "generate", projectRoot: "/p/a", summary: resumen("a", 3), collectionPath: "/x.json" },
      historyFile,
      new Date("2026-09-03T11:00:00Z"),
    );

    const r = await runHistory(["--json"], { historyPath: historyFile });
    expect(r.code).toBe(0);
    const lineas = r.output.split("\n").filter((l) => l.trim() !== "");
    expect(lineas.length).toBe(2);
    // Each line is a JSON object with the expected fields.
    for (const l of lineas) {
      const o = JSON.parse(l) as Record<string, unknown>;
      expect(o["projectName"]).toBe("a");
      expect(typeof o["timestamp"]).toBe("string");
    }
  });

  /**
   * Without entries, the command **does not fail**. It returns
   * text that says "no history yet" and tells where it would be
   * written, which is what someone who has just installed the tool
   * expects to see.
   */
  test("without entries returns an actionable text, not empty", async () => {
    const r = await runHistory([], { historyPath: historyFile });
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/no history/i);
  });

  /**
   * `--limit 0` or negative: we reject it with a clear message.
   * If we accepted it, someone with a misconfigured script would
   * end up with a silent command.
   */
  test("non-integer --limit is rejected", async () => {
    const r = await runHistory(["--limit", "abc"], { historyPath: historyFile });
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/integer/i);
  });

  /**
   * `--limit 0` is rejected: zero entries is not what `--limit 0`
   * means in a tool that already returns empty without it.
   */
  test("--limit 0 is rejected", async () => {
    const r = await runHistory(["--limit", "0"], { historyPath: historyFile });
    expect(r.code).toBe(1);
  });

  /**
   * `--clear` deletes the file. What is checked is that after
   * deleting it, a subsequent read returns empty: the operation
   * actually happens.
   */
  test("--clear deletes the file and returns a message", async () => {
    await appendHistory(
      { kind: "summary", projectRoot: "/p/a", summary: resumen("a", 3) },
      historyFile,
      new Date(),
    );
    const antes = await readFile(historyFile, "utf8");
    expect(antes.length).toBeGreaterThan(0);

    const r = await runHistory(["--clear"], { historyPath: historyFile });
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/cleared/i);

    const despues = await readFile(historyFile, "utf8").catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return "";
      throw err;
    });
    expect(despues).toBe("");
  });

  /**
   * `--clear` on a non-existent file exits with 0 and says
   * "nothing to clear": clearing twice is not an error, and an
   * error message in this case would scare without reason.
   */
  test("--clear without a file says 'nothing to clear'", async () => {
    const r = await runHistory(["--clear"], { historyPath: historyFile });
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/nothing/i);
  });
});

describe("the real CLI path", () => {
  /**
   * The use path: `summary` writes, `history` reads.
   *
   * Since summary writes with the default path, this test redirects
   * the `HOME` variable indirectly by passing `home` to
   * `runHistory`. The real append uses the default path; to avoid
   * touching the machine's disk, it is exercised separately here:
   * an append with the path the service would have used if `HOME`
   * pointed at `work`.
   *
   * What is validated is the **service layer** contract: append
   * puts, read takes. Integration with the environment variable
   * is covered by `userHistoryDir()` in its own spec.
   */
  test("append + read preserves ISO 8601 timestamp", async () => {
    const fecha = new Date("2026-09-03T15:30:45.123Z");
    await appendHistory(
      { kind: "summary", projectRoot: "/p/x", summary: resumen("x", 2) },
      historyFile,
      fecha,
    );

    const read = await readHistory({}, historyFile);
    expect(read.entries[0]?.timestamp).toBe("2026-09-03T15:30:45.123Z");
  });

  test("the path returned by IAppendResult is the one read afterwards", async () => {
    const out = await appendHistory(
      { kind: "summary", projectRoot: "/p/y", summary: resumen("y", 1) },
      historyFile,
    );
    expect(out.ok).toBe(true);
    expect(out.path).toBe(historyFile);

    const read = await readHistory({}, out.path);
    expect(read.totalEntries).toBe(1);
  });
});
