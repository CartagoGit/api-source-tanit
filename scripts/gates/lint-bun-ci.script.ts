#!/usr/bin/env bun
/**
 * `bun run lint:bun-ci` — la CI debe usar Bun y el lockfile de forma
 * reproducible.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { REPO_ROOT } from "../helpers/root.helper.js";

export interface IBunCiProblem {
  readonly line: number;
  readonly detail: string;
}

const WORKFLOWS_DIR = join(REPO_ROOT, ".github", "workflows");
const WORKFLOW_FILE = /\.ya?ml$/;
const SETUP_BUN = /uses:\s*oven-sh\/setup-bun@/;
const BUN_VERSION = /^\s*bun-version:\s*["']?([^"'#\s]+)["']?/;
const FIXED_BUN_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const RUN_STEP = /^(\s*)(?:-\s*)?run:\s*(.*)$/;
const WORKFLOW_STEP = /^\s*-\s+/;
const BUN_INSTALL_COMMAND = /(?:^|&&\s*|[;&|]\s*)bun\s+install\b/;

function withoutYamlComment(line: string): string {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if ((character === "'" || character === '"') && line[index - 1] !== "\\") {
      quote = quote === character ? null : quote ?? character;
    } else if (character === "#" && quote === null) {
      return line.slice(0, index);
    }
  }
  return line;
}

export function findBunCiProblems(source: string): IBunCiProblem[] {
  const problems: IBunCiProblem[] = [];
  const lines = source.split("\n");
  let runBlockIndent: number | null = null;
  let pendingSetup: { line: number; indent: number; hasVersion: boolean } | null = null;

  const finishSetup = (): void => {
    if (pendingSetup !== null && !pendingSetup.hasVersion) {
      problems.push({
        line: pendingSetup.line,
        detail: "setup-bun debe declarar bun-version con una versión concreta",
      });
    }
    pendingSetup = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const line = withoutYamlComment(rawLine);
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;

    if (pendingSetup !== null && WORKFLOW_STEP.test(line) && indent <= pendingSetup.indent && !SETUP_BUN.test(line)) {
      finishSetup();
    }

    if (SETUP_BUN.test(line)) {
      finishSetup();
      pendingSetup = { line: index + 1, indent, hasVersion: false };
    }

    const versionMatch = BUN_VERSION.exec(line);
    if (versionMatch) {
      if (pendingSetup !== null && indent > pendingSetup.indent) pendingSetup.hasVersion = true;
      if (!FIXED_BUN_VERSION.test(versionMatch[1] ?? "")) {
        problems.push({
          line: index + 1,
          detail: "bun-version debe ser una versión concreta; usa semver concreta",
        });
      }
    }

    const runMatch = RUN_STEP.exec(line);
    if (runMatch) {
      const command = runMatch[2]?.trim() ?? "";
      runBlockIndent = command === "|" || command === ">" ? runMatch[1]?.length ?? 0 : null;
      if (command !== "|" && command !== ">" && BUN_INSTALL_COMMAND.test(command) && !command.includes("--frozen-lockfile")) {
        problems.push({
          line: index + 1,
          detail: "bun install debe incluir --frozen-lockfile",
        });
      }
      continue;
    }

    if (runBlockIndent !== null && (trimmed === "" || indent > runBlockIndent) && !trimmed.startsWith("#") && BUN_INSTALL_COMMAND.test(trimmed) && !trimmed.includes("--frozen-lockfile")) {
      problems.push({
        line: index + 1,
        detail: "bun install debe incluir --frozen-lockfile",
      });
    } else if (runBlockIndent !== null && trimmed !== "" && indent <= runBlockIndent) {
      runBlockIndent = null;
    }
  }

  finishSetup();
  return problems;
}

async function main(): Promise<number> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(WORKFLOWS_DIR, { withFileTypes: true });
  const workflows = entries
    .filter((entry) => entry.isFile() && WORKFLOW_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const problems: Array<IBunCiProblem & { readonly file: string }> = [];

  for (const workflow of workflows) {
    const path = join(WORKFLOWS_DIR, workflow);
    const source = await readFile(path, "utf8");
    for (const problem of findBunCiProblems(source)) {
      problems.push({ file: workflow, ...problem });
    }
  }

  if (problems.length > 0) {
    console.error(`lint:bun-ci — ${problems.length} deriva(s) encontrada(s):`);
    for (const problem of problems) {
      console.error(`  ✗ .github/workflows/${problem.file}:${problem.line} — ${problem.detail}`);
    }
    return 1;
  }

  console.log(`lint:bun-ci — ${workflows.length} workflow(s) revisado(s), sin deriva`);
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}