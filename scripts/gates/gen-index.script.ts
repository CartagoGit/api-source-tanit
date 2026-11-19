#!/usr/bin/env bun
/**
 * Regenerates (or checks) `docs/delendai/proposals/INDEX.md` from the
 * filesystem and the proposal frontmatter — x00032 S2.
 *
 * Why it exists
 * - `INDEX.md` had two sources of truth (the filesystem and the
 *   frontmatter status fields) that drifted several times during
 *   review (the audit 2026-09-04 found `a00014/15/16/b00001` in
 *   "Ready" while they were already `done` and lived in `done/`).
 * - A hand-maintained index is exactly the kind of place where
 *   drift happens by accident: a proposal is closed, the body
 *   moves, and nobody updates the table.
 *
 * The fix
 * - The filesystem + frontmatter is the single source of truth.
 *   This script reads `docs/delendai/proposals/**` (all `.md` files
 *   under proposals/), extracts the frontmatter (id, title, kind,
 *   status), and renders the table for each section ("Ready",
 *   "Bloqueadas", "Done") in a deterministic order.
 * - Three modes:
 *     `bun run lint:proposals:fix`           writes INDEX.md
 *     `bun run lint:proposals:fix --check`   exits 1 if INDEX
 *                                            differs from the
 *                                            regenerated version
 *     (the `--check` step is also embedded in `bun run lint:proposals`
 *      so the gate fails on drift)
 *
 * - Sections:
 *   - **Ready**:    `status: ready` proposals.
 *   - **Bloqueadas**: `status: blocked` proposals with their
 *     `blockedReason` (frontmatter) summarised.
 *   - **Done**:     `status: done` proposals, grouped by kind, one
 *     short bullet per proposal with its `shippedIn` SHAs.
 *
 * Why we don't render "Done" as a table
 * - With 100+ closed proposals, a flat table of all of them would
 *   dwarf the active work (Ready + Bloqueadas). The bullet list is
 *   scannable, supports grouping by kind (audit / fix / chore / …)
 *   without losing order, and makes it clear that "done" is an
 *   archive, not a queue.
 *
 * x00032 S2 contract
 * - Pure: no disk writes outside `INDEX.md` (when called without
 *   `--check`).
 * - Deterministic: same input → same bytes, byte-for-byte. CI
 *   compares with `git diff` to catch drift.
 * - Idempotent: running it twice in a row is a no-op (unless the
 *   on-disk file already drifted).
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { PROPOSALS_DIR, REPO_ROOT } from "../helpers/root.helper.js";

export interface IProposal {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly status: string;
  readonly blockedReason: string;
  readonly path: string;
  readonly relPath: string;
  readonly shippedIn: ReadonlyArray<string>;
}

export async function listMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  // Plain recursive readdir — keeps the script dependency-free and
  // easy to test in isolation. The proposals tree is small
  // (hundreds of files at most), so the cost is irrelevant.
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (entry.isFile() && full.endsWith(".md")) {
        out.push(full);
      }
    }
  }
  await walk(dir);
  return out.sort();
}

function readField(frontmatter: string, name: string): string {
  // YAML-ish: the frontmatter is a flat block of `key: value` lines.
  // We don't need a full YAML parser because the proposals are
  // written by hand and follow a stable shape.
  const re = new RegExp(`^${name}:\\s*(.+?)\\s*(?:#.*)?$`, "m");
  const m = re.exec(frontmatter);
  return m?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
}

function readArrayField(frontmatter: string, name: string): string[] {
  // Read either the `key:\n  - a\n  - b` block form or `key: [a, b]`.
  const block = frontmatter.match(
    new RegExp(`^${name}:\\s*\\n((?:\\s*-\\s*.+\\s*\\n?)+)`, "m"),
  );
  if (block && block[1] !== undefined) {
    return block[1]
      .split("\n")
      .map((line) => line.match(/-\s*(.+?)\s*(?:#.*)?$/)?.[1] ?? "")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  const inline = frontmatter.match(new RegExp(`^${name}:\\s*\\[([^\\]]+)\\]`, "m"));
  if (inline) {
    return (inline[1] ?? "")
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return [];
}

function parseFrontmatter(text: string): { frontmatter: string; body: string } {
  if (!text.startsWith("---")) return { frontmatter: "", body: text };
  const parts = text.split("---");
  return {
    frontmatter: parts[1] ?? "",
    body: parts.slice(2).join("---"),
  };
}

export async function readProposal(
  absPath: string,
  proposalsDir: string,
): Promise<IProposal | undefined> {
  if (
    absPath.endsWith("/INDEX.md") ||
    absPath.endsWith("/README.md") ||
    absPath.endsWith("/.gitkeep")
  ) {
    return undefined;
  }
  const text = await readFile(absPath, "utf8");
  const { frontmatter } = parseFrontmatter(text);
  if (!frontmatter.trim()) return undefined;
  const id = readField(frontmatter, "id");
  if (!id) return undefined; // not a proposal (e.g. AGENT-BOOTSTRAP.md)
  return {
    id,
    title: readField(frontmatter, "title"),
    kind: readField(frontmatter, "kind"),
    status: readField(frontmatter, "status"),
    blockedReason: readField(frontmatter, "blockedReason"),
    shippedIn: readArrayField(frontmatter, "shippedIn"),
    path: absPath,
    relPath: relative(proposalsDir, absPath),
  };
}

/**
 * Read all proposals under `dir`.
 *
 * `dir` defaults to `PROPOSALS_DIR`; tests pass a `mkdtemp` fixture.
 */
export async function collect(dir: string = PROPOSALS_DIR): Promise<IProposal[]> {
  const files = await listMarkdown(dir);
  const out: IProposal[] = [];
  for (const f of files) {
    const p = await readProposal(f, dir);
    if (p) out.push(p);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Render a single section of the INDEX.
 *
 * We keep this small and explicit: any drift in formatting is now a
 * compile-time question — change the template here, all future
 * regenerations match. The on-disk file is whatever this function
 * produced.
 */
function renderHeader(): string {
  return [
    "# Proposals",
    "",
    "Generated by `scripts/gates/gen-index.script.ts`. Do not edit by hand:",
    "any change will be detected by `bun run lint:proposals` and rejected.",
    "",
    "## Ready",
    "",
  ].join("\n");
}

function renderTable(proposals: ReadonlyArray<IProposal>): string {
  const lines: string[] = [
    "| id | kind | path |",
    "| --- | --- | --- |",
  ];
  for (const p of proposals) {
    lines.push(`| \`${p.id}\` | \`${p.kind}\` | [\`${p.relPath}\`](${p.relPath}) |`);
  }
  return lines.join("\n");
}

function renderBlocked(proposals: ReadonlyArray<IProposal>): string {
  const lines: string[] = [
    "## Bloqueadas",
    "",
    "`status: blocked` vive en `blocked/`, con `blockedReason` en el frontmatter",
    "que explica qué lo destraba.",
    "",
  ];
  if (proposals.length === 0) {
    lines.push("(ninguna)");
    return lines.join("\n");
  }
  lines.push("| id | kind | path | nota |");
  lines.push("| --- | --- | --- | --- |");
  for (const p of proposals) {
    const reason = p.blockedReason || "—";
    lines.push(
      `| \`${p.id}\` | \`${p.kind}\` | [\`${p.relPath}\`](${p.relPath}) | ${reason} |`,
    );
  }
  return lines.join("\n");
}

function renderDone(proposals: ReadonlyArray<IProposal>): string {
  const lines: string[] = [
    "## Done",
    "",
    "`status: done` vive en `done/<kind>/`. Una sola línea por",
    "propuesta con sus SHAs (`shippedIn`).",
    "",
  ];
  if (proposals.length === 0) {
    lines.push("(ninguna)");
    return lines.join("\n");
  }
  // Group by kind for readability.
  const byKind = new Map<string, IProposal[]>();
  for (const p of proposals) {
    const list = byKind.get(p.kind) ?? [];
    list.push(p);
    byKind.set(p.kind, list);
  }
  const kinds = [...byKind.keys()].sort();
  for (const kind of kinds) {
    lines.push(`### ${kind}`);
    lines.push("");
    for (const p of byKind.get(kind) ?? []) {
      const shas = p.shippedIn.length > 0 ? p.shippedIn.join(", ") : "—";
      lines.push(`- \`${p.id}\` — ${p.title} — \`${shas}\``);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export async function render(
  proposals: ReadonlyArray<IProposal>,
): Promise<string> {
  const ready = proposals.filter((p) => p.status === "ready");
  const blocked = proposals.filter((p) => p.status === "blocked");
  const done = proposals.filter((p) => p.status === "done");

  return [
    renderHeader(),
    renderTable(ready),
    "",
    renderBlocked(blocked),
    "",
    renderDone(done),
    "",
  ].join("\n");
}

export interface IMainOptions {
  /** Proposals directory; defaults to the repo's PROPOSALS_DIR. */
  readonly proposalsDir?: string;
  /** INDEX.md target; defaults to `<proposalsDir>/INDEX.md`. */
  readonly indexPath?: string;
  /** CLI args; defaults to `Bun.argv.slice(2)`. */
  readonly argv?: ReadonlyArray<string>;
}

/**
 * CLI entrypoint. Two modes:
 * - no `--check`: regenerate `INDEX.md` in place.
 * - `--check`:    exit 1 if `INDEX.md` differs from the regenerated
 *                 version; print nothing on success.
 *
 * `IMainOptions` exists so the spec file can drive both modes against
 * a `mkdtemp` fixture without touching the real repo.
 */
export async function main(options: IMainOptions = {}): Promise<number> {
  const proposalsDir = options.proposalsDir ?? PROPOSALS_DIR;
  const indexPath = options.indexPath ?? join(proposalsDir, "INDEX.md");
  const argv = options.argv ?? process.argv.slice(2);
  const args = new Set(argv);
  const check = args.has("--check");

  const proposals = await collect(proposalsDir);
  const expected = await render(proposals);

  if (check) {
    let actual: string;
    try {
      actual = await readFile(indexPath, "utf8");
    } catch {
      console.error(
        `lint:proposals:fix --check: ${indexPath} does not exist; run \`bun run lint:proposals:fix\` to create it`,
      );
      return 1;
    }
    if (actual !== expected) {
      console.error(
        `lint:proposals:fix --check: ${indexPath} is out of date. Run \`bun run lint:proposals:fix\` and commit the result.`,
      );
      return 1;
    }
    console.log(
      `lint:proposals:fix --check: ${relative(REPO_ROOT, indexPath)} matches the regenerated version`,
    );
    return 0;
  }
  await writeFile(indexPath, expected);
  console.log(
    `lint:proposals:fix: wrote ${relative(REPO_ROOT, indexPath)} (${expected.length} bytes) from filesystem + frontmatter`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
