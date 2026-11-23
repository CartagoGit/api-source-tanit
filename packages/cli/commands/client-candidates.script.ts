#!/usr/bin/env bun
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { inspectClientProjectCandidates } from "../../core/discovery/client-usage.service.js";
import { defaultOrchestrator } from "../../frameworks/framework.registry.js";

/** List concrete workspace folders or backend services as JSON. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        "project-root": { type: "string" },
        role: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (values.help) {
      console.log("Usage: apisrc client-candidates --project-root <folder> --role frontend|backend");
      return 0;
    }

    const folder = values["project-root"];
    if (!folder?.trim()) throw new Error("--project-root is required");
    const { role } = values;
    if (role !== "frontend" && role !== "backend") throw new Error("--role must be frontend or backend");

    const candidates = await inspectClientProjectCandidates(resolve(folder), role, defaultOrchestrator());
    console.log(JSON.stringify(candidates));
    return 0;
  } catch (error) {
    console.error(`Client candidates failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await main());
}
