#!/usr/bin/env bun
/**
 * `bun run ci:summary` — aggregate per-job CI results into a single
 * Markdown report on `$GITHUB_STEP_SUMMARY`.
 *
 * x00071 S1: each CI job now runs in parallel and writes a small
 * machine-readable result file (`$GITHUB_ENV` or a marker file in
 * `ci-results/<job>.txt`). The `ci-summary` job (which depends on
 * all of them and runs `if: always()`) calls this script to fold
 * the lot into one table the reviewer sees on the run page.
 *
 * Inputs come from three sources, in order of priority:
 *
 *   1. `$GITHUB_STEP_SUMMARY` (always available in CI; no-op
 *      locally) — drives the actual summary block.
 *   2. A job-results directory the orchestrator workflow populates
 *      with `<job>.json` files containing `{ name, status, durationMs,
 *      summary }`. The directory defaults to `./ci-results`; pass
 *      another path via `CI_RESULTS_DIR`.
 *   3. If the directory is empty, the script emits a single row
 *      describing itself and exits 0. That makes it safe to run
 *      locally as a dry-run.
 *
 * The script never fails the build. A missing or unreadable
 * results directory produces a polite notice, not an exit code.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

interface IJobResult {
  readonly name: string;
  readonly status: "success" | "failure" | "skipped" | "cancelled";
  readonly durationMs?: number;
  readonly summary?: string;
}

const ANSI_GREEN = "\x1b[32m";
const ANSI_RED = "\x1b[31m";
const ANSI_YELLOW = "\x1b[33m";
const ANSI_RESET = "\x1b[0m";

const STATUS_GLYPH: Record<IJobResult["status"], string> = {
  success: "OK",
  failure: "FAIL",
  skipped: "SKIP",
  cancelled: "CANCEL",
};

const STATUS_COLOR: Record<IJobResult["status"], string> = {
  success: ANSI_GREEN,
  failure: ANSI_RED,
  skipped: ANSI_YELLOW,
  cancelled: ANSI_YELLOW,
};

function readResults(dir: string): IJobResult[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const out: IJobResult[] = [];
  for (const f of files) {
    const path = join(dir, f);
    try {
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as Partial<IJobResult>;
      if (typeof parsed.name !== "string") continue;
      out.push({
        name: parsed.name,
        status: (parsed.status ?? "skipped") as IJobResult["status"],
        durationMs:
          typeof parsed.durationMs === "number" ? parsed.durationMs : undefined,
        summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
      });
    } catch {
      // A malformed file is not a reason to fail the summary job;
      // we surface it as a `skipped` row instead.
      out.push({
        name: f.replace(/\.json$/, ""),
        status: "skipped",
        summary: "could not parse result file",
      });
    }
  }
  return out;
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  const rest = (s - m * 60).toFixed(0);
  return `${m}m ${rest}s`;
}

function renderMarkdown(results: ReadonlyArray<IJobResult>): string {
  if (results.length === 0) {
    return [
      "## CI summary",
      "",
      "_No `ci-results/*.json` files were found. This is expected on",
      "local dry-runs; in CI, each parallel job must drop its",
      "result file before the summary step runs._",
      "",
    ].join("\n");
  }
  const ordered = [...results].sort((a, b) => a.name.localeCompare(b.name));
  const header = [
    "## CI summary",
    "",
    "| Job | Status | Duration | Notes |",
    "|-----|--------|----------|-------|",
  ];
  const rows = ordered.map((r) => {
    const safeSummary = (r.summary ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
    return `| \`${r.name}\` | ${STATUS_GLYPH[r.status]} | ${formatDuration(r.durationMs)} | ${safeSummary} |`;
  });
  const totals = ordered.reduce(
    (acc, r) => {
      acc[r.status]++;
      acc.total++;
      return acc;
    },
    { success: 0, failure: 0, skipped: 0, cancelled: 0, total: 0 },
  );
  const verdict =
    totals.failure === 0
      ? `${ANSI_GREEN}all green${ANSI_RESET}`
      : `${ANSI_RED}${totals.failure} job(s) failed${ANSI_RESET}`;
  const totalsLine = `\n_Total: ${totals.success} ok, ${totals.failure} failed, ${totals.skipped} skipped, ${totals.cancelled} cancelled — ${verdict}_\n`;
  return [...header, ...rows, totalsLine].join("\n");
}

function renderStdout(results: ReadonlyArray<IJobResult>): string {
  if (results.length === 0) {
    console.log("→ ci-summary: no result files found (dry-run?).");
    return;
  }
  console.log("→ CI summary:\n");
  const ordered = [...results].sort((a, b) => a.name.localeCompare(b.name));
  const nameWidth = Math.max(...ordered.map((r) => r.name.length), 12);
  for (const r of ordered) {
    const color = STATUS_COLOR[r.status];
    const glyph = STATUS_GLYPH[r.status].padEnd(5);
    const name = r.name.padEnd(nameWidth);
    const dur = formatDuration(r.durationMs).padStart(8);
    console.log(`  ${color}${glyph}${ANSI_RESET}  ${name}  ${dur}  ${r.summary ?? ""}`);
  }
  const failed = ordered.filter((r) => r.status === "failure").length;
  if (failed === 0) {
    console.log(`\n  ${ANSI_GREEN}✓ all jobs passed${ANSI_RESET}`);
  } else {
    console.log(`\n  ${ANSI_RED}✗ ${failed} job(s) failed${ANSI_RESET}`);
  }
}

function main(): number {
  const dir = resolve(process.env["CI_RESULTS_DIR"] ?? "./ci-results");
  const results = readResults(dir);
  const markdown = renderMarkdown(results);
  renderStdout(results);
  const summaryPath = process.env["GITHUB_STEP_SUMMARY"];
  if (summaryPath) {
    try {
      const { appendFileSync } = require("node:fs");
      appendFileSync(summaryPath, markdown);
    } catch (err) {
      console.warn(`→ could not write $GITHUB_STEP_SUMMARY: ${err}`);
    }
  } else {
    // Local run: dump to stdout so the operator sees the markdown.
    console.log("\n--- Markdown summary (no $GITHUB_STEP_SUMMARY in env) ---");
    console.log(markdown);
  }
  return 0;
}

main();
