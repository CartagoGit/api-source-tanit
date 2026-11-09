#!/usr/bin/env bun
import { readFileSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createProofPlan, executeProof } from "../helpers/proof-plan.helper.js";
import type { IProofPlan } from "../../packages/contracts/interfaces/quality/proof-plan.interface.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function git(args: readonly string[]): string {
  const result = spawnSync("git", [...args], { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** Analysis failure means full proof, never an empty successful scope. */
export function collectProof(baseRef: string, forceFull = false): IProofPlan {
  const head = git(["rev-parse", "HEAD"]);
  let base = baseRef;
  let uncertainty: string | undefined;
  let changes: { path: string; status: string }[] = [];
  const files: Record<string, string> = {};
  try {
    base = git(["merge-base", baseRef, "HEAD"]);
    const diff = git(["diff", "--name-status", "--no-renames", `${base}...HEAD`]);
    changes = diff ? diff.split("\n").map(line => { const [status, ...name] = line.split("\t"); return { path: name.join("\t"), status: status ?? "?" }; }) : [];
    if (git(["status", "--porcelain"])) uncertainty = "Dirty checkout requires full proof.";
    for (const file of git(["ls-files"]).split("\n")) {
      if (!file || !/\.(?:[cm]?[jt]sx?|html|scss|css)$/.test(file)) continue;
      if (!file.startsWith("packages/") && !file.startsWith("tests/") && !file.startsWith("scripts/")) continue;
      files[file] = readFileSync(resolve(ROOT, file), "utf8");
    }
  } catch (error) {
    uncertainty = `Repository analysis unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
  return createProofPlan({ base, head, changes, files, forceFull, uncertainty });
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const baseArg = argv.find(arg => arg.startsWith("--base="))?.slice(7);
  const rawConfig = readFileSync(resolve(ROOT, "delendai.config.json"), "utf8");
  const config = JSON.parse(rawConfig) as { development?: { branches?: { integration?: string } } };
  const base = baseArg ?? config.development?.branches?.integration;
  if (!base) throw new Error("No integration branch declared; pass --base=<commit>.");
  const plan = collectProof(base, argv.includes("--full"));
  if (argv.includes("--outputs")) {
    const output = process.env.GITHUB_OUTPUT;
    if (!output) throw new Error("--outputs requires GITHUB_OUTPUT.");
    appendFileSync(output, [`head=${plan.head}`, `plan=${JSON.stringify(plan)}`, ...Object.entries(plan.jobs).map(([job, selected]) => `${job}=${selected}`), ""].join("\n"));
  }
  if (argv.includes("--plan") || argv.includes("--outputs")) { console.log(JSON.stringify(plan, null, 2)); return 0; }
  const expectedHead = process.env.TANIT_PROOF_HEAD;
  if (expectedHead && expectedHead !== plan.head) throw new Error("Proof plan HEAD differs from checked-out HEAD.");
  const job = argv.find(arg => arg.startsWith("--job="))?.slice(6);
  console.log(`Proof scope: ${plan.mode}; ${plan.changedFiles.length} changed files; sections: ${plan.sections.join(", ") || "none"}`);
  for (const reason of plan.reasons) console.log(`Full proof: ${reason}`);
  if (argv.includes("--affected-tests")) {
    if (!plan.specs.length) throw new Error("No affected specs; use the required full proof.");
    return spawnSync("bunx", ["vitest", "run", ...plan.specs], { cwd: ROOT, stdio: "inherit" }).status ?? 1;
  }
  const status = await executeProof(plan, async step => {
    console.log(`\n[proof:${step.id}] ${step.argv.join(" ")}`);
    return spawnSync(step.argv[0]!, [...step.argv.slice(1)], { cwd: ROOT, stdio: "inherit" }).status ?? 1;
  }, job);
  if (!job && status === 0) console.log("Local proof passed. Platform desktop validation remains required in CI when selected.");
  return status;
}

if (import.meta.main) {
  try { process.exit(await main()); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }
}
