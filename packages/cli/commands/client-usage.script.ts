#!/usr/bin/env bun
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type {
  IClientAlias,
  IClientConsumptionResult,
} from "../../contracts/interfaces/core/client-consumption.interface.js";
import { analyzeClientProjects } from "../../core/discovery/client-usage.service.js";
import { resolveRoot } from "../../core/helpers/resolve-root.helper.js";
import { defaultOrchestrator } from "../../frameworks/framework.registry.js";

function parseAlias(value: string): IClientAlias {
  const separator = value.indexOf("=");
  const receiver = (separator === -1 ? value : value.slice(0, separator)).trim();
  const source = separator === -1 ? undefined : value.slice(separator + 1).trim();
  if (!receiver || source === "") {
    throw new Error("--client-alias requires a receiver or receiver=module");
  }
  return source === undefined ? { receiver } : { receiver, source };
}

function formatReport(result: IClientConsumptionResult): string {
  const { counts, usages, diagnostics, operationsWithoutConfirmedConsumer } = result;
  const lines = [
    `Client usage: ${counts.resolved} resolved, ${counts.unresolved} unresolved`,
  ];
  if (operationsWithoutConfirmedConsumer) {
    lines.push(
      `Backend comparison: ${counts.matched} matched, ${counts.missing} missing, ${counts.ambiguous} ambiguous`,
    );
  }
  for (const { location, method, path, evidence, unresolvedReason, correlation } of usages) {
    const operation = path === undefined ? "" : ` ${method ?? "?"} ${path}`;
    const status = [unresolvedReason, correlation?.status].filter(Boolean).join(", ");
    lines.push(
      `  ${location.file}:${location.line}:${location.column + 1} ${evidence.callee}${operation}` +
        (status ? ` (${status})` : ""),
    );
  }
  for (const { file, reason } of diagnostics) {
    lines.push(`  ${file}: ${reason}`);
  }
  if (operationsWithoutConfirmedConsumer?.length) {
    lines.push("Backend operations without a confirmed consumer:");
    for (const { method, uri } of operationsWithoutConfirmedConsumer) {
      lines.push(`  ${method} ${uri}`);
    }
  }
  return lines.join("\n");
}

/** Report observed client calls and optionally compare them with a backend catalog. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        "project-root": { type: "string" },
        "backend-root": { type: "string" },
        "client-alias": { type: "string", multiple: true },
        format: { type: "string", default: "text" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (values.help) {
      console.log(
        "Usage: apisrc client-usage [--project-root <frontend>] [--backend-root <backend>]\n" +
          "                          [--format text|json] [--client-alias <receiver[=module]> ...]",
      );
      return 0;
    }
    if (values.format !== "json" && values.format !== "text") {
      throw new Error("--format must be text or json");
    }
    if (values["project-root"] === "" || values["backend-root"] === "") {
      throw new Error("Project roots must be nonempty paths");
    }

    const { root: projectRoot } = resolveRoot({ argv });
    const backendRoot = values["backend-root"];
    const aliases = values["client-alias"]?.map(parseAlias);
    const result = await analyzeClientProjects({
      projectRoot,
      ...(backendRoot === undefined ? {} : { backendRoot: resolve(backendRoot) }),
      ...(aliases === undefined ? {} : { aliases }),
    }, defaultOrchestrator());
    console.log(values.format === "json" ? JSON.stringify(result) : formatReport(result));
    return 0;
  } catch (error) {
    console.error(`Client usage failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await main());
}
