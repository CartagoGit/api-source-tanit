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
import {
  guessedRootNotice,
  resolveRoot,
} from "../../core/helpers/resolve-root.helper.js";

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const resolved = resolveRoot({ argv });
  const root = resolved.root;

  // Decir cuando se ha adivinado: el último recurso es el directorio
  // actual, y escanear el sitio equivocado en silencio es cómo `watch`
  // acabó recorriendo `/tmp` entero.
  const aviso = guessedRootNotice(resolved);
  if (aviso) console.log(`${aviso}\n`);

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
