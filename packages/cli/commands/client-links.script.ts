#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ClientProjectLinksInputSchema } from "../../contracts/constants/core/client-consumption.constant.js";
import { analyzeClientProjectLinks } from "../../core/discovery/client-usage.service.js";
import { parseJson } from "../../core/helpers/parse-json.helper.js";
import { defaultOrchestrator } from "../../frameworks/framework.registry.js";

/** Compare the frontend-to-service links declared in a JSON plan. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const { values } = parseArgs({
      args: argv,
      options: { plan: { type: "string" }, help: { type: "boolean", short: "h" } },
    });
    if (values.help) {
      console.log("Usage: apisrc client-links --plan <file>");
      return 0;
    }
    if (!values.plan?.trim()) throw new Error("--plan is required");

    const planPath = resolve(values.plan);
    const contents = await readFile(planPath, "utf8");
    const document = parseJson(contents.replace(/^\uFEFF/u, ""));
    if (!document.ok) throw new Error(`Plan must be valid JSON: ${document.reason}`);
    const selection = ClientProjectLinksInputSchema.safeParse(document.value);
    if (!selection.success) throw new Error(`Invalid plan: ${selection.error.message}`);

    const directory = dirname(planPath);
    const { frontends, links } = selection.data;
    const report = await analyzeClientProjectLinks({
      frontends: frontends.map(frontend => ({ ...frontend, root: resolve(directory, frontend.root) })),
      links: links.map(link => ({
        ...link,
        frontendRoot: resolve(directory, link.frontendRoot),
        backendRoot: resolve(directory, link.backendRoot),
      })),
    }, defaultOrchestrator());
    console.log(JSON.stringify(report));
    return 0;
  } catch (error) {
    console.error(`Client links failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await main());
}
