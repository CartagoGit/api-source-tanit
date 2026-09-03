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
const BUN_VERSION_LATEST = /^\s*bun-version:\s*["']?latest["']?\s*$/;
const BUN_INSTALL = /\bbun\s+install\b/;

export function findBunCiProblems(source: string): IBunCiProblem[] {
  const problems: IBunCiProblem[] = [];
  const lines = source.split("\n");
  let hasSetupBun = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (SETUP_BUN.test(line)) hasSetupBun = true;

    if (BUN_VERSION_LATEST.test(line)) {
      problems.push({
        line: index + 1,
        detail: "bun-version no puede ser latest; fija una versión concreta",
      });
    }

    if (BUN_INSTALL.test(line) && !line.includes("--frozen-lockfile")) {
      problems.push({
        line: index + 1,
        detail: "bun install debe incluir --frozen-lockfile",
      });
    }
  }

  if (!hasSetupBun) return [];
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