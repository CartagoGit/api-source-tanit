#!/usr/bin/env bun
/**
 * Smoke test of the framework-agnostic discovery.
 *
 * Usage:
 *   bun scripts/scan.script.ts
 *   bun scripts/scan.script.ts --project-root /path/to/project
 *   POSTMAN_PROJECT_ROOT=/path/to/project bun scripts/scan.script.ts
 *
 * Walks through the registered `IProjectScanner`s, picks the one with
 * the highest score, and prints the discovered routes. Designed for CI
 * and for debugging discovery without having to generate a full
 * collection.
 *
 * ## Why `runScan` is split apart from `main`
 *
 * Same reason as in `generate`, `check`, and `list`: the plugin tool
 * needs **the data**, and parsing the output with regex breaks the day
 * a column changes.
 *
 * And there is a more urgent reason. This file used to call
 * `process.exit(await main())` **without a guard**, in the module body:
 * anyone who imported it —a test, the plugin— would launch a scan and
 * kill the process. In a long-lived MCP server that is the whole server
 * going down while loading the tool. That was the case in four of the
 * twelve commands, and `lint:command-coverage` now requires it.
 */
import { defaultOrchestrator } from "../../frameworks/framework.registry.js";
import { guessedRootNotice, resolveRoot } from "../../core/helpers/resolve-root.helper.js";
import type { IProjectContext } from "../../contracts/interfaces/core/project-context.interface.js";
import type { IScanOutcome } from "../../contracts/interfaces/cli/scan-outcome.interface.js";

/** Scans the project and returns what was found, printing it along the way. */
export async function runScan(
  argv: string[] = process.argv.slice(2),
  context?: IProjectContext,
): Promise<IScanOutcome> {
  const root = context?.projectRoot ?? resolveRoot({ argv }).root;

  // Say when the root was guessed: the last resort is the current
  // directory, and silently scanning the wrong place is how `watch`
  // ended up walking all of `/tmp`.
  const aviso = context ? "" : guessedRootNotice(resolveRoot({ argv }));
  if (aviso) console.log(`${aviso}\n`);

  console.log(`→ Scanning ${root}\n`);

  const vacio = { root, artifacts: [], routes: [] } as const;

  const orch = defaultOrchestrator();

  const { match, scanner, validation } = await orch.detectProject(root);
  if (!match) {
    console.error(
      "✘ No framework detected. Check the path, or add an IProjectScanner.",
    );
    return { ...vacio, code: 1, framework: null, scanner: null, validation: null };
  }

  const nombreScanner = scanner?.constructor.name ?? null;
  const nombreValidacion = validation?.constructor.name ?? null;

  console.log(`✔ Winning framework: ${match.framework}`);
  console.log(`  · Artifacts:     ${match.artifacts.join(", ") || "(ninguno)"}`);
  console.log(`  · RouteScanner:  ${nombreScanner ?? "(none)"}`);
  console.log(`  · Validation:    ${nombreValidacion ?? "(none)"}\n`);

  if (!scanner) {
    console.error("✘ The project matched, but there is no route scanner for this framework.");
    return {
      ...vacio,
      code: 1,
      framework: match.framework,
      artifacts: match.artifacts,
      scanner: null,
      validation: nombreValidacion,
    };
  }

  const routes = (await scanner.scan(match)).routes;
  console.log(`✔ ${routes.length} routes discovered:\n`);
  for (const r of routes) {
    const tags = r.tags?.length ? ` [${r.tags.join(", ")}]` : "";
    const desc = r.description ? ` — ${r.description}` : "";
    console.log(`  ${r.method.padEnd(6)} ${r.uri}${tags}${desc}`);
  }

  return {
    code: 0,
    root,
    framework: match.framework,
    artifacts: match.artifacts,
    scanner: nombreScanner,
    validation: nombreValidacion,
    routes: routes.map((r) => ({
      method: r.method,
      uri: r.uri,
      tags: r.tags ?? [],
      description: r.description ?? null,
    })),
  };
}

/** The wrapper used by the CLI: only the exit code. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  return (await runScan(argv)).code;
}

if (import.meta.main) {
  process.exit(await main());
}
