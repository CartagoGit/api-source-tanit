#!/usr/bin/env bun
/**
 * Smoke test del discovery framework-agnostic.
 *
 * Uso:
 *   bun scripts/scan.script.ts
 *   bun scripts/scan.script.ts --project-root /path/to/project
 *   POSTMAN_PROJECT_ROOT=/path/to/project bun scripts/scan.script.ts
 *
 * Recorre los `IProjectScanner` registrados, elige el de mayor score,
 * e imprime las rutas encontradas. Pensado para CI y para debugging
 * del discovery sin tener que generar una colección completa.
 */
import { defaultOrchestrator } from "../../frameworks/framework.registry.js";
import { projectRoot } from "../../core/discovery/paths.service.js";

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const rootIdx = argv.indexOf("--project-root");
  const projectRootFlag =
    rootIdx !== -1 ? argv[rootIdx + 1] ?? null : null;
  const root = projectRootFlag ?? process.env.POSTMAN_PROJECT_ROOT ?? projectRoot();

  if (!root) {
    console.error("✘ No project root. Pasa --project-root o POSTMAN_PROJECT_ROOT.");
    return 1;
  }

  console.log(`→ Escaneando ${root}\n`);

  const orch = defaultOrchestrator();

  const { match, scanner, validation } = await orch.detectProject(root);
  if (!match) {
    console.error(
      "✘ No se detectó ningún framework. Comprueba la ruta o añade un IProjectScanner.",
    );
    return 1;
  }
  console.log(`✔ Framework ganador: ${match.framework}`);
  console.log(`  · Artefactos:    ${match.artifacts.join(", ") || "(ninguno)"}`);
  console.log(`  · RouteScanner:  ${scanner?.constructor.name ?? "(none)"}`);
  console.log(`  · Validation:    ${validation?.constructor.name ?? "(none)"}\n`);

  if (!scanner) {
    console.error("✘ Hay match pero no hay scanner para este framework.");
    return 1;
  }

  const routes = await scanner.scan(match);
  console.log(`✔ ${routes.length} rutas descubiertas:\n`);
  for (const r of routes) {
    const tags = r.tags?.length ? ` [${r.tags.join(", ")}]` : "";
    const desc = r.description ? ` — ${r.description}` : "";
    console.log(`  ${r.method.padEnd(6)} ${r.uri}${tags}${desc}`);
  }
  return 0;
}

process.exit(await main());
