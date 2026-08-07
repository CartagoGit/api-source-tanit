#!/usr/bin/env bun
/**
 * Script `summary`.
 *
 * Inspecciona un proyecto host sin generar artefactos. Sustituye al
 * `generate --inspect` (parseaba stdout con regex) por una llamada
 * in-process a `summarizeWithAllFrameworks()`.
 *
 * Uso:
 *   bun scripts/summary.script.ts [--project-root <path>] [--format text|json]
 *
 * Default project-root: `process.env.POSTMAN_PROJECT_ROOT` o cwd.
 * Default format: `text` (salida humana). `json` vuelca IProjectSummary.
 */
import { resolve } from "node:path";

import { summarizeWithAllFrameworks } from "../../frameworks/index.js";

interface ParsedArgs {
  projectRoot: string;
  format: "text" | "json";
}

function parseArgs(argv: string[]): ParsedArgs {
  const rootIdx = argv.indexOf("--project-root");
  const projectRoot =
    rootIdx !== -1 && argv[rootIdx + 1]
      ? resolve(argv[rootIdx + 1] ?? ".")
      : process.env["POSTMAN_PROJECT_ROOT"]
        ? resolve(process.env["POSTMAN_PROJECT_ROOT"])
        : process.cwd();
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
    // "Endpoints" y no "rutas en código": un `apiResource` de Laravel es
    // UNA línea de código y SIETE endpoints, y lo que importa es lo
    // segundo. La colección puede traer aún más *requests* que esto,
    // porque el enriquecido añade variantes de body para el MISMO
    // endpoint — variantes, no endpoints nuevos.
    `→ Endpoints:        ${s.routesInCode}`,
    `→ Con reglas:       ${s.withFormRequest}`,
    `→ Sin reglas:       ${s.withoutFormRequest}`,
    `→ Bodies inferidos: ${s.bodiesAdded}`,
    `→ Queries inferidas:${s.queriesAdded}`,
    `→ Variables:        ${s.inferredVariables}`,
    `→ Overrides:        ${s.manualEndpoints}`,
    `→ Login:            ${s.auth ? s.auth.loginEndpoint : "no detectado"}`,
    `→ Zero-config:      ${s.zeroConfig ? "sí" : "no"}`,
    `→ Config:           ${s.configPath}`,
  ];
  for (const warning of s.warnings) lines.push(`\n⚠ ${warning}`);
  return lines.join("\n");
}

async function main(): Promise<number> {
  const { projectRoot, format } = parseArgs(process.argv.slice(2));
  try {
    const summary = await summarizeWithAllFrameworks(projectRoot);
    if (format === "json") {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(asText(summary));
    }
    return 0;
  } catch (err) {
    console.error(
      `✘ summary falló: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
}

process.exit(await main());
