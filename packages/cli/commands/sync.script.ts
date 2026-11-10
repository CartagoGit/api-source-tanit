#!/usr/bin/env bun
/** `apisrc sync` reuses the existing generation command. */
import { runGenerate } from "./generate.script.js";

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv.includes("--dry-run")) {
    const result = await runGenerate([...argv.filter((flag) => flag !== "--dry-run"), "--inspect"]);
    return result.code;
  }
  const result = await runGenerate(argv);
  return result.code;
}

if (import.meta.main) process.exit(await main());