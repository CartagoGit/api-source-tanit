#!/usr/bin/env bun
/**
 * `summary` script.
 *
 * Inspects a host project without generating artifacts. It replaces
 * `generate --inspect` (which parsed stdout with regex) with an
 * in-process call to `summarizeWithAllFrameworks()`.
 *
 * Usage:
 *   bun scripts/summary.script.ts [--project-root <path>] [--format text|json] [--no-history]
 *
 * Default project-root: `process.env.POSTMAN_PROJECT_ROOT` or cwd.
 * Default format: `text` (human output). `json` dumps IProjectSummary.
 * `--no-history` disables the append to `~/.tanit/history.jsonl`,
 * for tests and for anyone who does not want history.
 */


import { summarizeWithAllFrameworks } from "../../frameworks/index.js";
import { resolveRoot } from "../../core/helpers/resolve-root.helper.js";
import { hasFlag } from "../../core/helpers/argv.helper.js";
import { appendHistory } from "../../ui/server/history.service.js";

interface ParsedArgs {
  projectRoot: string;
  format: "text" | "json";
}

function parseArgs(argv: string[]): ParsedArgs {
  // By `resolveRoot`, which is the same resolution used by the other
  // commands. Previously each one had its own and they did not match.
  const { root: projectRoot } = resolveRoot({ argv });
  const formatIdx = argv.indexOf("--format");
  const formatRaw = formatIdx !== -1 ? argv[formatIdx + 1] : "text";
  const format: "text" | "json" = formatRaw === "json" ? "json" : "text";
  return { projectRoot, format };
}

function asText(s: Awaited<ReturnType<typeof summarizeWithAllFrameworks>>): string {
  const lines = [
    `→ Framework:        ${s.framework}` +
      (s.frameworks.length > 1 ? ` (híbrido: ${s.frameworks.join(", ")})` : ""),
    `→ Project name:     ${s.projectName}`,
    `→ Base URL:         ${s.baseUrl}`,
    // "Endpoints" and not "routes in code": a Laravel `apiResource` is
    // ONE line of code and SEVEN endpoints, and what matters is the
    // second. The collection can still bring more *requests* than this,
    // because enrichment adds body variants for the SAME endpoint —
    // variants, not new endpoints.
    `→ Endpoints:        ${s.routesInCode}`,
    `→ With rules:       ${s.withFormRequest}`,
    `→ Without rules:    ${s.withoutFormRequest}`,
    `→ Inferred bodies:  ${s.bodiesAdded}`,
    `→ Inferred queries: ${s.queriesAdded}`,
    `→ Variables:        ${s.inferredVariables}`,
    `→ Overrides:        ${s.manualEndpoints}`,
    `→ Login:            ${s.auth ? s.auth.loginEndpoint : "not detected"}`,
    `→ Zero-config:      ${s.zeroConfig ? "yes" : "no"}`,
    `→ Config:           ${s.configPath}`,
    // f00010 S2: documentation health, in one line. The full detail
    // travels in the JSON; here is just the quick read:
    // "validation 44% · bodies 100% · examples 100% · descriptions 100%".
    `→ Health:           validation ${s.health.withValidationPercent}% · ` +
      `body ${s.health.withBodySchemaPercent}% · ` +
      `examples ${s.health.withExamplesPercent}% · ` +
      `descriptions ${s.health.withDescriptionPercent}%`,
  ];
  for (const warning of s.warnings) lines.push(`\n⚠ ${warning}`);
  // f00010 S3: the user sees **why** the framework was chosen, not
  // just which one. Each signal is one line with its weight; detectors
  // not yet enriched (the majority) only show the framework + score and
  // skip the block, which is the honest thing to do.
  if (s.evidence.length > 0) {
    lines.push(`\n→ ¿Por qué ${s.framework}?`);
    for (const e of s.evidence) {
      const weight = e.weight >= 0 ? `+${e.weight.toFixed(2)}` : e.weight.toFixed(2);
      const artifact = e.artifact ? ` (${e.artifact})` : "";
      lines.push(`  · ${e.signal}${artifact}  [${weight}]`);
    }
  }
  return lines.join("\n");
}

export async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const { projectRoot, format } = parseArgs(argv);
  try {
    const summary = await summarizeWithAllFrameworks(projectRoot);
    if (format === "json") {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(asText(summary));
    }
    // f00010 S4: leave a trace of the inspection in
    // `~/.tanit/history.jsonl`. The append is **best-effort**: if it
    // fails (disk full, permissions), `summary` already printed its
    // result and the trace that could not be written is not a reason
    // to return code 1. `--no-history` disables the trace for repeated
    // tests and for anyone who does not want history.
    if (!hasFlag(argv, "--no-history")) {
      const outcome = await appendHistory({
        kind: "summary",
        projectRoot,
        summary,
      });
      if (!outcome.ok) {
        console.warn(
          `\n⚠ Could not record this summary in the history (${outcome.path}): ${outcome.reason}`,
        );
      }
    }
    return 0;
  } catch (err) {
    console.error(
      `✘ summary falló: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await main());
}
