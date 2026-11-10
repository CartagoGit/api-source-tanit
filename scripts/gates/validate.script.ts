#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { main as runProof } from "./prove.script.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export interface IValidationContext {
  readonly branch?: string;
  readonly integrationBranch?: string;
  readonly releaseBranch?: string;
  readonly configKnown: boolean;
  readonly eventName?: string;
  readonly baseRef?: string;
}

/** A missing signal widens validation; only a known feature worktree scopes. */
export function validationArguments(
  args: readonly string[],
  context: IValidationContext,
): readonly string[] {
  if (args.includes("--full")) return args;
  const full =
    !context.configKnown ||
    !context.branch ||
    context.branch === context.integrationBranch ||
    context.branch === context.releaseBranch ||
    (context.eventName !== undefined && context.eventName !== "pull_request") ||
    (context.baseRef !== undefined && context.baseRef === context.releaseBranch);
  return full ? ["--full", ...args] : args;
}

const readContext = (
  root: string,
  env: NodeJS.ProcessEnv,
): IValidationContext => {
  const branchResult = spawnSync(
    "git",
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const branch =
    branchResult.status === 0 ? branchResult.stdout.trim() : undefined;
  try {
    const config = JSON.parse(
      readFileSync(resolve(root, "delendai.config.json"), "utf8"),
    ) as {
      development?: {
        branches?: { integration?: unknown; release?: unknown };
      };
    };
    const integration = config.development?.branches?.integration;
    const release = config.development?.branches?.release;
    if (
      typeof integration !== "string" ||
      integration.length === 0 ||
      typeof release !== "string" ||
      release.length === 0
    ) {
      return { branch, configKnown: false };
    }
    return {
      branch,
      integrationBranch: integration,
      releaseBranch: release,
      configKnown: true,
      ...(env.GITHUB_EVENT_NAME === undefined
        ? {}
        : { eventName: env.GITHUB_EVENT_NAME }),
      ...(env.GITHUB_BASE_REF === undefined
        ? {}
        : { baseRef: env.GITHUB_BASE_REF }),
    };
  } catch {
    return { branch, configKnown: false };
  }
};

export async function main(
  argv = process.argv.slice(2),
  context = readContext(ROOT, process.env),
  prove: (args: string[]) => Promise<number> = runProof,
): Promise<number> {
  const proofArgs = validationArguments(argv, context);
  if (proofArgs.includes("--full") && !argv.includes("--full")) {
    console.log(
      "Full validation required: branch, repository policy, or CI event requires the aggregate proof.",
    );
  }
  return prove([...proofArgs]);
}

if (import.meta.main) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
