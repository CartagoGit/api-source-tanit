#!/usr/bin/env bun
/**
 * Script `summary`.
 *
 * Inspecciona un proyecto host sin generar artefactos. Sustituye al
 * `generate --inspect` (parseaba stdout con regex) por una llamada
 * in-process a `summarizeWithAllFrameworks()`.
 *
 * Uso:
 *   bun scripts/summary.script.ts [--project-root <path>] [--format text|json] [--no-history]
 *
 * Default project-root: `process.env.POSTMAN_PROJECT_ROOT` o cwd.
 * Default format: `text` (salida humana). `json` vuelca IProjectSummary.
 * `--no-history` desactiva el append a `~/.tanit/history.jsonl`,
 * para tests y para quien no quiera historial.
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
  // Por `resolveRoot`, que es la misma resolución que usan los demás
  // comandos. Antes cada uno tenía la suya y no coincidían.
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
    // "Endpoints" y no "rutas en código": un `apiResource` de Laravel es
    // UNA línea de código y SIETE endpoints, y lo que importa es lo
    // segundo. La colección puede traer aún más *requests* que esto,
    // porque el enriquecido añade variantes de body para el MISMO
    // endpoint — variantes, no endpoints nuevos.
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
    // f00010 S2: la salud de la documentación, en una línea. El
    // detalle completo viaja en el JSON; aquí solo la lectura rápida:
    // "validación 44% · bodies 100% · ejemplos 100% · descripciones 100%".
    `→ Health:           validation ${s.health.withValidationPercent}% · ` +
      `body ${s.health.withBodySchemaPercent}% · ` +
      `examples ${s.health.withExamplesPercent}% · ` +
      `descriptions ${s.health.withDescriptionPercent}%`,
  ];
  for (const warning of s.warnings) lines.push(`\n⚠ ${warning}`);
  // f00010 S3: el usuario ve **por qué** se eligió el framework, no
  // solo cuál. Cada señal es una línea con su peso; los detectores
  // que aún no se han enriquecido (la mayoría) muestran sólo el
  // framework + score y se quedan sin bloque, que es lo honesto.
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
    // f00010 S4: dejar huella de la inspección en `~/.tanit/
    // history.jsonl`. El append es **best-effort**: si falla (disco
    // lleno, permisos), `summary` ya imprimió su resultado y la huella
    // que no se pudo escribir no es motivo para devolver código 1.
    // `--no-history` apaga la huella para tests repetidos y para
    // quien no quiera historial.
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
